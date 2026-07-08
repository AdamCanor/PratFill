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
import { useTheme } from '../context/ThemeContext';

I18nManager.forceRTL(true);

const DEFAULT_QUICK_BUTTONS = [
  { label: 'בסיס', mainCode: '01', secondaryCode: '01' },
  { label: 'אחרי תורנות / משמרת', mainCode: '02', secondaryCode: '09' },
];

export default function SettingsQuickButtonsScreen({ navigation }) {
  const { accentColor, accentTextColor } = useTheme();
  const styles = React.useMemo(() => makeStyles(accentColor, accentTextColor), [accentColor, accentTextColor]);

  const [quickButtons, setQuickButtons] = useState(DEFAULT_QUICK_BUTTONS);
  const [quickModalIndex, setQuickModalIndex] = useState(null);
  const [quickModalMain, setQuickModalMain] = useState(null);
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      if (s?.quickButtons?.length === 2) setQuickButtons(s.quickButtons);
      const cached = await getCachedStatuses();
      if (cached && cached.length > 0) setStatuses(cached);
    })();
  }, []);

  const openQuickModal = (index) => {
    setQuickModalIndex(index);
    setQuickModalMain(null);
  };

  const handleQuickSelectSecondary = (sec) => {
    setQuickButtons((prev) => {
      const updated = [...prev];
      updated[quickModalIndex] = {
        label: sec.statusDescription,
        mainCode: quickModalMain,
        secondaryCode: sec.statusCode,
      };
      return updated;
    });
    setQuickModalIndex(null);
    setQuickModalMain(null);
  };

  const onSave = async () => {
    setSaving(true);
    const current = await getSettings();
    await saveSettings({ ...current, quickButtons });
    setSaving(false);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>כפתורים מהירים</Text>
        <Text style={styles.sectionMeta}>
          שני כפתורים המוצגים במסך הבית למילוי מהיר בלחיצה אחת
        </Text>
        {quickButtons.map((btn, i) => (
          <TouchableOpacity
            key={i}
            style={styles.row}
            onPress={() => openQuickModal(i)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1, marginEnd: spacing.sm }}>
              <Text style={styles.rowLabel}>כפתור {i + 1}</Text>
              <View style={[styles.chip, { backgroundColor: accentColor + '22', borderColor: accentColor }]}>
                <Text style={[styles.chipText, { color: accentColor }]}>{btn.label}</Text>
              </View>
            </View>
            <MaterialCommunityIcons name="chevron-left" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
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

const makeStyles = (accent, accentText) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },

  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionMeta: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.md,
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
  },
  rowLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipText: { fontSize: 14, fontWeight: '600' },

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
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOptionText: { color: colors.text, fontSize: 15 },
  modalCancel: { marginTop: spacing.md, alignItems: 'center' },
  modalCancelText: { color: colors.danger, fontSize: 15 },
});
