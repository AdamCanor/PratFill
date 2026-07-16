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

// A genuine long-login death should always be surfaced — but still only once
// per death, not on every ~daily fire. The worker uses this for the
// "attempted a real refresh and it failed" case, where coverage is irrelevant
// (the user must re-login regardless of how many days are still filled).
export async function hasNotifiedAuthFailure() {
  return Boolean(await AsyncStorage.getItem(AUTH_NOTIFIED_KEY));
}

// Success-notification cadence. Because a new future day unlocks daily, a
// successful run fills a new day almost every day — so notifying on every
// fill ('daily') is effectively a daily heartbeat, while 'weekly' collapses
// that to at most one success notification per 7 days. Death notifications
// are governed separately and always fire.
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

// Hard cap shared across BOTH notification types (success and re-login):
// at most one notification, of either kind, per rolling 24h — regardless of
// how many times the worker fires in that window (currently ~every 6h) or
// how many separate things happened. This is a backstop, not the primary
// throttle — success already limits itself via successNotify, and re-login
// via the once-per-death dedup above — but neither of those alone rules out
// e.g. a partial-fill retry or a session dying later the same day as an
// earlier success, each independently deciding to notify. Every notification
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
    for (const { date, apiDate } of upcoming) {
      if (reportedDates.has(apiDate)) continue;
      const dayOfWeek = date.getDay();
      const defaults = preset.weeklyDefaults?.[dayOfWeek];
      if (!defaults) continue;
      await insertFutureReport({ ...defaults, date: apiDate });
      count++;
    }

    // Only notify when we actually filled something (quiet-by-default), only
    // as often as the user's chosen cadence allows, and never more than once
    // a day overall (shared cap with the re-login notification).
    if (
      count > 0 &&
      (await shouldNotifySuccess(settings.autoSubmit?.successNotify)) &&
      (await canSendNotificationToday())
    ) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'PratFill',
          body: `נוספו דיווחים אוטומטיים ל-${count} ימים`,
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
