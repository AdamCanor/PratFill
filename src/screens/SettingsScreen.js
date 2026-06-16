import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  I18nManager,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { STATUSES } from '../data/statuses';
import { getSettings, saveSettings } from '../api/doch1';
import { colors, spacing, radius } from '../theme';

I18nManager.forceRTL(true);

const STATUS_ICONS = {
  '01': 'shield-outline',
  '02': 'map-marker-outline',
  '04': 'umbrella-beach-outline',
  '05': 'pill',
  '13': 'airplane',
};

export default function SettingsScreen({ navigation }) {
  const [selectedMain, setSelectedMain] = useState(null);
  const [selectedSecondary, setSelectedSecondary] = useState(null);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      if (s?.mainCode) setSelectedMain(s.mainCode);
      if (s?.secondaryCode) setSelectedSecondary(s.secondaryCode);
    })();
  }, []);

  const mainGroup = STATUSES.find((s) => s.statusCode === selectedMain);

  const onSelectMain = (code) => {
    setSelectedMain(code);
    setSelectedSecondary(null);
  };

  const onSave = async () => {
    if (!selectedMain || !selectedSecondary) {
      Alert.alert('יש לבחור סטטוס', 'בחר/י סטטוס ראשי ומשני לפני השמירה');
      return;
    }
    await saveSettings({ mainCode: selectedMain, secondaryCode: selectedSecondary });
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        <Text style={styles.sectionLabel}>סטטוס ראשי</Text>
        <View style={styles.grid}>
          {STATUSES.map((s) => {
            const isActive = selectedMain === s.statusCode;
            return (
              <TouchableOpacity
                key={s.statusCode}
                style={[styles.tile, isActive && styles.tileActive]}
                onPress={() => onSelectMain(s.statusCode)}
              >
                <MaterialCommunityIcons
                  name={STATUS_ICONS[s.statusCode] || 'circle-outline'}
                  size={28}
                  color={isActive ? colors.accent : colors.textMuted}
                  style={styles.tileIcon}
                />
                <Text style={[styles.tileText, isActive && styles.tileTextActive]}>
                  {s.statusDescription}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {mainGroup && (
          <>
            <Text style={styles.sectionLabel}>פירוט</Text>
            <View style={styles.list}>
              {mainGroup.secondaries.map((sec, idx) => {
                const isActive = selectedSecondary === sec.statusCode;
                const isLast = idx === mainGroup.secondaries.length - 1;
                return (
                  <TouchableOpacity
                    key={sec.statusCode}
                    style={[styles.row, !isLast && styles.rowBorder]}
                    onPress={() => setSelectedSecondary(sec.statusCode)}
                  >
                    <Text style={[styles.rowText, isActive && styles.rowTextActive]}>
                      {sec.statusDescription}
                    </Text>
                    {isActive && (
                      <MaterialCommunityIcons
                        name="check"
                        size={18}
                        color={colors.accent}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerSeparator} />
        <TouchableOpacity style={styles.saveBtn} onPress={onSave}>
          <Text style={styles.saveBtnText}>שמירה</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },

  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textAlign: 'right',
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  tileActive: {
    borderColor: colors.accent,
    backgroundColor: '#2a2616',
  },
  tileIcon: { marginBottom: spacing.xs },
  tileText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  tileTextActive: {
    color: colors.accent,
    fontWeight: '700',
  },

  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: {
    color: colors.text,
    fontSize: 15,
    flex: 1,
    textAlign: 'right',
  },
  rowTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },

  footer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.bg,
  },
  footerSeparator: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveBtnText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: '700',
  },
});
