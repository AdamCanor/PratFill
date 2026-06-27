import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { insertFutureReport, getFutureReports, AuthError } from '../api/doch1';
import { getUpcomingDates, monthsToQuery, normalizeDate } from '../utils/dates';

export const TASK_NAME = 'auto-submit-reports';

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const raw = await AsyncStorage.getItem('doch1_settings');
    const settings = raw ? JSON.parse(raw) : null;
    const { enabled, presetId, time } = settings?.autoSubmit ?? {};
    if (!enabled || !presetId || !time) return BackgroundFetch.BackgroundFetchResult.NoData;

    const [hh, mm] = time.split(':').map(Number);
    const now = new Date();
    const scheduled = new Date();
    scheduled.setHours(hh, mm, 0, 0);
    if (Math.abs(now - scheduled) > 30 * 60 * 1000) return BackgroundFetch.BackgroundFetchResult.NoData;

    const preset = settings.weeklyPresets?.find((p) => p.id === presetId);
    if (!preset) return BackgroundFetch.BackgroundFetchResult.NoData;

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

export async function registerAutoSubmitTask() {
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
}
