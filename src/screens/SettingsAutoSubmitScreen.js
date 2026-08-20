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
  Switch,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getSettings, saveSettings } from '../api/doch1';
import { colors, spacing, radius } from '../theme';
import { useTheme } from '../context/ThemeContext';

I18nManager.forceRTL(true);

export default function SettingsAutoSubmitScreen({ navigation }) {
  const { accentColor, accentTextColor } = useTheme();
  const styles = React.useMemo(() => makeStyles(accentColor, accentTextColor), [accentColor, accentTextColor]);

  const [autoSubmit, setAutoSubmit] = useState({ enabled: false, presetId: '', successNotify: 'daily' });
  const [presets, setPresets] = useState([]);
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  const [notifyModalVisible, setNotifyModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      if (s?.autoSubmit) setAutoSubmit({ successNotify: 'daily', ...s.autoSubmit });
      if (s?.weeklyPresets) setPresets(s.weeklyPresets);
    })();
  }, []);

  const NOTIFY_OPTIONS = [
    { id: 'daily', label: 'כל יום', meta: 'עדכון יומי על מצב השבוע הקרוב' },
    { id: 'weekly', label: 'פעם בשבוע', meta: 'לכל היותר עדכון מצב אחד בשבוע' },
  ];

  const onSave = async () => {
    setSaving(true);
    const current = await getSettings();
    await saveSettings({ ...current, autoSubmit });
    setSaving(false);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>דיווח אוטומטי</Text>

        <View style={styles.toggleRow}>
          <Switch
            value={autoSubmit.enabled}
            onValueChange={(v) => setAutoSubmit((a) => ({ ...a, enabled: v }))}
            trackColor={{ false: colors.border, true: accentColor + '88' }}
            thumbColor={autoSubmit.enabled ? accentColor : colors.textMuted}
          />
          <View style={{ flex: 1, marginEnd: spacing.sm }}>
            <Text style={styles.rowLabel}>דיווח אוטומטי יומי</Text>
            <Text style={styles.rowMeta}>מלא את השבוע הקרוב ברקע לפי תבנית</Text>
          </View>
        </View>

        {autoSubmit.enabled && (
          <>
            <TouchableOpacity
              style={styles.row}
              onPress={() => setPresetModalVisible(true)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1, marginEnd: spacing.sm }}>
                <Text style={styles.rowLabel}>תבנית</Text>
                <Text style={styles.rowMeta}>
                  {presets.find((p) => p.id === autoSubmit.presetId)?.name || 'לא נבחרה'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-left" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.row}
              onPress={() => setNotifyModalVisible(true)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1, marginEnd: spacing.sm }}>
                <Text style={styles.rowLabel}>עדכוני מצב</Text>
                <Text style={styles.rowMeta}>
                  {NOTIFY_OPTIONS.find((o) => o.id === autoSubmit.successNotify)?.label || 'כל יום'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-left" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <Text style={styles.hint}>
              עדכון המצב נשלח בכל הרצה מוצלחת, גם כשכל הימים כבר מדווחים.
              התראה על בעיית התחברות תישלח רק כשהימים המדווחים עומדים להיגמר.
            </Text>
          </>
        )}
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
        visible={presetModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPresetModalVisible(false)}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPresetModalVisible(false)} />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>בחר תבנית לדיווח אוטומטי</Text>
          <ScrollView>
            {presets.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.modalOption, autoSubmit.presetId === p.id && { backgroundColor: accentColor + '22' }]}
                onPress={() => {
                  setAutoSubmit((a) => ({ ...a, presetId: p.id }));
                  setPresetModalVisible(false);
                }}
              >
                <Text style={styles.modalOptionText}>{p.name}</Text>
                {autoSubmit.presetId === p.id && (
                  <MaterialCommunityIcons name="check" size={16} color={accentColor} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.modalCancel} onPress={() => setPresetModalVisible(false)}>
            <Text style={styles.modalCancelText}>ביטול</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        visible={notifyModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setNotifyModalVisible(false)}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setNotifyModalVisible(false)} />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>תדירות עדכוני מצב</Text>
          {NOTIFY_OPTIONS.map((o) => (
            <TouchableOpacity
              key={o.id}
              style={[styles.modalOption, autoSubmit.successNotify === o.id && { backgroundColor: accentColor + '22' }]}
              onPress={() => {
                setAutoSubmit((a) => ({ ...a, successNotify: o.id }));
                setNotifyModalVisible(false);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.modalOptionText}>{o.label}</Text>
                <Text style={styles.rowMeta}>{o.meta}</Text>
              </View>
              {autoSubmit.successNotify === o.id && (
                <MaterialCommunityIcons name="check" size={16} color={accentColor} />
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.modalCancel} onPress={() => setNotifyModalVisible(false)}>
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
  hint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs, paddingHorizontal: spacing.xs, lineHeight: 17 },

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
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOptionText: { color: colors.text, fontSize: 15 },
  modalCancel: { marginTop: spacing.md, alignItems: 'center' },
  modalCancelText: { color: colors.danger, fontSize: 15 },
});
