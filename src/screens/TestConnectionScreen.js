import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { getFutureReports, getStoredCookieHeader, hasAppCookie, AuthError, clearCookies, attemptSilentReauth, getLastReauthAttempt, refreshAppCookie, testSsoFallback, getMsalRefreshToken, saveMsalRefreshToken, COOKIE_DOMAIN, LOGIN_URL } from '../api/doch1';
import { getLastAutoSubmitRun } from '../tasks/runAutoSubmit';
import { getLastLaunchRefresh } from '../utils/launchRefreshLog';
import { colors, spacing, radius } from '../theme';

// Injected into every top-level document the trace WebView loads (including
// cross-domain SSO hops). Reports all fetch/XHR traffic, request/response
// parameters for the auth-relevant calls, and periodic storage snapshots
// back over postMessage — the visibility a plain headless fetch can never
// have. This is how we recover the exact OAuth parameters needed to replay
// the refresh headlessly. Secrets (tokens, refresh_token, auth codes) are
// redacted to length-only in-page, so nothing sensitive leaves the device.
const TRACE_INSTRUMENTATION_JS = `
(function () {
  function send(type, payload) {
    try {
      payload = payload || {};
      payload.type = type;
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (e) {}
  }
  var SECRET = ['refresh_token','access_token','id_token','code','client_secret','client_assertion','assertion','code_verifier'];
  function isSecret(k) { k = String(k).toLowerCase(); for (var i = 0; i < SECRET.length; i++) { if (k === SECRET[i]) return true; } return false; }
  // application/x-www-form-urlencoded body, secret values blanked to length.
  function redactForm(body) {
    try {
      return String(body).split('&').map(function (kv) {
        var i = kv.indexOf('='); var k = i < 0 ? kv : kv.slice(0, i); var v = i < 0 ? '' : kv.slice(i + 1);
        if (isSecret(decodeURIComponent(k))) return k + '=[REDACTED:' + v.length + ']';
        try { return k + '=' + decodeURIComponent(v); } catch (e) { return k + '=' + v; }
      }).join('&');
    } catch (e) { return '[unparseable-body]'; }
  }
  // JSON body, secret fields + any very long string blanked to length.
  function redactJson(text) {
    try {
      var o = JSON.parse(text);
      Object.keys(o).forEach(function (k) {
        if (isSecret(k)) o[k] = '[REDACTED:' + String(o[k]).length + ']';
        else if (typeof o[k] === 'string' && o[k].length > 200) o[k] = '[LONG:' + o[k].length + ']';
      });
      return JSON.stringify(o);
    } catch (e) { return '[non-JSON len=' + (text ? text.length : 0) + ']'; }
  }
  function wantResBody(url) { return /oauth2\\/v2\\.0\\/token|GetParams/i.test(url); }
  function wantReqDetail(url) { return /oauth2\\/v2\\.0\\/token|\\/api\\/account\\/login/i.test(url); }
  function keysOf(storage) {
    var out = [];
    try {
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i);
        out.push(k + ' (' + String(storage.getItem(k) || '').length + ' chars)');
      }
    } catch (e) { out.push('unreadable: ' + String(e && e.message)); }
    return out;
  }
  function snapshotStorage(label) {
    send('storage', {
      label: label,
      url: location.href,
      cookie: document.cookie,
      localStorage: keysOf(window.localStorage),
      sessionStorage: keysOf(window.sessionStorage),
    });
  }

  // Look for MSAL's Azure refresh token in localStorage and report it. The
  // raw secret rides in this message (WebView->RN postMessage never leaves
  // the device) so the screen can persist it for real use; the log line
  // built from this message must only ever show length, never the secret
  // itself.
  var rtReported = false;
  function findAccountUsername() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        // AccountEntity key looks like <homeAccountId>-login.microsoftonline.com-<realm>
        // — distinguish from the credential keys (refreshtoken/accesstoken/idtoken).
        if (k.indexOf('-login.microsoftonline.com-') >= 0 &&
            k.indexOf('-refreshtoken-') < 0 && k.indexOf('-accesstoken-') < 0 && k.indexOf('-idtoken-') < 0) {
          try {
            var acc = JSON.parse(localStorage.getItem(k) || '{}');
            if (acc && acc.username) return acc.username;
          } catch (e) {}
        }
      }
    } catch (e) {}
    return '';
  }
  function grabRt() {
    if (rtReported) return true;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf('-refreshtoken-') >= 0) {
          var raw = localStorage.getItem(k);
          var v;
          try { v = JSON.parse(raw); } catch (e) { v = null; }
          if (v && v.secret) {
            var tid = '';
            if (v.homeAccountId && v.homeAccountId.indexOf('.') >= 0) tid = v.homeAccountId.split('.')[1];
            var username = findAccountUsername();
            rtReported = true;
            send('rtcapture', {
              found: true, key: k, keyLen: raw ? raw.length : 0,
              parsedKeys: Object.keys(v).join(','),
              clientId: v.clientId || '', tenantId: tid, homeAccountId: v.homeAccountId || '', username: username,
              secretLen: v.secret.length, secret: v.secret,
            });
            return true;
          }
          send('rtcapture', { found: false, key: k, keyLen: raw ? raw.length : 0, reason: 'no .secret or unparseable', parsedKeys: v ? Object.keys(v).join(',') : '(parse failed)' });
        }
      }
    } catch (e) { send('rtcapture', { found: false, reason: 'exception: ' + String(e && e.message) }); }
    return false;
  }

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = (input && input.url) || String(input);
    var method = (init && init.method) || (input && input.method) || 'GET';
    var reqBody = init && init.body;
    return origFetch.apply(this, arguments).then(
      function (res) {
        send('fetch', { method: method, url: url, status: res.status, redirected: res.redirected, finalUrl: res.url });
        if (wantReqDetail(url) && reqBody) send('reqbody', { url: url, body: redactForm(reqBody) });
        if (wantResBody(url)) {
          try {
            res.clone().text().then(function (t) {
              // Stash the raw tokens (never sent) so we can identify which one
              // authorizes /api/account/login; report only the redacted body.
              try { var o = JSON.parse(t); window.__tok = { at: o.access_token, it: o.id_token }; } catch (e) {}
              send('resbody', { url: url, body: redactJson(t) });
            });
          } catch (e) {}
        }
        return res;
      },
      function (err) { send('fetch', { method: method, url: url, error: String(err) }); throw err; }
    );
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__t = { method: method, url: String(url), headers: {} };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__t) {
        if (/authorization/i.test(name)) {
          var sp = String(value).indexOf(' ');
          this.__t.headers[name] = (sp > 0 ? String(value).slice(0, sp) : '') + ' [REDACTED:' + String(value).length + ']';
          // Which token is this? Compare against the last token response.
          if (/\\/api\\/account\\/login/i.test(this.__t.url || '') && window.__tok) {
            var bv = String(value).replace(/^\\S+\\s+/, '');
            this.__t.authMatch = bv === window.__tok.at ? 'access_token' : (bv === window.__tok.it ? 'id_token' : 'other');
          }
        } else {
          this.__t.headers[name] = value;
        }
      }
    } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    xhr.addEventListener('loadend', function () {
      var t = xhr.__t || {};
      send('xhr', { method: t.method, url: t.url, status: xhr.status, responseURL: xhr.responseURL });
      if (t.url && wantReqDetail(t.url)) send('reqdetail', { url: t.url, headers: t.headers, authMatch: t.authMatch, body: body ? redactForm(body) : null });
      if (t.url && wantResBody(t.url)) { try { send('resbody', { url: t.url, body: redactJson(xhr.responseText) }); } catch (e) {} }
    });
    return origSend.apply(this, arguments);
  };

  snapshotStorage('document start');
  window.addEventListener('load', function () { snapshotStorage('window load'); grabRt(); });
  setTimeout(function () { snapshotStorage('after 5s'); grabRt(); }, 5000);
  setTimeout(function () { snapshotStorage('after 15s'); grabRt(); }, 15000);
  // Also poll frequently right after the redirect/token-exchange window,
  // independent of the storage-snapshot cadence — this is what we actually
  // rely on in production (useLoginDetection's capture), so proving it here
  // proves that mechanism too.
  var rtPollN = 0;
  var rtPoll = setInterval(function () {
    if (grabRt() || ++rtPollN > 20) clearInterval(rtPoll);
  }, 1000);
  if (!rtReported) grabRt();
  true;
})();
`;

