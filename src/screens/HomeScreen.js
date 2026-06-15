import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  getFutureReports,
  insertFutureReport,
  deleteFutureReport,
  getSettings,
  AuthError,
} from '../api/doch1';
import { getSecondaryLabel, STATUSES } from '../data/statuses';
import { getUpcomingDates, monthsToQuery, toApiDate } from '../utils/dates';
import { colors, spacing, radius } from '../theme';

export default function HomeScreen({ navigation }) {
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [reports, setReports] = useState([]); // upcoming reports across queried months
  const [settings, setSettings] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getSettings();
      setSettings(s);

      const upcoming = getUpcomingDates(7);
      const months = monthsToQuery(upcoming);

      const results = await Promise.all(
        months.map((m) => getFutureReports(m.month, m.year))
      );

      // Flatten + filter to only the upcoming 7 days, keep raw entries
      const upcomingApiDates = new Set(upcoming.map((d) => d.apiDate));
      const flat = results
        .flatMap((r) => (Array.isArray(r) ? r : r?.futureReports || r?.data || []))
        .filter((r) => r && upcomingApiDates.has(normalizeDate(r)));

      setReports(flat);
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      Alert.alert('שגיאה', err.message);
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', refresh);
    return unsub;
  }, [navigation, refresh]);

  const onFillWeek = async () => {
    if (!settings?.mainCode || !settings?.secondaryCode) {
      Alert.alert('אין דיווח קבוע', 'יש להגדיר דיווח קבוע בהגדרות לפני המילוי', [
        { text: 'ביטול', style: 'cancel' },
        { text: 'להגדרות', onPress: () => navigation.navigate('Settings') },
      ]);
      return;
    }

    setFilling(true);
    try {
      const upcoming = getUpcomingDates(7);
      const existingDates = new Set(reports.map(normalizeDate));

      const toCreate = upcoming.filter((d) => !existingDates.has(d.apiDate));

      if (toCreate.length === 0) {
        Alert.alert('הכל מוכן', '7 הימים הקרובים כבר מדווחים');
        setFilling(false);
        return;
      }

      for (const d of toCreate) {
        await insertFutureReport({
          mainCode: settings.mainCode,
          secondaryCode: settings.secondaryCode,
          date: d.apiDate,
        });
      }

      Alert.alert('בוצע', `נוספו דיווחים ל-${toCreate.length} ימים`);
      await refresh();
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      Alert.alert('שגיאה בשליחה', err.message);
    } finally {
      setFilling(false);
    }
  };

  const onDelete = async (apiDate) => {
    try {
      await deleteFutureReport(apiDate);
      await refresh();
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      Alert.alert('שגיאה במחיקה', err.message);
    }
  };

  const defaultLabel = settings?.mainCode
    ? describeDefault(settings)
    : 'לא הוגדר';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>דו"ח 1</Text>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <TouchableOpacity onPress={() => navigation.navigate('TestConnection')}>
            <Text style={styles.settingsLink}>Test</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.settingsLink}>הגדרות</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.defaultCard}>
        <Text style={styles.defaultLabel}>דיווח קבוע</Text>
        <Text style={styles.defaultValue}>{defaultLabel}</Text>
      </View>

      <TouchableOpacity
        style={[styles.fillButton, filling && styles.fillButtonDisabled]}
        onPress={onFillWeek}
        disabled={filling}
      >
        {filling ? (
          <ActivityIndicator color={colors.accentText} />
        ) : (
          <Text style={styles.fillButtonText}>מילוי 7 ימים קדימה</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>דיווחים קרובים</Text>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
      ) : (
        <FlatList
          data={getUpcomingDates(7)}
          keyExtractor={(item) => item.apiDate}
          renderItem={({ item }) => {
            const report = reports.find((r) => normalizeDate(r) === item.apiDate);
            return (
              <View style={styles.dayRow}>
                <Text style={styles.dayDate}>{item.apiDate}</Text>
                {report ? (
                  <View style={styles.dayStatus}>
                    <Text style={styles.dayStatusText}>
                      {describeReport(report)}
                    </Text>
                    <TouchableOpacity onPress={() => onDelete(item.apiDate)}>
                      <Text style={styles.deleteLink}>מחיקה</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.dayEmpty}>אין דיווח</Text>
                )}
              </View>
            );
          }}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        />
      )}
    </View>
  );
}

// The exact shape of getFutureReport's response items is unconfirmed -
// adjust normalizeDate/describeReport once a real response is captured.
function normalizeDate(report) {
  return report?.futureReportDate || report?.date || report?.FutureReportDate || '';
}

function describeReport(report) {
  const mainCode = report?.mainCode || report?.MainCode;
  const secCode = report?.secondaryCode || report?.SecondaryCode;
  const sec = getSecondaryLabel(mainCode, secCode);
  return sec ? sec.statusDescription : `${mainCode}/${secCode}`;
}

function describeDefault(settings) {
  const main = STATUSES.find((s) => s.statusCode === settings.mainCode);
  const sec = getSecondaryLabel(settings.mainCode, settings.secondaryCode);
  if (!main || !sec) return 'לא הוגדר';
  return `${main.statusDescription} - ${sec.statusDescription}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerTitle: { color: colors.text, fontSize: 22, fontWeight: '700' },
  settingsLink: { color: colors.accent, fontSize: 15 },
  defaultCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  defaultLabel: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs },
  defaultValue: { color: colors.text, fontSize: 16, fontWeight: '600' },
  fillButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  fillButtonDisabled: { opacity: 0.6 },
  fillButtonText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  sectionTitle: { color: colors.textMuted, fontSize: 14, marginBottom: spacing.sm },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  dayDate: { color: colors.text, fontSize: 14, fontWeight: '600' },
  dayStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayStatusText: { color: colors.success, fontSize: 13 },
  dayEmpty: { color: colors.textMuted, fontSize: 13 },
  deleteLink: { color: colors.danger, fontSize: 13 },
});
