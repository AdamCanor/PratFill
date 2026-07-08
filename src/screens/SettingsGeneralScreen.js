import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  I18nManager,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getSettings, saveSettings } from '../api/doch1';
import { colors, spacing, radius } from '../theme';
import { useTheme, ACCENT_PRESETS } from '../context/ThemeContext';
import UpdateModal from '../components/UpdateModal';
import { checkForUpdate } from '../utils/updates';

I18nManager.forceRTL(true);

export default function SettingsGeneralScreen({ navigation }) {
  const { accentColor, accentTextColor, setAccent } = useTheme();
  const styles = React.useMemo(() => makeStyles(accentColor, accentTextColor), [accentColor, accentTextColor]);

  const [commanderMode, setCommanderMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [upToDate, setUpToDate] = useState(false);
  const [updateError, setUpdateError] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      if (s?.commanderMode !== undefined) setCommanderMode(s.commanderMode);
    })();
  }, []);

  const handleCheckUpdate = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    setUpToDate(false);
    setUpdateError(false);
    try {
      const info = await checkForUpdate();
      if (info) {
        setUpdateInfo(info);
        setShowUpdateModal(true);
      } else {
        setUpToDate(true);
        setTimeout(() => setUpToDate(false), 3000);
      }
    } catch {
      setUpdateError(true);
      setTimeout(() => setUpdateError(false), 3000);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    const current = await getSettings();
    await saveSettings({ ...current, commanderMode });
    setSaving(false);
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>מצב מפקד</Text>
        <View style={styles.toggleRow}>
          <Switch
            value={commanderMode}
            onValueChange={setCommanderMode}
            trackColor={{ false: colors.border, true: accentColor + '88' }}
            thumbColor={commanderMode ? accentColor : colors.textMuted}
          />
          <View style={{ flex: 1, marginEnd: spacing.sm }}>
            <Text style={styles.rowLabel}>מצב מפקד</Text>
            <Text style={styles.rowMeta}>הצג לשונית ניהול חיילים</Text>
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
                style={[styles.swatch, { backgroundColor: preset.color }, selected && styles.swatchSelected]}
                activeOpacity={0.8}
              >
                {selected && <MaterialCommunityIcons name="check" size={16} color={preset.text} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>כלים</Text>
        <TouchableOpacity style={styles.row} onPress={handleCheckUpdate} activeOpacity={0.7}>
          <View style={{ flex: 1, marginEnd: spacing.sm }}>
            <Text style={styles.rowLabel}>בדוק עדכונים</Text>
            <Text style={[styles.rowMeta, updateError && { color: colors.danger }]}>
              {updateError ? 'שגיאה בבדיקה, נסה שוב' : upToDate ? 'האפליקציה מעודכנת ✓' : 'חפש גרסה חדשה'}
            </Text>
          </View>
          {checkingUpdate ? (
            <ActivityIndicator size="small" color={accentColor} />
          ) : (
            <MaterialCommunityIcons
              name={updateError ? 'alert-circle-outline' : upToDate ? 'check-circle' : 'arrow-up-circle-outline'}
              size={24}
              color={updateError ? colors.danger : upToDate ? colors.success : accentColor}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('TestConnection')} activeOpacity={0.7}>
          <View style={{ flex: 1, marginEnd: spacing.sm }}>
            <Text style={styles.rowLabel}>בדיקת חיבור</Text>
            <Text style={styles.rowMeta}>כלי אבחון להתחברות ולדיווח האוטומטי</Text>
          </View>
          <MaterialCommunityIcons name="chevron-left" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <UpdateModal
          visible={showUpdateModal}
          updateInfo={updateInfo}
          onDismiss={() => setShowUpdateModal(false)}
        />
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
  swatchSelected: { borderWidth: 3, borderColor: '#fff' },

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
});
