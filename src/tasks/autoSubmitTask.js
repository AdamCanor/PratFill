import { AuthError } from '../api/doch1';
import { runAutoSubmit } from './runAutoSubmit';

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
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'PratFill — נדרשת התחברות',
            body: 'פג תוקף ההתחברות. פתח את האפליקציה כדי לחדש.',
          },
          trigger: null,
        });
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
} catch (_) {
  // Native modules unavailable (Expo Go)
}

export async function registerAutoSubmitTask() {
  try {
    const TaskManager = require('expo-task-manager');
    const BackgroundTask = require('expo-background-task');

    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!isRegistered) {
      await BackgroundTask.registerTaskAsync(TASK_NAME, {
        minimumInterval: 15 * 60,
      });
    }
  } catch (_) {
    // Native modules unavailable (Expo Go)
  }
}
