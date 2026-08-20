import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { insertFutureReport, getFutureReports, AuthError, hasAppCookie } from '../api/doch1';
import { getUpcomingDates, monthsToQuery, normalizeDate } from '../utils/dates';

export const LAST_RUN_KEY = 'doch1_auto_submit_last_run';
const COVERAGE_KEY = 'doch1_auto_submit_coverage';
const AUTH_NOTIFIED_KEY = 'doch1_auto_submit_auth_notified';
const SUCCESS_NOTIFIED_KEY = 'doch1_auto_submit_success_notified';
const LAST_NOTIFICATION_KEY = 'doch1_auto_submit_last_notification_at';

export async function getLastAutoSubmitRun() {
  const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Whether the user has the feature turned on with a preset selected. The
// background worker checks this before doing anything (refresh included) so a
// disabled config never touches the network or fires notifications.
export async function isAutoSubmitEnabled() {
  const raw = await AsyncStorage.getItem('doch1_settings');
  const settings = raw ? JSON.parse(raw) : null;
  const { enabled, presetId } = settings?.autoSubmit ?? {};
  return Boolean(enabled && presetId);
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

// A session failure is worth a notification only while it threatens actual
// coverage. AppCookie dies ~5h after every login, so the background task
// failing is the NORMAL state between app opens, and a failure the user can
// do nothing useful about (their days are already filled) is noise — worse,
// it's usually worded as "you must log in again" when the truth may be a
// network blip. Instead: stay quiet while filled days remain comfortably
// ahead, and notify at most once per death (flag cleared on the next
// successful run). This is the single gate for every session-failure
// notification the worker sends — the dedup below is part of it.
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

// State-notification cadence. Every successful run reports where the week
// ahead stands (days filled, or that everything is already covered), so
// 'daily' is a once-a-day heartbeat and 'weekly' collapses it to at most one
// per 7 days. Session-problem notifications are governed separately.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function shouldNotifySuccess(mode) {
  if (mode !== 'weekly') return true; // 'daily' (default): every fill
  const raw = await AsyncStorage.getItem(SUCCESS_NOTIFIED_KEY);
  if (!raw) return true;
  return Date.now() - Date.parse(raw) >= WEEK_MS;
}

async function markSuccessNotified() {
  await AsyncStorage.setItem(SUCCESS_NOTIFIED_KEY, new Date().toISOString());
}

// Hard cap shared across BOTH notification types (weekly state and session
// failure):
// at most one notification, of either kind, per rolling 24h — regardless of
// how many times the worker fires in that window (currently ~every 6h) or
// how many separate things happened. This is a backstop, not the primary
// throttle — the state notification already limits itself via successNotify,
// and the session one via the coverage gate + once-per-death dedup above —
// but neither of those alone rules out e.g. a partial-fill retry or a session
// dying later the same day as an earlier state notification, each
// independently deciding to notify. Every notification
// site must check this immediately before sending and call
// markNotificationSent() immediately after.
const NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function canSendNotificationToday() {
  const raw = await AsyncStorage.getItem(LAST_NOTIFICATION_KEY);
  if (!raw) return true;
  return Date.now() - Date.parse(raw) >= NOTIFICATION_COOLDOWN_MS;
}

export async function markNotificationSent() {
  await AsyncStorage.setItem(LAST_NOTIFICATION_KEY, new Date().toISOString());
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
    let alreadyReported = 0;
    for (const { date, apiDate } of upcoming) {
      if (reportedDates.has(apiDate)) {
        alreadyReported++;
        continue;
      }
      const dayOfWeek = date.getDay();
      const defaults = preset.weeklyDefaults?.[dayOfWeek];
      // A day the preset deliberately leaves blank stays unreported — it
      // still counts against the window in the state line below, so "5 מתוך
      // 7" tells the user something real instead of silently rounding up.
      if (!defaults) continue;
      await insertFutureReport({ ...defaults, date: apiDate });
      count++;
    }

    // Every successful run reports the state of the week ahead, including
    // the "nothing to do, you're covered" case: silence is ambiguous (it
    // reads the same as the task never having run), and the whole point of a
    // background filler the user never opens is knowing where they stand.
    // Cadence is still the user's (daily/weekly), and never more than one
    // notification a day overall (shared cap with the session notification).
    const total = upcoming.length;
    const reported = alreadyReported + count;
    const stateLine =
      reported === total
        ? `כל ${total} הימים הקרובים מדווחים`
        : `${reported} מתוך ${total} הימים הקרובים מדווחים`;

    if (
      (await shouldNotifySuccess(settings.autoSubmit?.successNotify)) &&
      (await canSendNotificationToday())
    ) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'PratFill',
          body: count > 0 ? `נוספו דיווחים אוטומטיים ל-${count} ימים · ${stateLine}` : stateLine,
        },
        trigger: null,
      });
      await markSuccessNotified();
      await markNotificationSent();
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
      reported,
      total,
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