const originOf = (url) => {
  const m = String(url || '').match(/^https?:\/\/[^/]+/);
  return m ? m[0] : null;
};

export default function TestConnectionScreen({ navigation }) {
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [tracing, setTracing] = useState(false);
  const traceOriginsRef = useRef(new Set());
  const traceAppCookieBeforeRef = useRef(null);
  const traceLastNavRef = useRef('');

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

  const showLastLaunchRefresh = async () => {
    setLog([]);
    const last = await getLastLaunchRefresh();
    if (!last) {
      append('No launch refresh attempt recorded yet.');
      return;
    }
    append(JSON.stringify(last, null, 2));
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

  // --- Instrumented login trace ------------------------------------------
  // Loads the portal in a real WebView while logging every top-level
  // navigation (including cross-domain SSO hops — invisible to every earlier
  // probe), every fetch/XHR the SPA makes, and storage snapshots. Afterward
  // it dumps cookies for EACH domain seen, since CookieManager.get() is
  // per-domain and the earlier "AppCookie is the only cookie" audit could
  // only see one.prat.idf.il. Best run right after "Invalidate AppCookie
  // only", to capture a genuine recovery in action.

  const startTrace = async () => {
    setLog([]);
    traceOriginsRef.current = new Set();
    traceLastNavRef.current = '';
    const cookies = await CookieManager.get(COOKIE_DOMAIN);
    traceAppCookieBeforeRef.current = cookies?.AppCookie?.value ?? null;
    append('--- Instrumented login trace ---');
    append('Tip: run "Invalidate AppCookie only" first to watch a genuine recovery.');
    const before = traceAppCookieBeforeRef.current;
    append(`AppCookie before: ${before ? `${before.slice(0, 16)}… (${before.length} chars)` : '(none)'}`);
    append('Loading portal with fetch/XHR/storage instrumentation. Press "Stop trace" once the page settles.');
    setTracing(true);
  };

  const stopTrace = async () => {
    setTracing(false);
    append('--- Trace stopped ---');
    try {
      await CookieManager.flush?.();
    } catch (_) {}
    const origins = Array.from(traceOriginsRef.current);
    append(`Origins seen during trace: ${origins.join(', ') || '(none)'}`);
    for (const origin of origins) {
      try {
        const cookies = await CookieManager.get(origin);
        const names = Object.keys(cookies || {});
        append(`Cookies for ${origin}: ${names.join(', ') || '(none)'}`);
        names.forEach((name) => append(describeCookie(name, cookies[name])));
      } catch (err) {
        append(`Cookies for ${origin}: error (${err.message})`);
      }
    }
    const after = await CookieManager.get(COOKIE_DOMAIN);
    const appCookieAfter = after?.AppCookie?.value ?? null;
    append(`AppCookie after: ${appCookieAfter ? `${appCookieAfter.slice(0, 16)}… (${appCookieAfter.length} chars)` : '(none)'}`);
    append(`AppCookie changed during trace: ${appCookieAfter !== traceAppCookieBeforeRef.current}`);
  };

  const noteTraceUrl = (url) => {
    const origin = originOf(url);
    if (origin) traceOriginsRef.current.add(origin);
  };

  const onTraceNavStateChange = (navState) => {
    const url = navState?.url || '';
    noteTraceUrl(url);
    const line = `[nav] ${url}${navState?.loading ? ' (loading)' : ''}`;
    if (line !== traceLastNavRef.current) {
      traceLastNavRef.current = line;
      append(line);
    }
  };

  const onTraceShouldStart = (request) => {
    noteTraceUrl(request?.url);
    append(`[nav→] ${request?.url}`);
    return true;
  };

  const onTraceMessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event?.nativeEvent?.data);
    } catch (_) {
      return;
    }
    if (msg.type === 'rtcapture') {
      // Never log msg.secret — only length/metadata. This is the same
      // localStorage lookup useLoginDetection's capture does in production;
      // running it here proves whether the extraction logic itself works,
      // independent of LoginScreen's WebView lifecycle.
      if (msg.found) {
        append(`[rt capture] FOUND key=${msg.key} (${msg.keyLen} chars) fields=[${msg.parsedKeys}]`);
        append(`[rt capture] clientId=${msg.clientId} tenantId=${msg.tenantId} secretLen=${msg.secretLen} username=${msg.username || '(not found)'}`);
        if (msg.secret && msg.clientId && msg.tenantId) {
          try {
            await saveMsalRefreshToken({ secret: msg.secret, clientId: msg.clientId, tenantId: msg.tenantId, username: msg.username || '' });
            append('✅ Saved to AsyncStorage — "Test headless refresh" should now find it.');
          } catch (err) {
            append(`❌ Failed to save: ${err.message}`);
          }
        } else {
          append('⚠️ Found the key but missing clientId/tenantId/secret — cannot save. See parsedKeys above.');
        }
      } else {
        append(`[rt capture] not found yet${msg.key ? ` (key=${msg.key}, ${msg.reason || ''})` : ` (${msg.reason || 'no -refreshtoken- key seen'})`}`);
      }
      return;
    }
    if (msg.type === 'fetch' || msg.type === 'xhr') {
      noteTraceUrl(msg.url);
      if (msg.error) {
        append(`[${msg.type}] ${msg.method} ${msg.url} → ERROR ${msg.error}`);
      } else {
        append(`[${msg.type}] ${msg.method} ${msg.url} → ${msg.status}${msg.redirected ? ` (redirected → ${msg.finalUrl})` : ''}`);
      }
    } else if (msg.type === 'reqbody') {
      append(`[req body] ${msg.url}`);
      append(`  ${msg.body}`);
    } else if (msg.type === 'resbody') {
      append(`[res body] ${msg.url}`);
      append(`  ${msg.body}`);
    } else if (msg.type === 'reqdetail') {
      append(`[req detail] ${msg.url}`);
      append(`  headers: ${JSON.stringify(msg.headers || {})}`);
      if (msg.authMatch) append(`  auth token = ${msg.authMatch}`);
      if (msg.body) append(`  body: ${msg.body}`);
    } else if (msg.type === 'storage') {
      append(`[storage @ ${msg.label}] ${msg.url}`);
      append(`  document.cookie: ${msg.cookie || '(empty)'}`);
      append(`  localStorage: ${(msg.localStorage || []).join(', ') || '(empty)'}`);
      append(`  sessionStorage: ${(msg.sessionStorage || []).join(', ') || '(empty)'}`);
    }
  };

  // Runs the actual headless refresh (refreshAppCookie) — the same call the
  // background worker makes. This is how we validate Path A on-device without
  // waiting for a background fire: invalidate AppCookie, then run this and
  // watch it come back to a real 368-char CfDJ ticket.
  const testHeadlessRefresh = async () => {
    setLog([]);
    setRunning(true);
    try {
      const rt = await getMsalRefreshToken();
      append(`Stored refresh token: ${rt?.secret ? `present (${rt.secret.length} chars), tenant=${rt.tenantId}, client=${rt.clientId}` : 'NONE — open Login once to capture it'}`);
      const before = (await CookieManager.get(COOKIE_DOMAIN))?.AppCookie?.value;
      append(`AppCookie before: ${before ? `${before.slice(0, 16)}… (${before.length} chars)` : '(none)'}`);

      append('Calling refreshAppCookie()...');
      const res = await refreshAppCookie();
      append(`Result: ${JSON.stringify(res)}`);

      await CookieManager.flush?.();
      const after = (await CookieManager.get(COOKIE_DOMAIN))?.AppCookie?.value;
      append(`AppCookie after: ${after ? `${after.slice(0, 16)}… (${after.length} chars)` : '(none)'}`);
      append(`AppCookie changed: ${before !== after}`);
      if (res.ok && after && after.length > 100) append('✅ Headless refresh works — a fresh AppCookie was minted with no WebView.');
      else if (!res.ok) append(`❌ Refresh failed: ${res.reason || 'unknown'}`);
    } catch (err) {
      append(`❌ Error: ${err.message}`);
      append(`Error name: ${err.name}, stack: ${err.stack}`);
    } finally {
      setRunning(false);
    }
  };

  // Forces the SILENT SSO fallback path specifically (Azure session cookie,
  // not the cached MSAL refresh token) — the mechanism that's supposed to
  // let the worker recover even after the refresh token itself has gone
  // stale (>24h with no successful refresh). Bypasses the normal
  // "try refresh token first" order so this can be validated on-device
  // immediately, without waiting a day for the refresh token to actually
  // expire. NOT yet confirmed working — this is the untested half of the
  // headless refresh; expect to iterate on whatever this returns.
  const testSsoFallbackButton = async () => {
    setLog([]);
    setRunning(true);
    try {
      const rt = await getMsalRefreshToken();
      append(`Stored token metadata: ${rt ? `tenant=${rt.tenantId}, client=${rt.clientId}, username=${rt.username || '(none captured)'}` : 'NONE — run a login/trace first'}`);
      const before = (await CookieManager.get(COOKIE_DOMAIN))?.AppCookie?.value;
      append(`AppCookie before: ${before ? `${before.slice(0, 16)}… (${before.length} chars)` : '(none)'}`);

      // The Azure session cookies are what the silent SSO path actually rides
      // on — dump them so a login_required failure is diagnosable (was an
      // ESTSAUTH cookie even present, and if so is it persistent or expired?).
      const aadCookies = (await CookieManager.get('https://login.microsoftonline.com')) || {};
      const aadNames = Object.keys(aadCookies);
      append(`Azure SSO cookies (login.microsoftonline.com) — ${aadNames.length}: ${aadNames.join(', ') || '(none)'}`);
      aadNames.forEach((name) => append(describeCookie(name, aadCookies[name])));

      append('Calling testSsoFallback() — forces the /authorize?prompt=none path...');
      const res = await testSsoFallback();
      append(`Result: ${JSON.stringify(res)}`);

      await CookieManager.flush?.();
      const after = (await CookieManager.get(COOKIE_DOMAIN))?.AppCookie?.value;
      append(`AppCookie after: ${after ? `${after.slice(0, 16)}… (${after.length} chars)` : '(none)'}`);
      append(`AppCookie changed: ${before !== after}`);
      if (res.ok && after && after.length > 100) append('✅ SSO-cookie fallback works — recovered via Azure session cookie alone.');
      else if (!res.ok) append(`❌ SSO fallback failed: ${res.reason || 'unknown'}`);
    } catch (err) {
      append(`❌ Error: ${err.message}`);
      append(`Error name: ${err.name}, stack: ${err.stack}`);
    } finally {
      setRunning(false);
    }
  };

  // Exercises the REAL background worker path (TaskManager task via
  // WorkManager), not just runAutoSubmit() on the JS thread. Debug builds
  // only — the API rejects in production.
  const triggerBackgroundWorker = async () => {
    setLog([]);
    setRunning(true);
    try {
      const BackgroundTask = require('expo-background-task');
      append('Triggering the background task worker (debug builds only)...');
      const ok = await BackgroundTask.triggerTaskWorkerForTestingAsync();
      append(`triggered: ${ok}`);
      append('Result lands in "Show last auto-submit run" once the worker finishes.');
    } catch (err) {
      append(`❌ Error: ${err.message}`);
      append('(Only works in debug builds with native modules available.)');
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Test Connection</Text>

      {tracing ? (
        <>
          <View style={styles.traceWebViewBox}>
            <WebView
              source={{ uri: LOGIN_URL }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              injectedJavaScriptBeforeContentLoaded={TRACE_INSTRUMENTATION_JS}
              onMessage={onTraceMessage}
              onNavigationStateChange={onTraceNavStateChange}
              onShouldStartLoadWithRequest={onTraceShouldStart}
            />
          </View>
          <TouchableOpacity style={styles.button} onPress={stopTrace}>
            <Text style={styles.buttonText}>Stop trace</Text>
          </TouchableOpacity>
        </>
      ) : (
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

        <TouchableOpacity style={styles.secondaryButton} onPress={showLastLaunchRefresh} disabled={running}>
          <Text style={styles.secondaryButtonText}>Show last launch refresh attempt</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={testHeadlessRefresh} disabled={running}>
          <Text style={styles.secondaryButtonText}>Test headless refresh (refreshAppCookie)</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={testSsoFallbackButton} disabled={running}>
          <Text style={styles.secondaryButtonText}>Test SSO fallback (force)</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={startTrace} disabled={running}>
          <Text style={styles.secondaryButtonText}>Instrumented login trace</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={triggerBackgroundWorker} disabled={running}>
          <Text style={styles.secondaryButtonText}>Trigger background worker (debug)</Text>
        </TouchableOpacity>
      </ScrollView>
      )}

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
  traceWebViewBox: {
    height: '35%',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
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
