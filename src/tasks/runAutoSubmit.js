import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { insertFutureReport, getFutureReports, AuthError } from '../api/doch1';
import { getUpcomingDates, monthsToQuery, normalizeDate } from '../utils/dates';

export const LAST_RUN_KEY = 'doch1_auto_submit_last_run';

export async function getLastAutoSubmitRun() {
  const raw = await AsyncStorage.getItem(LAST_RUN_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function recordLastRun(result) {
  await AsyncStorage.setItem(LAST_RUN_KEY, JSON.stringify({ ...result, at: new Date().toISOString() }));
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

    const result = { count };
    await recordLastRun(result);
    return result;
  } catch (e) {
    await recordLastRun({ error: e instanceof AuthError ? 'auth' : 'error' });
    throw e;
  }
}
