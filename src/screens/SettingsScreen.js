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
  TextInput,
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

function countSetDays(weeklyDefaults) {
  return Object.values(weeklyDefaults || {}).filter(Boolean).length;
}

export default function SettingsScreen({ navigation }) {
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [renamingPresetId, setRenamingPresetId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const [modalDay, setModalDay] = useState(null);
  const [modalMain, setModalMain] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      if (s?.weeklyPresets) {
        setPresets(s.weeklyPresets);
      } else if (s?.weeklyDefaults) {
        const migrated = [{ id: Date.now().toString(), name: 'ברירת מחדל', weeklyDefaults: s.weeklyDefaults }];
        setPresets(migrated);
      }
      const cached = await getCachedStatuses();
      if (cached && cached.length > 0) setStatuses(cached);
    })();
  }, []);

  const selectedPreset = presets.find((p) => p.id === selectedPresetId) || null;

  const updateSelectedPresetDefaults = (updater) => {
    setPresets((prev) =>
      prev.map((p) =>
        p.id === selectedPresetId
          ? { ...p, weeklyDefaults: updater(p.weeklyDefaults || {}) }
          : p
      )
    );
  };

  const openModal = (day) => {
    setModalDay(day);
    setModalMain(null);
    setModalVisible(true);
  };

  const handleSelectMain = (code) => {
    setModalMain(code);
  };

  const handleSelectSecondary = (secondaryCode) => {
    updateSelectedPresetDefaults((prev) => ({
      ...prev,
      [modalDay]: { mainCode: modalMain, secondaryCode },
    }));
    setModalVisible(false);
    setModalDay(null);
    setModalMain(null);
  };

  const handleClear = () => {
    updateSelectedPresetDefaults((prev) => ({
      ...prev,
      [modalDay]: null,
    }));
    setModalVisible(false);
    setModalDay(null);
    setModalMain(null);
  };

  const onSave = async () => {
    setSaving(true);
    await saveSettings({ weeklyPresets: presets });
    setSaving(false);
    navigation.goBack();
  };

  const addPreset = () => {
    const id = Date.now().toString();
    const newPreset = { id, name: 'תבנית חדשה', weeklyDefaults: {} };
    setPresets((prev) => [...prev, newPreset]);
    setSelectedPresetId(id);
  };

  const deletePreset = (id) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  const startRename = (preset) => {
    setRenamingPresetId(preset.id);
    setRenameValue(preset.name);
  };

  const commitRename = () => {
    if (renamingPresetId) {
      setPresets((prev) =>
        prev.map((p) => (p.id === renamingPresetId ? { ...p, name: renameValue } : p))
      );
    }
    setRenamingPresetId(null);
    setRenameValue('');
  };

  // ── Preset list view ──────────────────────────────────────────────────────
  if (selectedPresetId === null) {
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>תבניות שבועיות</Text>
          {presets.map((preset) => (
            <View key={preset.id} style={styles.presetCard}>
              <TouchableOpacity style={styles.presetCardMain} onPress={() => setSelectedPresetId(preset.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.presetName}>{preset.name}</Text>
                  <Text style={styles.presetMeta}>
                    {countSetDays(preset.weeklyDefaults)} ימים מוגדרים
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-left" size={20} color={colors.textMuted} />
              </TouchableOpacity>
              {presets.length > 1 && (
                <TouchableOpacity
                  style={styles.presetDeleteBtn}
                  onPress={() => deletePreset(preset.id)}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.danger} />
                </TouchableOpacity>
              )}
            </View>
          ))}

          <TouchableOpacity style={styles.addPresetBtn} onPress={addPreset}>
            <MaterialCommunityIcons name="plus" size={18} color={colors.accent} />
            <Text style={styles.addPresetText}>הוסף תבנית</Text>
          </TouchableOpacity>
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
      </View>
    );
  }

  // ── Per-day editor view ───────────────────────────────────────────────────
  const weeklyDefaults = selectedPreset?.weeklyDefaults || {};

  return (
    <View style={styles.container}>
      {/* Back header */}
      <View style={styles.editorHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedPresetId(null)}>
          <MaterialCommunityIcons name="arrow-right" size={20} color={colors.accent} />
          <Text style={styles.backBtnText}>תבניות</Text>
        </TouchableOpacity>

        {renamingPresetId === selectedPresetId ? (
          <View style={styles.renameRow}>
            <TextInput
              style={styles.renameInput}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              textAlign="right"
              onSubmitEditing={commitRename}
              onBlur={commitRename}
            />
          </View>
        ) : (
          <TouchableOpacity style={styles.presetNameRow} onPress={() => startRename(selectedPreset)}>
            <Text style={styles.editorPresetName}>{selectedPreset?.name}</Text>
            <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.textMuted} style={{ marginStart: spacing.xs }} />
          </TouchableOpacity>
        )}
      </View>

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

  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
    marginBottom: spacing.md,
  },

  // preset list
  presetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  presetCardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  presetName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
  },
  presetMeta: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    marginTop: 2,
  },
  presetDeleteBtn: {
    padding: spacing.md,
    borderStartWidth: 1,
    borderStartColor: colors.border,
  },

  addPresetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    borderStyle: 'dashed',
    marginTop: spacing.sm,
  },
  addPresetText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },

  // editor header
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backBtnText: { color: colors.accent, fontSize: 14 },
  presetNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  editorPresetName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  renameRow: { flex: 1 },
  renameInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },

  // day rows
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
