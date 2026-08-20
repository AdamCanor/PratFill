import { AuthError, refreshAppCookie } from '../api/doch1';
import {
  runAutoSubmit,
  shouldNotifyAuthFailure,
  markAuthFailureNotified,
  isAutoSubmitEnabled,
  canSendNotificationToday,
  markNotificationSent,
} from './runAutoSubmit';

export const TASK_NAME = 'auto-submit-reports';
export { runAutoSubmit };

try {
  const TaskManager = require('expo-task-manager');
  const BackgroundTask = require('expo-background-task');
  const Notifications = require('expo-notifications');

  // Worded from what actually failed: claiming the login expired when the
  // phone simply had no network at 3am sends the user to re-login for
  // nothing (and teaches them to ignore the notification).
  async function notifySessionProblem({ transient }) {
    await Notifications.scheduleNotificationAsync({
      content: transient
        ? {
            title: 'PratFill — הדיווח האוטומטי לא רץ',
            body: 'לא הצלחנו להתחבר לשרת. פתח את האפליקציה כדי להשלים את הדיווחים.',
          }
        : {
            title: 'PratFill — נדרשת התחברות',
            body: 'פג תוקף ההתחברות. פתח את האפליקציה כדי לחדש.',
          },
      trigger: null,
    });
  }

  // The autonomous daily flow: get a working session on our own (refreshing a
  // dead AppCookie headlessly if the mechanism is wired up), then fill the
  // week — all without the user opening the app. runAutoSubmit owns the
  // *state* notification, which every successful run sends (gated by the
  // user's daily/weekly setting) so "everything is already covered" is heard
  // as reassurance rather than silence; the worker owns the *session-problem*
  // notification, sent only when that state is actually at risk.
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      // Do nothing (no network, no notifications) when the user hasn't
      // enabled the feature.
      if (!(await isAutoSubmitEnabled())) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }

      const session = await refreshAppCookie();

      if (session.ok) {
        await runAutoSubmit();
        return BackgroundTask.BackgroundTaskResult.Success;
      }

      // Couldn't establish a session. A failed run is not by itself worth
      // waking the user: AppCookie dying between runs is the NORMAL state,
      // the next fire is only ~6h away, and there is nothing to act on while
      // the days ahead are already reported. So notify only while coverage is
      // actually at risk (or was never established) — shouldNotifyAuthFailure
      // owns that judgement, plus the once-per-death dedup — and never more
      // than one notification a day overall.
      if ((await shouldNotifyAuthFailure()) && (await canSendNotificationToday())) {
        await notifySessionProblem({ transient: session.transient });
        await markAuthFailureNotified();
        await markNotificationSent();
      }
      return BackgroundTask.BackgroundTaskResult.Failed;
    } catch (e) {
      // AuthError thrown mid-submit despite a fresh session — treat like a
      // death, throttled the same conservative way.
      if (e instanceof AuthError) {
        if ((await shouldNotifyAuthFailure()) && (await canSendNotificationToday())) {
          await notifySessionProblem({ transient: false });
          await markAuthFailureNotified();
          await markNotificationSent();
        }
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
} catch (_) {
  // Native modules unavailable (Expo Go)
}

// expo-background-task takes minimumInterval in MINUTES (floor 15, default
// 12h) — a previous 15 * 60 here meant 900 minutes (~15h), written as if the
// unit were seconds. The goal is one autonomous fill per day; because
// WorkManager defers work under Doze, we ask for ~6h so at least one fire
// reliably lands each day. Runs are idempotent (already-reported days are
// skipped) and cheap, and notification cadence is decoupled from run cadence
// (see the daily/weekly success setting), so more frequent fires don't mean
// more notifications. The OS treats this as a minimum, not a schedule.
const MINIMUM_INTERVAL_MINUTES = 360;
const REGISTERED_INTERVAL_KEY = 'doch1_auto_submit_registered_interval';

export async function registerAutoSubmitTask() {
  try {
    const TaskManager = require('expo-task-manager');
    const BackgroundTask = require('expo-background-task');
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;

    // Registration persists across launches, so an interval change here
    // would silently never reach devices that already registered — compare
    // against what was last registered and re-register on mismatch.
    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    const registeredInterval = Number(await AsyncStorage.getItem(REGISTERED_INTERVAL_KEY));
    if (isRegistered && registeredInterval === MINIMUM_INTERVAL_MINUTES) return;

    if (isRegistered) await BackgroundTask.unregisterTaskAsync(TASK_NAME);
    await BackgroundTask.registerTaskAsync(TASK_NAME, {
      minimumInterval: MINIMUM_INTERVAL_MINUTES,
    });
    await AsyncStorage.setItem(REGISTERED_INTERVAL_KEY, String(MINIMUM_INTERVAL_MINUTES));
  } catch (_) {
    // Native modules unavailable (Expo Go)
  }
}
