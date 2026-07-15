import { AuthError } from '../api/doch1';
import { runAutoSubmit, shouldNotifyAuthFailure, markAuthFailureNotified } from './runAutoSubmit';

export const TASK_NAME = 'auto-submit-reports';
export { runAutoSubmit };

try {
  const TaskManager = require('expo-task-manager');
  const BackgroundTask = require('expo-background-task');
  const Notifications = require('expo-notifications');

  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      const result = await runAutoSubmit();
      if (result.skipped) return BackgroundTask.BackgroundTaskResult.Success;
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (e) {
      if (e instanceof AuthError) {
        // Per the session model documented in doch1.js, AppCookie dies ~5h
        // after every login and no headless request can revive it, so a
        // background AuthError is the expected state between app opens —
        // not itself an emergency. Opening the app recovers silently
        // (hidden-WebView refresh + catch-up run), so only nag when the
        // filled window is about to run out, and only once per
        // cookie-death.
        if (await shouldNotifyAuthFailure()) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: 'PratFill — נדרשת התחברות',
              body: 'פג תוקף ההתחברות. פתח את האפליקציה כדי לחדש.',
            },
            trigger: null,
          });
          await markAuthFailureNotified();
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
// 12h) — the previous 15 * 60 here meant 900 minutes (~15h), written as if
// the unit were seconds. AppCookie is only valid ~5h after each app open, so
// fires must be frequent enough to land inside that window; the OS treats
// this as a minimum, not a schedule.
const MINIMUM_INTERVAL_MINUTES = 120;
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
