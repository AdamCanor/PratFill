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
  Keyboard,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { STATUSES as FALLBACK_STATUSES } from '../data/statuses';
import { getSettings, saveSettings, getCachedStatuses } from '../api/doch1';
import { colors, spacing, radius } from '../theme';
import { useTheme } from '../context/ThemeContext';

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

export default function SettingsPresetsScreen({ navigation }) {
  const { accentColor, accentTextColor } = useTheme();
  const styles = React.useMemo(() => makeStyles(accentColor, accentTextColor), [accentColor, accentTextColor]);

  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [renamingPresetId, setRenamingPresetId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES);
  const [saving, setSaving] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [modalDay, setModalDay] = useState(null);
  const [modalMain, setModalMain] = useState(null);
  const [modalSelectedSecondary, setModalSelectedSecondary] = useState(null);
  const [modalNote, setModalNote] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      if (s?.weeklyPresets) {
        setPresets(s.weeklyPresets);
      } else if (s?.weeklyDefaults) {
        setPresets([{ id: Date.now().toString(), name: 'ברירת מחדל', weeklyDefaults: s.weeklyDefaults }]);
      } else {
        setPresets([{ id: Date.now().toString(), name: 'ברירת מחדל', weeklyDefaults: {} }]);
      }
      const cached = await getCachedStatuses();
      if (cached && cached.length > 0) setStatuses(cached);
    })();
  }, []);

  const onSave = async () => {
    setSaving(true);
    const current = await getSettings();
    await saveSettings({ ...current, weeklyPresets: presets });
    setSaving(false);
    navigation.goBack();
  };

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

  const openModal = (day) => {
    setModalDay(day);
    setModalMain(null);
    setModalSelectedSecondary(null);
    setModalNote('');
    setModalVisible(true);
  };

  const handleSelectMain = (code) => setModalMain(code);

  const handleSelectSecondary = (secondaryCode) => {
    const note = modalNote.trim();
    updateSelectedPresetDefaults((prev) => ({
      ...prev,
      [modalDay]: { mainCode: modalMain, secondaryCode, ...(note ? { note } : {}) },
    }));
    setModalVisible(false);
    setModalDay(null);
    setModalMain(null);
    setModalSelectedSecondary(null);
    setModalNote('');
  };

  const handleClear = () => {
    updateSelectedPresetDefaults((prev) => ({ ...prev, [modalDay]: null }));
    setModalVisible(false);
    setModalDay(null);
    setModalMain(null);
    setModalSelectedSecondary(null);
    setModalNote('');
  };

  // ── Per-preset day editor ───────────────────────────────────────────
  if (selectedPresetId !== null) {
    const weeklyDefaults = selectedPreset?.weeklyDefaults || {};
    return (
      <View style={styles.container}>
        <View style={styles.editorHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedPresetId(null)}>
            <MaterialCommunityIcons name="arrow-right" size={20} color={accentColor} />
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
          <Text style={styles.sectionTitle}>דיווח שבועי קבוע</Text>
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
                  color={isSet ? accentColor : colors.textMuted}
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
              <ActivityIndicator color={accentTextColor} />
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
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setModalVisible(false)} />
          <View style={[styles.modalSheet, { marginBottom: keyboardHeight }]}>
            <Text style={styles.modalTitle}>
              {modalDay !== null ? `ברירת מחדל — ${DAY_NAMES[modalDay]}` : 'בחר סטטוס'}
            </Text>

            {modalMain === null ? (
              <ScrollView showsVerticalScrollIndicator persistentScrollbar>
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
              <>
                <TouchableOpacity
                  style={styles.modalBack}
                  onPress={() => { setModalMain(null); setModalNote(''); }}
                >
                  <MaterialCommunityIcons name="arrow-right" size={16} color={accentColor} />
                  <Text style={styles.modalBackText}>
                    {statuses.find((s) => s.statusCode === modalMain)?.statusDescription}
                  </Text>
                </TouchableOpacity>
                <ScrollView
                  style={styles.modalSecondaryList}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                  persistentScrollbar
                >
                  {(statuses.find((s) => s.statusCode === modalMain)?.secondaries || []).map((sec) => {
                    const isSelected = modalSelectedSecondary === sec.statusCode;
                    return (
                      <TouchableOpacity
                        key={sec.statusCode}
                        style={[styles.modalOption, isSelected && styles.modalOptionSelected]}
                        onPress={() => setModalSelectedSecondary(sec.statusCode)}
                      >
                        <Text style={[styles.modalOptionText, isSelected && styles.modalOptionTextSelected]}>
                          {sec.statusDescription}
                        </Text>
                        {isSelected && <MaterialCommunityIcons name="check" size={16} color={accentColor} />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <Text style={styles.noteLabel}>הערה (אופציונלי)</Text>
                <TextInput
                  style={styles.noteInput}
                  placeholder="הזן הערה לדיווח הנוכחות"
                  placeholderTextColor={colors.textMuted}
                  value={modalNote}
                  onChangeText={setModalNote}
                  textAlign="right"
                  multiline
                />
                <TouchableOpacity
                  style={[styles.confirmBtn, !modalSelectedSecondary && styles.confirmBtnDisabled]}
                  onPress={() => modalSelectedSecondary && handleSelectSecondary(modalSelectedSecondary)}
                  disabled={!modalSelectedSecondary}
                >
                  <Text style={styles.confirmBtnText}>אשר</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.modalCancel} onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancelText}>ביטול</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }

  // ── Preset list ───────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>תבניות שבועיות</Text>
        {presets.map((preset) => (
          <View key={preset.id} style={styles.presetCard}>
            <TouchableOpacity style={styles.presetCardMain} onPress={() => setSelectedPresetId(preset.id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.presetName}>{preset.name}</Text>
                <Text style={styles.presetMeta}>{countSetDays(preset.weeklyDefaults)} ימים מוגדרים</Text>
              </View>
              <MaterialCommunityIcons name="chevron-left" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            {presets.length > 1 && (
              <TouchableOpacity style={styles.presetDeleteBtn} onPress={() => deletePreset(preset.id)}>
                <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.danger} />
              </TouchableOpacity>
            )}
          </View>
        ))}

        <TouchableOpacity style={styles.addPresetBtn} onPress={addPreset}>
          <MaterialCommunityIcons name="plus" size={18} color={accentColor} />
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
            <ActivityIndicator color={accentTextColor} />
          ) : (
            <Text style={styles.saveBtnText}>שמירה</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (accent, accentText) => StyleSheet.create({
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
  presetName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  presetMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
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
    borderColor: accent,
    borderStyle: 'dashed',
    marginTop: spacing.sm,
  },
  addPresetText: { color: accent, fontSize: 14, fontWeight: '600' },

  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  backBtnText: { color: accent, fontSize: 14 },
  presetNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  editorPresetName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  renameRow: { flex: 1 },
  renameInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },

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
  dayRowActive: { backgroundColor: accent + '22', borderColor: accent },
  dayName: { color: colors.text, fontWeight: '700', fontSize: 15, minWidth: 52 },
  dayLabel: { flex: 1, fontSize: 14, marginHorizontal: spacing.sm },
  dayLabelSet: { color: accent },
  dayLabelUnset: { color: colors.textMuted },

  footer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.bg,
  },
  footerSeparator: { height: 1, backgroundColor: colors.border, marginBottom: spacing.md },
  saveBtn: {
    backgroundColor: accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveBtnText: { color: accentText, fontSize: 16, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
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
  modalBack: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  modalBackText: { color: accent, fontSize: 14 },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOptionSelected: {
    borderColor: accent,
    borderBottomColor: accent,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: 2,
  },
  modalOptionText: { color: colors.text, fontSize: 15 },
  modalOptionTextSelected: { color: accent, fontWeight: '600' },
  modalSecondaryList: { maxHeight: 200, marginBottom: spacing.sm },
  noteLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  noteInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  confirmBtn: {
    backgroundColor: accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { color: accentText, fontSize: 16, fontWeight: '700' },
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
