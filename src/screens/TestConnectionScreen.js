import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { getFutureReports, getStoredCookieHeader, hasAppCookie, AuthError, clearCookies } from '../api/doch1';
import { colors, spacing, radius } from '../theme';

export default function TestConnectionScreen({ navigation }) {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);

  const append = (line) => setLog((prev) => [...prev, line]);

  const runTest = async () => {
    setLog([]);
    setRunning(true);
    try {
      append('Checking for AppCookie...');
      const ok = await hasAppCookie();
      if (!ok) {
        append('❌ No AppCookie found. Login first.');
        return;
      }
      append('✅ AppCookie present.');

      const header = await getStoredCookieHeader();
      append(`Cookie header length: ${header.length} chars`);

      const now = new Date();
      append(`Calling getFutureReport(${now.getMonth() + 1}, ${now.getFullYear()})...`);
      const res = await getFutureReports(now.getMonth() + 1, now.getFullYear());
      append('✅ Response received:');
      if (res?.days && res.days.length > 0) {
        append(`✅ ${res.days.length} ימים מדווחים`);
        if (res.minDate) append(`minDate: ${res.minDate}`);
        if (res.maxDate) append(`maxDate: ${res.maxDate}`);
        for (const day of res.days) {
          const iso = day.date || '';
          const ddmm = iso.length >= 10
            ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
            : iso;
          append(`  • ${ddmm} — ${day.secondaryStatusReported || ''} (${day.reportedStatusCode || ''})`);
        }
      } else {
        append(JSON.stringify(res, null, 2).slice(0, 1500));
      }
    } catch (err) {
      if (err instanceof AuthError) {
        append(`❌ AuthError: ${err.message}`);
        append('Cookie is invalid/expired — go to Login.');
      } else {
        append(`❌ Error: ${err.message}`);
      }
    } finally {
      setRunning(false);
    }
  };

  const onClearCookies = async () => {
    await clearCookies();
    append('Cookies cleared.');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Test Connection</Text>

      <TouchableOpacity style={styles.button} onPress={runTest} disabled={running}>
        {running ? (
          <ActivityIndicator color={colors.accentText} />
        ) : (
          <Text style={styles.buttonText}>Run test</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('Login')}>
        <Text style={styles.secondaryButtonText}>Go to Login</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={onClearCookies}>
        <Text style={styles.secondaryButtonText}>Clear cookies</Text>
      </TouchableOpacity>

      <ScrollView style={styles.logBox}>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine} selectable>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: spacing.md },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  buttonText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  secondaryButtonText: { color: colors.text, fontSize: 14 },
  logBox: {
    flex: 1,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  logLine: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: spacing.xs,
  },
});
