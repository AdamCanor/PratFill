import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  I18nManager,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getSettings } from '../api/doch1';
import { colors, spacing, radius } from '../theme';
import { useTheme } from '../context/ThemeContext';

I18nManager.forceRTL(true);

function countSetDays(weeklyDefaults) {
  return Object.values(weeklyDefaults || {}).filter(Boolean).length;
}

export default function SettingsScreen({ navigation }) {
  const { accentColor } = useTheme();
  const styles = React.useMemo(() => makeStyles(accentColor), [accentColor]);

  const [summary, setSummary] = useState({
    presetCount: 0,
    totalDays: 0,
    quickBtn1: '',
    quickBtn2: '',
    autoSubmitEnabled: false,
    commanderMode: false,
    devSettingsEnabled: false,
  });

  const loadSummary = useCallback(async () => {
    const s = await getSettings();
    if (!s) return;
    const presets = s.weeklyPresets || [];
    const totalDays = presets.reduce((acc, p) => acc + countSetDays(p.weeklyDefaults), 0);
    const qb = s.quickButtons || [];
    setSummary({
      presetCount: presets.length,
      totalDays,
      quickBtn1: qb[0]?.label || '',
      quickBtn2: qb[1]?.label || '',
      autoSubmitEnabled: s.autoSubmit?.enabled || false,
      commanderMode: s.commanderMode || false,
      devSettingsEnabled: s.devSettingsEnabled || false,
    });
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useFocusEffect(useCallback(() => { loadSummary(); }, [loadSummary]));

  const NavRow = ({ icon, label, meta, onPress }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.iconWrap, { backgroundColor: accentColor + '22' }]}>
        <MaterialCommunityIcons name={icon} size={20} color={accentColor} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      </View>
      <MaterialCommunityIcons name="chevron-left" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>דיווח</Text>
        <NavRow
          icon="calendar-week"
          label="תבניות שבועיות"
          meta={summary.presetCount > 0 ? `${summary.presetCount} תבניות, ${summary.totalDays} ימים מוגדרים` : null}
          onPress={() => navigation.navigate('SettingsPresets')}
        />
        <NavRow
          icon="lightning-bolt"
          label="כפתורים מהירים"
          meta={summary.quickBtn1 ? `${summary.quickBtn1} · ${summary.quickBtn2}` : null}
          onPress={() => navigation.navigate('SettingsQuickButtons')}
        />
        <NavRow
          icon="robot-outline"
          label="דיווח אוטומטי"
          meta={summary.autoSubmitEnabled ? 'מופעל' : 'כבוי'}
          onPress={() => navigation.navigate('SettingsAutoSubmit')}
        />

        <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>כללי</Text>
        <NavRow
          icon="cog-outline"
          label="כללי ומראה"
          meta={summary.commanderMode ? 'מצב מפקד פעיל' : null}
          onPress={() => navigation.navigate('SettingsGeneral')}
        />
        {summary.devSettingsEnabled && (
          <NavRow
            icon="wrench-outline"
            label="כלי פיתוח"
            meta="בדיקת חיבור, הרצה ידנית"
            onPress={() => navigation.navigate('SettingsDev')}
          />
        )}
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
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
