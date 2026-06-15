import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import { STATUSES, iconUri } from '../data/statuses';
import { getSettings, saveSettings } from '../api/doch1';
import { colors, spacing, radius } from '../theme';

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
    Alert.alert('נשמר', 'הדיווח הקבוע נשמר בהצלחה');
    navigation.goBack();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>איפה תהיו ברירת המחדל?</Text>
      <Text style={styles.subtitle}>בחר/י סטטוס ראשי</Text>

      <View style={styles.grid}>
        {STATUSES.map((s) => (
          <TouchableOpacity
            key={s.statusCode}
            style={[
              styles.tile,
              selectedMain === s.statusCode && styles.tileSelected,
            ]}
            onPress={() => onSelectMain(s.statusCode)}
          >
            <Image
              source={{ uri: iconUri(s.icon) }}
              style={styles.tileIcon}
              resizeMode="contain"
            />
            <Text
              style={[
                styles.tileText,
                selectedMain === s.statusCode && styles.tileTextSelected,
              ]}
            >
              {s.statusDescription}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {mainGroup && (
        <>
          <Text style={styles.subtitle}>בחר/י פירוט</Text>
          <View style={styles.list}>
            {mainGroup.secondaries.map((sec) => (
              <TouchableOpacity
                key={sec.statusCode}
                style={[
                  styles.row,
                  selectedSecondary === sec.statusCode && styles.rowSelected,
                ]}
                onPress={() => setSelectedSecondary(sec.statusCode)}
              >
                <Text
                  style={[
                    styles.rowText,
                    selectedSecondary === sec.statusCode && styles.rowTextSelected,
                  ]}
                >
                  {sec.statusDescription}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <TouchableOpacity style={styles.saveButton} onPress={onSave}>
        <Text style={styles.saveButtonText}>שמירה</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: 'right',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
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
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  tileIcon: {
    width: 36,
    height: 36,
    marginBottom: spacing.xs,
    tintColor: colors.text,
  },
  tileSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  tileText: {
    color: colors.text,
    fontSize: 14,
    textAlign: 'center',
  },
  tileTextSelected: {
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
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowSelected: {
    backgroundColor: colors.surfaceAlt,
  },
  rowText: {
    color: colors.text,
    fontSize: 15,
    textAlign: 'right',
  },
  rowTextSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  saveButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveButtonText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: '700',
  },
});
