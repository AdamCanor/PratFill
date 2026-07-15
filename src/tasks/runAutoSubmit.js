import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { insertFutureReport, getFutureReports, AuthError, hasAppCookie } from '../api/doch1';
import { getUpcomingDates, monthsToQuery, normalizeDate } from '../utils/dates';

export const LAST_RUN_KEY = 'doch1_auto_submit_last_run';
const COVERAGE_KEY = 'doch1_auto_submit_coverage';
const AUTH_NOTIFIED_KEY = 'doch1_auto_submit_auth_notified';

export async function getLastAutoSubmitRun() {
  const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function recordLastRun(result) {
  await AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify({ ...result, at: new Date().toISOString() }));
}

// Coverage = "every fillable day in the upcoming window is reported", written
// on each successful run. Kept separate from LAST_RUN_KEY because a later
// failed run overwrites the last-run record, while coverage stays true until
// the window actually rolls past what was filled.
export async function getAutoSubmitCoverage() {
  const raw = await AsyncStorage.getItem(COVERAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// An AuthError is worth a notification only while it threatens actual
// coverage. AppCookie dies ~5h after every login, so the background task
// failing is the NORMAL state between app opens — notifying on every failure
// would spam. Instead: stay quiet while filled days remain comfortably ahead,
// and notify at most once per cookie-death (flag cleared on the next
// successful run).
const COVERAGE_AT_RISK_MS = 2 * 24 * 60 * 60 * 1000;

export async function shouldNotifyAuthFailure() {
  if (await AsyncStorage.getItem(AUTH_NOTIFIED_KEY)) return false;
  const coverage = await getAutoSubmitCoverage();
  if (!coverage?.coveredThrough) return true;
  return Date.parse(coverage.coveredThrough) - Date.now() < COVERAGE_AT_RISK_MS;
}

export async function markAuthFailureNotified() {
  await AsyncStorage.setItem(AUTH_NOTIFIED_KEY, new Date().toISOString());
}

// Foreground catch-up: run auto-submit unless a real (non-skipped) run
// succeeded recently. Called on app launch and on foreground transitions —
// combined with the silent session refresh, this is what makes "open the app
// once in a while" enough to keep the week filled even when every background
// fire lands on a dead cookie.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
let catchUpInFlight = null;

export async function runAutoSubmitIfStale() {
  // The launch auth flow and the AppState listener can both call this within
  // moments of each other; overlapping runs would race the reported-dates
  // check and double-insert. Share one in-flight run instead.
  if (catchUpInFlight) return catchUpInFlight;
  catchUpInFlight = (async () => {
    const last = await getLastAutoSubmitRun();
    if (last && !last.error && !last.skipped && Date.now() - Date.parse(last.at) < STALE_AFTER_MS) {
      return null;
    }
    return runAutoSubmit();
  })();
  try {
    return await catchUpInFlight;
  } finally {
    catchUpInFlight = null;
  }
}

export async function runAutoSubmit() {
  const raw = await AsyncStorage.getItem('doch1_settings');
  const settings = raw ? JSON.parse(raw) : null;
  const { enabled, presetId } = settings?.autoSubmit ?? {};
  if (!enabled || !presetId) {
    const result = { skipped: true, reason: 'not configured' };
    await recordLastRun(result);
    return result;
  }

  const preset = settings.weeklyPresets?.find((p) => p.id === presetId);
  if (!preset) {
    const result = { skipped: true, reason: 'preset not found' };
    await recordLastRun(result);
    return result;
  }

  const appCookiePresentAtStart = await hasAppCookie();

  try {
    const upcoming = getUpcomingDates(7);
    const months = monthsToQuery(upcoming);
    const allReports = (
      await Promise.all(months.map(({ month, year }) => getFutureReports(month, year)))
    ).flat();
    const reportedDates = new Set(allReports.map(normalizeDate));

    let count = 0;
    for (const { date, apiDate } of upcoming) {
      if (reportedDates.has(apiDate)) continue;
      const dayOfWeek = date.getDay();
      const defaults = preset.weeklyDefaults?.[dayOfWeek];
      if (!defaults) continue;
      await insertFutureReport({ ...defaults, date: apiDate });
      count++;
    }

    if (count > 0) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'PratFill',
          body: `נוספו דיווחים אוטומטיים ל-${count} ימים`,
        },
        trigger: null,
      });
    }

    // Reaching here means every upcoming day with preset defaults is now
    // reported — coverage extends through the end of the queried window.
    const coveredThrough = upcoming[upcoming.length - 1].date.toISOString();
    await AsyncStorage.setItem(
      COVERAGE_KEY,
      JSON.stringify({ coveredThrough, at: new Date().toISOString() })
    );
    await AsyncStorage.removeItem(AUTH_NOTIFIED_KEY);

    const result = {
      count,
      coveredThrough,
      diagnostics: { appCookiePresentAtStart },
    };
    await recordLastRun(result);
    return result;
  } catch (e) {
    const diagnostics = {
      appCookiePresentAtStart,
      errorName: e?.name ?? null,
      errorMessage: String(e?.message ?? '').slice(0, 500),
    };
    await recordLastRun({ error: e instanceof AuthError ? 'auth' : 'error', diagnostics });
    throw e;
  }
}
