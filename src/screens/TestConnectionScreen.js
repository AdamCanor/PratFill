import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { getFutureReports, getStoredCookieHeader, hasAppCookie, AuthError, clearCookies, attemptSilentReauth, COOKIE_DOMAIN } from '../api/doch1';
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
      append(JSON.stringify(res, null, 2).slice(0, 1500));
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

  const onDeleteAppCookieOnly = async () => {
    setLog([]);
    try {
      await CookieManager.set(COOKIE_DOMAIN, {
        name: 'AppCookie',
        value: '',
        expires: '1970-01-01T00:00:00.000Z',
      });
      append('AppCookie expired — other cookies untouched.');
      append(`AppCookie present now: ${await hasAppCookie()}`);
    } catch (err) {
      append(`❌ Error: ${err.message}`);
    }
  };

  const runReauthTest = async () => {
    setLog([]);
    setRunning(true);
    try {
      const before = await hasAppCookie();
      append(`AppCookie present before: ${before}`);
      append('Calling attemptSilentReauth()...');
      const { recovered, redirected, finalUrl } = await attemptSilentReauth();
      append(`recovered: ${recovered}`);
      append(`redirected: ${redirected}`);
      append(`finalUrl: ${finalUrl}`);
      const after = await hasAppCookie();
      append(`AppCookie present after: ${after}`);
    } catch (err) {
      append(`❌ Error: ${err.message}`);
    } finally {
      setRunning(false);
    }
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

      <TouchableOpacity style={styles.secondaryButton} onPress={onDeleteAppCookieOnly}>
        <Text style={styles.secondaryButtonText}>Delete AppCookie only</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={runReauthTest} disabled={running}>
        <Text style={styles.secondaryButtonText}>Test silent re-auth</Text>
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
