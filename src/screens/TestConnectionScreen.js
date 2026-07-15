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

  const describeCookie = (name, c) =>
    `${name}: value=${c.value?.length ?? 0} chars (${(c.value || '').slice(0, 12)}…) ` +
    `path=${c.path ?? '(none)'} domain=${c.domain ?? '(none)'} ` +
    `expires=${c.expires ?? '(session)'} secure=${c.secure ?? false} httpOnly=${c.httpOnly ?? false}`;

  // Full cookie dump, reused everywhere so every diagnostic shows the
  // complete picture instead of just the one cookie a given action cares
  // about — useful for noticing side effects we didn't expect.
  const logAllCookies = async (label) => {
    append(label);
    const cookies = await CookieManager.get(COOKIE_DOMAIN);
    const names = Object.keys(cookies || {});
    append(`${names.length} cookie(s): ${names.join(', ') || '(none)'}`);
    names.forEach((name) => append(describeCookie(name, cookies[name])));
    return cookies;
  };

  const runTest = async () => {
    setLog([]);
    setRunning(true);
    try {
      await logAllCookies('--- Cookies before test ---');

      append('Checking for AppCookie...');
      const ok = await hasAppCookie();
      if (!ok) {
        append('❌ No AppCookie found. Login first.');
        return;
      }
      append('✅ AppCookie present.');

      const header = await getStoredCookieHeader();
      append(`Cookie header (${header.length} chars): ${header}`);

      const now = new Date();
      append(`Calling getFutureReport(${now.getMonth() + 1}, ${now.getFullYear()})...`);
      const res = await getFutureReports(now.getMonth() + 1, now.getFullYear());
      append('✅ Response received:');
      append(JSON.stringify(res, null, 2));
    } catch (err) {
      if (err instanceof AuthError) {
        append(`❌ AuthError: ${err.message}`);
        append(`AuthError name: ${err.name}, stack: ${err.stack}`);
        append('Cookie is invalid/expired — go to Login.');
      } else {
        append(`❌ Error: ${err.message}`);
        append(`Error name: ${err.name}, stack: ${err.stack}`);
      }
    } finally {
      append(`Last reauth attempt (may be from this run or an earlier one): ${JSON.stringify(getLastReauthAttempt())}`);
      await logAllCookies('--- Cookies after test ---');
      setRunning(false);
    }
  };

  const onClearCookies = async () => {
    setLog([]);
    await logAllCookies('--- Cookies before clear ---');
    await clearCookies();
    append('Cookies cleared.');
    await logAllCookies('--- Cookies after clear ---');
  };

  const onInvalidateAppCookie = async () => {
    setLog([]);
    try {
      const before = await logAllCookies('--- Cookies BEFORE invalidate ---');
      const appCookieBefore = before?.AppCookie?.value;

      // clearByName() unconditionally rejects on Android (checked the native
      // module source: not implemented for this platform at all). set()
      // also turned out to be a dead end: its native implementation always
      // builds an explicit Domain=one.prat.idf.il attribute (there's no way
      // to opt out), which makes a RFC 6265 "domain cookie" — a different
      // cookie identity than the real AppCookie, which is almost certainly
      // host-only (no Domain attribute at all, normal for a same-origin auth
      // cookie). Two different identities don't collide/replace each other,
      // which is why the overwrite kept silently no-op'ing despite
      // set()=true. setFromResponse() takes a raw string and skips that
      // auto-domain logic entirely, so this writes a true host-only cookie.
      const setOk = await CookieManager.setFromResponse(COOKIE_DOMAIN, 'AppCookie=invalidated-for-testing; path=/');
      append(`setFromResponse() result: ${setOk}`);
      await CookieManager.flush?.();

      const after = await logAllCookies('--- Cookies AFTER invalidate ---');
      const appCookieAfter = after?.AppCookie?.value;

      append(`AppCookie before: ${appCookieBefore}`);
      append(`AppCookie after: ${appCookieAfter}`);
      append(`AppCookie changed: ${appCookieBefore !== appCookieAfter}`);
      if (appCookieAfter === 'invalidated-for-testing') {
        append('✅ Genuinely invalidated this time.');
      } else {
        append('❌ Still not overwritten — this is the real cookie, not our garbage value.');
      }
      return appCookieAfter;
    } catch (err) {
      append(`❌ Error: ${err.message}`);
      append(`Error name: ${err.name}, stack: ${err.stack}`);
      return null;
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

  const inspectUrl = async (url, label) => {
    setLog([]);
    setRunning(true);
    try {
      await logAllCookies('--- Cookies before request ---');

      const cookieHeader = await getStoredCookieHeader();
      // Cache-bust in case Incapsula (the WAF sitting in front of this site,
      // per the cookie names) is serving an edge-cached response instead of
      // hitting the origin live for this exact cookie.
      const bustedUrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
      append(`${label}`);
      append(`Request URL: ${bustedUrl}`);
      append(`Sending cookie header (${cookieHeader.length} chars): ${cookieHeader}`);
      const res = await fetch(bustedUrl, {
        redirect: 'follow',
        headers: {
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          accept: 'application/json, text/plain, */*',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
        },
      });
      append(`status: ${res.status} (${res.statusText || ''})`);
      append(`ok: ${res.ok}`);
      append(`redirected: ${res.redirected}`);
      append(`type: ${res.type}`);
      append(`final url: ${res.url}`);
      append('--- all response headers ---');
      if (res.headers?.forEach) {
        res.headers.forEach((value, key) => append(`${key}: ${value}`));
      } else if (res.headers?.entries) {
        for (const [key, value] of res.headers.entries()) append(`${key}: ${value}`);
      } else {
        append('(no way to enumerate headers on this platform)');
      }
      const text = await res.text();
      append(`body length: ${text.length} chars`);
      append('--- full body ---');
      append(text);

      await logAllCookies('--- Cookies after request ---');
    } catch (err) {
      append(`❌ Error: ${err.message}`);
      append(`Error name: ${err.name}, stack: ${err.stack}`);
    } finally {
      setRunning(false);
    }
  };

  const listCookies = async () => {
    setLog([]);
    try {
      await logAllCookies(`--- CookieManager.get(${COOKIE_DOMAIN}) ---`);

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
      append(`Error name: ${err.name}, stack: ${err.stack}`);
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
      await logAllCookies('--- Cookies BEFORE reauth ---');

      append('Calling attemptSilentReauth()...');
      const { recovered, redirected, finalUrl, skipped } = await attemptSilentReauth();
      if (skipped) append(`skipped: ${skipped} (still on cooldown from a previous failed attempt)`);
      append(`recovered: ${recovered}`);
      append(`redirected: ${redirected}`);
      append(`finalUrl: ${finalUrl}`);

      const after = await hasAppCookie();
      append(`AppCookie present after: ${after}`);
      await logAllCookies('--- Cookies AFTER reauth ---');
    } catch (err) {
      append(`❌ Error: ${err.message}`);
      append(`Error name: ${err.name}, stack: ${err.stack}`);
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
