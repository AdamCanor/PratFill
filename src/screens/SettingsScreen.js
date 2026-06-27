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
  Switch,
  Keyboard,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { STATUSES as FALLBACK_STATUSES } from '../data/statuses';
import { getSettings, saveSettings, getCachedStatuses } from '../api/doch1';
import { colors, spacing, radius } from '../theme';
import { useTheme, ACCENT_PRESETS } from '../context/ThemeContext';
import { runAutoSubmit } from '../tasks/autoSubmitTask';

I18nManager.forceRTL(true);

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const DEFAULT_QUICK_BUTTONS = [
  { label: 'בסיס', mainCode: '01', secondaryCode: '01' },
  { label: 'אחרי תורנות / משמרת', mainCode: '02', secondaryCode: '09' },
];

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
  const { accentColor, accentTextColor, setAccent } = useTheme();
  const styles = React.useMemo(() => makeStyles(accentColor, accentTextColor), [accentColor, accentTextColor]);

  const [commanderMode, setCommanderMode] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState({ enabled: false, presetId: '', time: '09:00' });
  const [autoPresetModalVisible, setAutoPresetModalVisible] = useState(false);
  const [testingAutoSubmit, setTestingAutoSubmit] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [quickButtons, setQuickButtons] = useState(DEFAULT_QUICK_BUTTONS);
  const [quickModalIndex, setQuickModalIndex] = useState(null);
  const [quickModalMain, setQuickModalMain] = useState(null);

  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [renamingPresetId, setRenamingPresetId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const [modalDay, setModalDay] = useState(null);
  const [modalMain, setModalMain] = useState(null);
  const [modalSelectedSecondary, setModalSelectedSecondary] = useState(null);
  const [modalNote, setModalNote] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      if (s?.commanderMode !== undefined) setCommanderMode(s.commanderMode);
      if (s?.quickButtons?.length === 2) setQuickButtons(s.quickButtons);
      if (s?.autoSubmit) setAutoSubmit(s.autoSubmit);
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
    setModalSelectedSecondary(null);
    setModalNote('');
    setModalVisible(true);
  };

  const handleSelectMain = (code) => {
    setModalMain(code);
  };

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
    updateSelectedPresetDefaults((prev) => ({
      ...prev,
      [modalDay]: null,
    }));
    setModalVisible(false);
    setModalDay(null);
    setModalMain(null);
    setModalSelectedSecondary(null);
    setModalNote('');
  };

  const onSave = async () => {
    setSaving(true);
    await saveSettings({ weeklyPresets: presets, quickButtons, commanderMode, autoSubmit });
    setSaving(false);
    navigation.goBack();
  };

  const openQuickModal = (index) => {
    setQuickModalIndex(index);
    setQuickModalMain(null);
  };

  const handleQuickSelectSecondary = (sec) => {
    setQuickButtons((prev) => {
      const updated = [...prev];
      updated[quickModalIndex] = { label: sec.statusDescription, mainCode: quickModalMain, secondaryCode: sec.statusCode };
      return updated;
    });
    setQuickModalIndex(null);
    setQuickModalMain(null);
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
            <MaterialCommunityIcons name="plus" size={18} color={accentColor} />
            <Text style={styles.addPresetText}>הוסף תבנית</Text>
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>כפתורים מהירים</Text>
          {quickButtons.map((btn, i) => (
            <TouchableOpacity
              key={i}
              style={styles.quickBtnRow}
              onPress={() => openQuickModal(i)}
              activeOpacity={0.7}
            >
              <View style={[styles.quickBtnChip, { backgroundColor: accentColor + '22', borderColor: accentColor }]}>
                <Text style={[styles.quickBtnChipText, { color: accentColor }]}>{btn.label}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-left" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}

          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>דיווח אוטומטי</Text>
          <View style={styles.toggleRow}>
            <Switch
              value={autoSubmit.enabled}
              onValueChange={(v) => setAutoSubmit((a) => ({ ...a, enabled: v }))}
              trackColor={{ false: colors.border, true: accentColor + '88' }}
              thumbColor={autoSubmit.enabled ? accentColor : colors.textMuted}
            />
            <View style={{ flex: 1, marginEnd: spacing.sm }}>
              <Text style={styles.toggleLabel}>דיווח אוטומטי יומי</Text>
              <Text style={styles.toggleMeta}>מלא את השבוע הקרוב ברקע לפי תבנית</Text>
            </View>
          </View>
          {autoSubmit.enabled && (
            <>
              <TouchableOpacity
                style={styles.quickBtnRow}
                onPress={() => setAutoPresetModalVisible(true)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1, marginEnd: spacing.sm }}>
                  <Text style={styles.toggleLabel}>תבנית</Text>
                  <Text style={styles.toggleMeta}>
                    {presets.find((p) => p.id === autoSubmit.presetId)?.name || 'לא נבחרה'}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-left" size={18} color={colors.textMuted} />
              </TouchableOpacity>
              <View style={styles.quickBtnRow}>
                <View style={{ flex: 1, marginEnd: spacing.sm }}>
                  <Text style={styles.toggleLabel}>שעת דיווח (HH:MM)</Text>
                  <Text style={styles.toggleMeta}>הדיווח יתבצע בחלון של ±30 דקות מהשעה</Text>
                </View>
                <TextInput
                  style={styles.timeInput}
                  value={autoSubmit.time}
                  onChangeText={(v) => setAutoSubmit((a) => ({ ...a, time: v }))}
                  placeholder="09:00"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </View>
              <TouchableOpacity
                style={[styles.testAutoBtn, testingAutoSubmit && { opacity: 0.6 }]}
                disabled={testingAutoSubmit}
                onPress={async () => {
                  setTestingAutoSubmit(true);
                  setTestResult(null);
                  try {
                    const result = await runAutoSubmit({ skipTimeCheck: true });
                    if (result.skipped) setTestResult(`דולג: ${result.reason}`);
                    else if (result.count === 0) setTestResult('אין ימים חדשים למילוי');
                    else setTestResult(`✓ נשלח ל-${result.count} ימים — בדוק את ההתראות`);
                  } catch (e) {
                    setTestResult(`שגיאה: ${e.message}`);
                  } finally {
                    setTestingAutoSubmit(false);
                  }
                }}
              >
                {testingAutoSubmit ? (
                  <ActivityIndicator size="small" color={accentTextColor} />
                ) : (
                  <Text style={styles.testAutoBtnText}>בדיקת דיווח אוטומטי עכשיו</Text>
                )}
              </TouchableOpacity>
              {testResult ? (
                <Text style={styles.testResultText}>{testResult}</Text>
              ) : null}
            </>
          )}

          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>כללי</Text>
          <View style={styles.toggleRow}>
            <Switch
              value={commanderMode}
              onValueChange={setCommanderMode}
              trackColor={{ false: colors.border, true: accentColor + '88' }}
              thumbColor={commanderMode ? accentColor : colors.textMuted}
            />
            <View style={{ flex: 1, marginEnd: spacing.sm }}>
              <Text style={styles.toggleLabel}>מצב מפקד</Text>
              <Text style={styles.toggleMeta}>הצג לשונית ניהול חיילים</Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>צבע ראשי</Text>
          <View style={styles.swatchRow}>
            {ACCENT_PRESETS.map((preset, i) => {
              const selected = accentColor === preset.color;
              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => setAccent(preset)}
                  style={[
                    styles.swatch,
                    { backgroundColor: preset.color },
                    selected && styles.swatchSelected,
                  ]}
                  activeOpacity={0.8}
                >
                  {selected && (
                    <MaterialCommunityIcons name="check" size={16} color={preset.text} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
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

        {/* Auto-submit preset picker modal */}
        <Modal
          visible={autoPresetModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setAutoPresetModalVisible(false)}
        >
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setAutoPresetModalVisible(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>בחר תבנית לדיווח אוטומטי</Text>
            <ScrollView>
              {presets.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.modalOption, autoSubmit.presetId === p.id && { backgroundColor: accentColor + '22' }]}
                  onPress={() => {
                    setAutoSubmit((a) => ({ ...a, presetId: p.id }));
                    setAutoPresetModalVisible(false);
                  }}
                >
                  <Text style={styles.modalOptionText}>{p.name}</Text>
                  {autoSubmit.presetId === p.id && (
                    <MaterialCommunityIcons name="check" size={16} color={accentColor} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setAutoPresetModalVisible(false)}>
              <Text style={styles.modalCancelText}>ביטול</Text>
            </TouchableOpacity>
          </View>
        </Modal>

        {/* Quick button picker modal (list view) */}
        <Modal
          visible={quickModalIndex !== null}
          transparent
          animationType="slide"
          onRequestClose={() => setQuickModalIndex(null)}
        >
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setQuickModalIndex(null)} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {quickModalIndex !== null ? `כפתור ${quickModalIndex + 1}` : ''}
            </Text>
            {quickModalMain === null ? (
              <ScrollView>
                {statuses.map((s) => (
                  <TouchableOpacity
                    key={s.statusCode}
                    style={styles.modalOption}
                    onPress={() => setQuickModalMain(s.statusCode)}
                  >
                    <Text style={styles.modalOptionText}>{s.statusDescription}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <ScrollView>
                <TouchableOpacity
                  style={styles.modalBack}
                  onPress={() => setQuickModalMain(null)}
                >
                  <MaterialCommunityIcons name="arrow-right" size={16} color={accentColor} />
                  <Text style={styles.modalBackText}>
                    {statuses.find((s) => s.statusCode === quickModalMain)?.statusDescription}
                  </Text>
                </TouchableOpacity>
                {(statuses.find((s) => s.statusCode === quickModalMain)?.secondaries || []).map((sec) => (
                  <TouchableOpacity
                    key={sec.statusCode}
                    style={styles.modalOption}
                    onPress={() => handleQuickSelectSecondary(sec)}
                  >
                    <Text style={styles.modalOptionText}>{sec.statusDescription}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setQuickModalIndex(null)}>
              <Text style={styles.modalCancelText}>ביטול</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }

  // ── Per-day editor view ───────────────────────────────────────────────────
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
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        />
        <View style={[styles.modalSheet, { marginBottom: keyboardHeight }]}>
          <Text style={styles.modalTitle}>
            {modalDay !== null
              ? `ברירת מחדל — ${DAY_NAMES[modalDay]}`
              : 'בחר סטטוס'}
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
                      {isSelected && (
                        <MaterialCommunityIcons name="check" size={16} color={accentColor} />
                      )}
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
  },
  presetMeta: {
    color: colors.textMuted,
    fontSize: 12,
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
    borderColor: accent,
    borderStyle: 'dashed',
    marginTop: spacing.sm,
  },
  addPresetText: {
    color: accent,
    fontSize: 14,
    fontWeight: '600',
  },

  // quick buttons
  quickBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  quickBtnChip: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  quickBtnChipText: { fontSize: 14, fontWeight: '600' },

  // commander toggle
  toggleRow: {
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
  toggleLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  toggleMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },

  testAutoBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  testAutoBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  testResultText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  timeInput: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    minWidth: 72,
    textAlign: 'center',
    backgroundColor: colors.card,
  },

  // accent color swatches
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#fff',
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
  backBtnText: { color: accent, fontSize: 14 },
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
    borderColor: accent,
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
    backgroundColor: accent + '22',
    borderColor: accent,
  },
  dayName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
    minWidth: 52,
  },
  dayLabel: {
    flex: 1,
    fontSize: 14,
    marginHorizontal: spacing.sm,
  },
  dayLabelSet: {
    color: accent,
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
    backgroundColor: accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveBtnText: {
    color: accentText,
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
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: 2,
  },
  modalOptionText: { color: colors.text, fontSize: 15 },
  modalOptionTextSelected: { color: accent, fontWeight: '600' },
  modalSecondaryList: {
    maxHeight: 200,
    marginBottom: spacing.sm,
  },
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
