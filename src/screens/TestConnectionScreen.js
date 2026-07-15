import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { getFutureReports, getStoredCookieHeader, hasAppCookie, AuthError, clearCookies, attemptSilentReauth, getLastReauthAttempt, COOKIE_DOMAIN, LOGIN_URL } from '../api/doch1';
import { getLastAutoSubmitRun } from '../tasks/runAutoSubmit';
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
      append(`Last reauth attempt (may be from this run or an earlier one): ${JSON.stringify(getLastReauthAttempt())}`);
      setRunning(false);
    }
  };

  const onClearCookies = async () => {
    await clearCookies();
    append('Cookies cleared.');
  };

  const onInvalidateAppCookie = async () => {
    setLog([]);
    try {
      // Not using `expires` in the past here: this library only writes an
      // Expires attribute when the computed maxAge > 0, so a past date is
      // silently dropped and nothing actually expires. Overwriting the
      // value instead reliably breaks the session server-side without
      // touching any other cookie.
      await CookieManager.set(COOKIE_DOMAIN, {
        name: 'AppCookie',
        value: 'invalidated-for-testing',
      });
      await CookieManager.flush?.();
      append('AppCookie value overwritten — other cookies untouched.');
      append(`AppCookie present (still, expected): ${await hasAppCookie()}`);
      append('Now tap "Run test" — it should transparently recover via');
      append('attemptSilentReauth() instead of showing an AuthError.');
    } catch (err) {
      append(`❌ Error: ${err.message}`);
    }
  };

  const showLastAutoSubmitRun = async () => {
    setLog([]);
    const lastRun = await getLastAutoSubmitRun();
    if (!lastRun) {
      append('No auto-submit run recorded yet.');
      return;
    }
    append(JSON.stringify(lastRun, null, 2));
  };

  const CACHE_DEBUG_HEADERS = ['set-cookie', 'cache-control', 'age', 'x-iinfo', 'x-cdn', 'x-cache', 'cf-cache-status', 'etag'];

  const inspectUrl = async (url, label) => {
    setLog([]);
    setRunning(true);
    try {
      const cookieHeader = await getStoredCookieHeader();
      // Cache-bust in case Incapsula (the WAF sitting in front of this site,
      // per the cookie names) is serving an edge-cached response instead of
      // hitting the origin live for this exact cookie.
      const bustedUrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
      append(`${label}`);
      append(`Sending cookie header (${cookieHeader.length} chars)...`);
      const res = await fetch(bustedUrl, {
        redirect: 'follow',
        headers: {
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          accept: 'application/json, text/plain, */*',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
        },
      });
      append(`status: ${res.status}`);
      append(`redirected: ${res.redirected}`);
      append(`final url: ${res.url}`);
      CACHE_DEBUG_HEADERS.forEach((h) => {
        const v = res.headers.get?.(h);
        if (v) append(`${h}: ${v}`);
      });
      const text = await res.text();
      append(`body length: ${text.length} chars`);
      append('--- body (first 1000 chars) ---');
      append(text.slice(0, 1000));
    } catch (err) {
      append(`❌ Error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  const describeCookie = (name, c) =>
    `${name}: value=${c.value?.length ?? 0} chars (${(c.value || '').slice(0, 12)}…) ` +
    `path=${c.path ?? '(none)'} domain=${c.domain ?? '(none)'} ` +
    `expires=${c.expires ?? '(session)'} secure=${c.secure ?? false} httpOnly=${c.httpOnly ?? false}`;

  const listCookies = async () => {
    setLog([]);
    try {
      append(`--- CookieManager.get(${COOKIE_DOMAIN}) ---`);
      const scoped = await CookieManager.get(COOKIE_DOMAIN);
      const scopedNames = Object.keys(scoped || {});
      append(`${scopedNames.length} cookie(s): ${scopedNames.join(', ') || '(none)'}`);
      scopedNames.forEach((name) => append(describeCookie(name, scoped[name])));

      append('--- CookieManager.getAll() (unscoped, everything stored) ---');
      try {
        const all = await CookieManager.getAll();
        const allNames = Object.keys(all || {});
        append(`${allNames.length} cookie(s): ${allNames.join(', ') || '(none)'}`);
        allNames.forEach((name) => append(describeCookie(name, all[name])));
      } catch (_) {
        // getAll() is iOS-only on this library — not a real error on Android.
        append('(not supported on Android — expected, not an error)');
      }
    } catch (err) {
      append(`❌ Error: ${err.message}`);
    }
  };

  const inspectLoginPage = () => inspectUrl(LOGIN_URL, 'Inspecting login page (/)...');
  const inspectGetUser = () => inspectUrl(`${COOKIE_DOMAIN}/api/account/getUser`, 'Inspecting /api/account/getUser...');

  const runReauthTest = async () => {
    setLog([]);
    setRunning(true);
    try {
      const before = await hasAppCookie();
      append(`AppCookie present before: ${before}`);
      append('Calling attemptSilentReauth()...');
      const { recovered, redirected, finalUrl, skipped } = await attemptSilentReauth();
      if (skipped) append(`skipped: ${skipped} (still on cooldown from a previous failed attempt)`);
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

      <ScrollView
        style={styles.buttonsScroll}
        contentContainerStyle={styles.buttonsContent}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.button} onPress={runTest} disabled={running}>
          {running ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.buttonText}>Run connection test (fetch reports)</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.secondaryButtonText}>Go to Login</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={onClearCookies}>
          <Text style={styles.secondaryButtonText}>Clear cookies</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={listCookies}>
          <Text style={styles.secondaryButtonText}>List all cookies</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={onInvalidateAppCookie}>
          <Text style={styles.secondaryButtonText}>Invalidate AppCookie only</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={runReauthTest} disabled={running}>
          <Text style={styles.secondaryButtonText}>Test silent re-auth</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={inspectLoginPage} disabled={running}>
          <Text style={styles.secondaryButtonText}>Inspect login page response</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={inspectGetUser} disabled={running}>
          <Text style={styles.secondaryButtonText}>Inspect getUser response</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={showLastAutoSubmitRun} disabled={running}>
          <Text style={styles.secondaryButtonText}>Show last auto-submit run</Text>
        </TouchableOpacity>
      </ScrollView>

      <ScrollView style={styles.logBox}>
        <Text style={styles.logLine} selectable>
          {log.join('\n')}
        </Text>
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
  buttonsScroll: { maxHeight: '38%', flexGrow: 0 },
  buttonsContent: { paddingBottom: spacing.xs },
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
  },
});
