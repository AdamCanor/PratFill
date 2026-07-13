import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  I18nManager,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getSettings, saveSettings } from '../api/doch1';
import { runAutoSubmit, getLastAutoSubmitRun } from '../tasks/runAutoSubmit';
import { colors, spacing, radius } from '../theme';
import { useTheme } from '../context/ThemeContext';

I18nManager.forceRTL(true);

function describeLastRun(lastRun) {
  if (!lastRun) return 'טרם בוצעה הרצה';
  const time = new Date(lastRun.at).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (lastRun.error === 'auth') return `${time} — נדרשת התחברות מחדש`;
  if (lastRun.error) return `${time} — שגיאה`;
  if (lastRun.skipped) return `${time} — לא בוצעה פעולה (${lastRun.reason})`;
  if (lastRun.count > 0) return `${time} — נוספו דיווחים ל-${lastRun.count} ימים`;
  return `${time} — כל הימים כבר מדווחים`;
}

export default function SettingsDevScreen({ navigation }) {
  const { accentColor } = useTheme();
  const styles = React.useMemo(() => makeStyles(accentColor), [accentColor]);

  const [runningNow, setRunningNow] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    (async () => {
      setLastRun(await getLastAutoSubmitRun());
    })();
  }, []);

  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      const current = await getSettings();
      await saveSettings({ ...current });
      await runAutoSubmit();
    } catch {
    } finally {
      setLastRun(await getLastAutoSubmitRun());
      setRunningNow(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>דיווח אוטומטי</Text>
        <TouchableOpacity
          style={styles.row}
          onPress={handleRunNow}
          disabled={runningNow}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1, marginEnd: spacing.sm }}>
            <Text style={styles.rowLabel}>הרץ עכשיו</Text>
            <Text style={styles.rowMeta}>{describeLastRun(lastRun)}</Text>
          </View>
          {runningNow ? (
            <ActivityIndicator size="small" color={accentColor} />
          ) : (
            <MaterialCommunityIcons name="play-circle-outline" size={24} color={accentColor} />
          )}
        </TouchableOpacity>

        {lastRun?.diagnostics && (
          <TouchableOpacity
            style={styles.row}
            onPress={() => setShowDiagnostics((v) => !v)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1, marginEnd: spacing.sm }}>
              <Text style={styles.rowLabel}>פרטי אבחון להרצה האחרונה</Text>
              {showDiagnostics && (
                <Text style={styles.diagnosticsText} selectable>
                  {JSON.stringify(lastRun.diagnostics, null, 2)}
                </Text>
              )}
            </View>
            <MaterialCommunityIcons
              name={showDiagnostics ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        )}

        <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>אבחון</Text>
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('TestConnection')}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1, marginEnd: spacing.sm }}>
            <Text style={styles.rowLabel}>בדיקת חיבור</Text>
            <Text style={styles.rowMeta}>כלי אבחון להתחברות ולדיווח האוטומטי</Text>
          </View>
          <MaterialCommunityIcons name="chevron-left" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const makeStyles = (accent) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },

  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  diagnosticsText: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: spacing.xs,
  },
});
