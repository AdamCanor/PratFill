import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  I18nManager,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { STATUSES as FALLBACK_STATUSES } from '../data/statuses';
import { getSettings, saveSettings, getCachedStatuses } from '../api/doch1';
import { colors, spacing, radius } from '../theme';

I18nManager.forceRTL(true);

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function getDayLabel(statuses, defaults, day) {
  const d = defaults[day];
  if (!d) return null;
  const main = statuses.find((s) => s.statusCode === d.mainCode);
  const sec = main?.secondaries.find((s) => s.statusCode === d.secondaryCode);
  return sec ? sec.statusDescription : null;
}

export default function SettingsScreen({ navigation }) {
  const [weeklyDefaults, setWeeklyDefaults] = useState({});
  const [modalDay, setModalDay] = useState(null);
  const [modalMain, setModalMain] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      if (s?.weeklyDefaults) {
        setWeeklyDefaults(s.weeklyDefaults);
      }
      const cached = await getCachedStatuses();
      if (cached && cached.length > 0) setStatuses(cached);
    })();
  }, []);

  const openModal = (day) => {
    setModalDay(day);
    setModalMain(null);
    setModalVisible(true);
  };

  const handleSelectMain = (code) => {
    setModalMain(code);
  };

  const handleSelectSecondary = (secondaryCode) => {
    setWeeklyDefaults((prev) => ({
      ...prev,
      [modalDay]: { mainCode: modalMain, secondaryCode },
    }));
    setModalVisible(false);
    setModalDay(null);
    setModalMain(null);
  };

  const handleClear = () => {
    setWeeklyDefaults((prev) => ({
      ...prev,
      [modalDay]: null,
    }));
    setModalVisible(false);
    setModalDay(null);
    setModalMain(null);
  };

  const onSave = async () => {
    setSaving(true);
    await saveSettings({ weeklyDefaults });
    setSaving(false);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {DAY_NAMES.map((dayName, dayIndex) => {
          const label = getDayLabel(statuses, weeklyDefaults, dayIndex);
          const isSet = !!label;
          return (
            <TouchableOpacity
              key={dayIndex}
              style={[styles.dayRow, isSet && styles.dayRowActive]}
              onPress={() => openModal(dayIndex)}
              activeOpacity={0.7}
            >
              <Text style={styles.dayName}>{dayName}</Text>
              <Text style={[styles.dayLabel, isSet ? styles.dayLabelSet : styles.dayLabelUnset]}>
                {label || 'לא מוגדר'}
              </Text>
              <MaterialCommunityIcons
                name="chevron-left"
                size={20}
                color={isSet ? colors.accent : colors.textMuted}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerSeparator} />
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={onSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.saveBtnText}>שמירה</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>
            {modalDay !== null
              ? `ברירת מחדל — ${DAY_NAMES[modalDay]}`
              : 'בחר סטטוס'}
          </Text>

          {modalMain === null ? (
            // Step 1: pick main status
            <ScrollView>
              {statuses.map((s) => (
                <TouchableOpacity
                  key={s.statusCode}
                  style={styles.modalOption}
                  onPress={() => handleSelectMain(s.statusCode)}
                >
                  <Text style={styles.modalOptionText}>{s.statusDescription}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.modalClearOption} onPress={handleClear}>
                <MaterialCommunityIcons name="close-circle-outline" size={18} color={colors.danger} />
                <Text style={styles.modalClearText}>לא מוגדר / נקה</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            // Step 2: pick secondary
            <ScrollView>
              <TouchableOpacity
                style={styles.modalBack}
                onPress={() => setModalMain(null)}
              >
                <MaterialCommunityIcons name="arrow-right" size={16} color={colors.accent} />
                <Text style={styles.modalBackText}>
                  {statuses.find((s) => s.statusCode === modalMain)?.statusDescription}
                </Text>
              </TouchableOpacity>
              {(statuses.find((s) => s.statusCode === modalMain)?.secondaries || []).map((sec) => (
                <TouchableOpacity
                  key={sec.statusCode}
                  style={styles.modalOption}
                  onPress={() => handleSelectSecondary(sec.statusCode)}
                >
                  <Text style={styles.modalOptionText}>{sec.statusDescription}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity
            style={styles.modalCancel}
            onPress={() => setModalVisible(false)}
          >
            <Text style={styles.modalCancelText}>ביטול</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  dayRowActive: {
    backgroundColor: '#2a2616',
    borderColor: colors.accent,
  },
  dayName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
    minWidth: 52,
    textAlign: 'right',
  },
  dayLabel: {
    flex: 1,
    fontSize: 14,
    textAlign: 'right',
    marginHorizontal: spacing.sm,
  },
  dayLabelSet: {
    color: colors.accent,
  },
  dayLabelUnset: {
    color: colors.textMuted,
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

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: '70%',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  modalBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  modalBackText: { color: colors.accent, fontSize: 14 },
  modalOption: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOptionText: { color: colors.text, fontSize: 15, textAlign: 'right' },
  modalClearOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    justifyContent: 'flex-end',
  },
  modalClearText: { color: colors.danger, fontSize: 15 },
  modalCancel: { marginTop: spacing.md, alignItems: 'center' },
  modalCancelText: { color: colors.danger, fontSize: 15 },
});
