import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  I18nManager,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { downloadApk, installApk } from '../utils/updates';

I18nManager.forceRTL(true);

export default function UpdateModal({ visible, updateInfo, onDismiss }) {
  const [phase, setPhase] = useState('idle'); // idle | downloading | ready | error
  const [progress, setProgress] = useState(0);
  const [apkUri, setApkUri] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleDownload = async () => {
    setPhase('downloading');
    setProgress(0);
    try {
      const uri = await downloadApk(updateInfo.downloadUrl, setProgress);
      setApkUri(uri);
      setPhase('ready');
    } catch (e) {
      setErrorMsg('ההורדה נכשלה. נסה שוב.');
      setPhase('error');
    }
  };

  const handleInstall = async () => {
    try {
      await installApk(apkUri);
    } catch {
      setErrorMsg('ההתקנה נכשלה. אנא התקן ידנית.');
      setPhase('error');
    }
  };

  const handleClose = () => {
    setPhase('idle');
    setProgress(0);
    setApkUri(null);
    setErrorMsg('');
    onDismiss();
  };

  const fileMb = updateInfo ? (updateInfo.size / 1024 / 1024).toFixed(1) : '0';
  const trimmedNotes = updateInfo?.notes
    ? updateInfo.notes.length > 300
      ? updateInfo.notes.slice(0, 300) + '...'
      : updateInfo.notes
    : '';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <MaterialCommunityIcons
              name="arrow-up-circle"
              size={36}
              color={colors.accent}
            />
          </View>

          <Text style={styles.title}>עדכון זמין</Text>
          <Text style={styles.subtitle}>
            גרסה {updateInfo?.version} מוכנה להתקנה ({fileMb} MB)
          </Text>

          {trimmedNotes ? (
            <ScrollView style={styles.notesScroll} nestedScrollEnabled>
              <Text style={styles.notes}>{trimmedNotes}</Text>
            </ScrollView>
          ) : null}

          {phase === 'downloading' && (
            <View style={styles.progressContainer}>
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]}
                />
              </View>
              <Text style={styles.progressText}>
                {Math.round(progress * 100)}%
              </Text>
            </View>
          )}

          {phase === 'error' && (
            <Text style={styles.errorText}>{errorMsg}</Text>
          )}

          <View style={styles.buttonRow}>
            {phase !== 'downloading' && (
              <TouchableOpacity style={styles.dismissButton} onPress={handleClose}>
                <Text style={styles.dismissText}>לאחר מכן</Text>
              </TouchableOpacity>
            )}

            {(phase === 'idle' || phase === 'error') && (
              <TouchableOpacity style={styles.actionButton} onPress={handleDownload}>
                <Text style={styles.actionText}>
                  {phase === 'error' ? 'נסה שוב' : 'עדכן עכשיו'}
                </Text>
              </TouchableOpacity>
            )}

            {phase === 'downloading' && (
              <TouchableOpacity style={[styles.actionButton, styles.actionButtonDisabled]} disabled>
                <ActivityIndicator size="small" color={colors.accentText} />
                <Text style={[styles.actionText, { marginRight: spacing.xs }]}>מוריד...</Text>
              </TouchableOpacity>
            )}

            {phase === 'ready' && (
              <TouchableOpacity style={styles.actionButton} onPress={handleInstall}>
                <MaterialCommunityIcons name="package-down" size={18} color={colors.accentText} />
                <Text style={[styles.actionText, { marginRight: spacing.xs }]}>התקן</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconRow: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  notesScroll: {
    maxHeight: 140,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  notes: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    writingDirection: 'rtl',
  },
  progressContainer: {
    marginBottom: spacing.md,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  progressText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  dismissButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '500',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  actionButtonDisabled: {
    opacity: 0.7,
  },
  actionText: {
    color: colors.accentText,
    fontSize: 15,
    fontWeight: '700',
  },
});
