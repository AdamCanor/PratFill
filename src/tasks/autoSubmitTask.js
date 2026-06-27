import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import { AuthError } from '../api/doch1';
import { runAutoSubmit } from './runAutoSubmit';

export const TASK_NAME = 'auto-submit-reports';
export { runAutoSubmit };

try {
  TaskManager.defineTask(TASK_NAME, async () => {
    try {
      const result = await runAutoSubmit();
      if (result.skipped) return BackgroundFetch.BackgroundFetchResult.NoData;
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (e) {
      if (e instanceof AuthError) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'PratFill — נדרשת התחברות',
            body: 'פג תוקף ההתחברות. פתח את האפליקציה כדי לחדש.',
          },
          trigger: null,
        });
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
} catch (_) {
  // Native module unavailable (Expo Go)
}

export async function registerAutoSubmitTask() {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      return;
    }
    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(TASK_NAME, {
        minimumInterval: 15 * 60,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch (_) {
    // Native module unavailable (Expo Go)
  }
}
