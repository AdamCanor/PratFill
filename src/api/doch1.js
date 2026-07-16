import AsyncStorage from '@react-native-async-storage/async-storage';
import CookieManager from '@preeternal/react-native-cookie-manager';

const BASE_URL = 'https://one.prat.idf.il';
export const COOKIE_DOMAIN = 'https://one.prat.idf.il';
export const LOGIN_URL = `${BASE_URL}/`;

// A cold OS-triggered background wake has no warm DNS cache, TLS session, or
// connection pool — the same redirect chain that finishes comfortably from a
// foreground app can take much longer on a cold network stack. Give it more
// room than a foreground call would ever need.
const REAUTH_TIMEOUT_MS = 25000;
const REAUTH_COOLDOWN_MS = 20000;
const REAUTH_NETWORK_RETRIES = 1;

// --- Cookie handling -------------------------------------------------

// Build a Cookie header from whatever cookies are present for the domain.
// AppCookie is the important one, but send everything that's there.
function buildCookieHeader(cookies) {
  return Object.entries(cookies || {})
    .map(([name, c]) => `${name}=${c.value}`)
    .join('; ');
}

export async function getStoredCookieHeader() {
  const cookies = await CookieManager.get(COOKIE_DOMAIN);
  return buildCookieHeader(cookies);
}

// Same as above but for an arbitrary origin — needed to attach Azure's own
// SSO cookies (login.microsoftonline.com) to a request, since RN's fetch
// never auto-attaches any cookie jar (see the comment on request() below).
async function getCookieHeaderForDomain(domain) {
  const cookies = await CookieManager.get(domain);
  return buildCookieHeader(cookies);
}

export async function hasAppCookie() {
  const cookies = await CookieManager.get(COOKIE_DOMAIN);
  return Boolean(cookies && cookies.AppCookie && cookies.AppCookie.value);
}

export async function clearCookies() {
  await CookieManager.clearAll();
}

// --- Session model (confirmed by direct testing against the live backend,
// not assumed) ---------------------------------------------------------
//
// AppCookie is the ONLY application-level auth cookie. It's a ~368-char,
// "CfDJ"-prefixed ASP.NET Data Protection encrypted ticket, and it's
// short-lived (observed ~5h). Every other cookie this site sets —
// incap_ses_*, visid_incap_*, nlbi_* (Imperva Incapsula, the WAF/CDN in
// front of the site) and BIGipServerMFT-One-Frontends (an F5 BIG-IP
// load-balancer stickiness cookie) — is pure network infrastructure. There
// is no second, longer-lived application session cookie for AppCookie to
// be reissued from.
//
// The site's root page (/) is a static SPA shell (a bare `<div id="root">`
// plus JS bundle references) that returns byte-identical output — 200, no
// redirect, no Set-Cookie — regardless of AppCookie's validity. Verified
// this with both a genuinely valid AppCookie and a deliberately corrupted
// one (confirmed corrupted by comparing the cookie's value before/after,
// not just checking presence — a stale AppCookie is never removed by the
// server on a plain page load, so presence alone proves nothing): identical
// static response either way. So there is no header, cookie, or retry that
// makes a headless request silently recover a dead AppCookie — the
// server-side behavior simply doesn't vary by cookie state at this
// endpoint. The only way to get a fresh AppCookie once it's dead is a real
// login through a WebView (browser engine executing the portal's JS).
//
// The goal is an AUTONOMOUS daily background fill: the worker gets a fresh
// AppCookie on its own and keeps the week filled without the user ever
// opening the app, for as long as the ~monthly login survives. That hinges
// on refreshAppCookie() below being able to mint a fresh AppCookie headlessly
// — confirmed working on-device (see its doc block): the portal's
// silent-refresh mechanism, identified via the "Instrumented login trace" in
// TestConnectionScreen, is a plain MSAL refresh-token exchange.
//
// Supporting pieces already in place:
// - refreshAppCookie() (below) is the seam the background worker calls before
//   every submit. It's implemented as Path A: redeem the MSAL refresh token
//   at Azure, then GET /api/account/login with the id_token to mint a fresh
//   AppCookie — see its own doc block for the full flow.
// - On launch with a dead session, RootNavigator mounts the hidden
//   SessionRefreshWebView (components/SessionRefreshWebView.js) behind the
//   splash — a real WebView login, minus the screen. This is a SECONDARY
//   safety net (and the credential-capture point for Path A), not the
//   feature itself. The visible LoginScreen is the last-resort fallback for a
//   genuinely-expired (~monthly) login.
// - Until the headless refresh lands, background fires still fail whenever
//   they land on a dead AppCookie; the worker only notifies "re-login" when
//   the filled window is actually about to run out (see tasks/runAutoSubmit.js
//   and tasks/autoSubmitTask.js).
let reauthInFlight = null;
let reauthCooldownUntil = 0;
let lastReauthAttempt = null;

// Exposed purely for debugging (TestConnectionScreen). request() no longer
// calls attemptSilentReauth() below — per the session model documented
// above, it has never once succeeded against the live backend, so calling
// it just added up to ~50s of latency to an already-unrecoverable auth
// failure. Kept only as a manual diagnostic probe (the "Test silent
// re-auth" button) in case this site's behavior ever changes and this
// conclusion needs re-verifying.
export function getLastReauthAttempt() {
  return lastReauthAttempt;
}

export async function attemptSilentReauth() {
  if (reauthInFlight) return reauthInFlight;
  if (Date.now() < reauthCooldownUntil) {
    const result = { recovered: false, skipped: 'cooldown' };
    lastReauthAttempt = { ...result, at: new Date().toISOString() };
    return result;
  }

  reauthInFlight = (async () => {
    const cookiesBefore = await CookieManager.get(COOKIE_DOMAIN);
    const appCookieBefore = cookiesBefore?.AppCookie?.value;
    // fetch() does NOT automatically attach the native CookieManager jar —
    // every other call in this file builds a Cookie header explicitly for
    // the same reason. Without it, this request hits the portal as a fully
    // anonymous client, which can never be silently re-authenticated: there's
    // no session for the server to recognize.
    const cookieHeader = buildCookieHeader(cookiesBefore);

    let redirected;
    let finalUrl;
    // Only retry when the fetch itself never completed (network failure or
    // our own abort timeout) — a real response with no fresh AppCookie is a
    // genuine negative, not a timing artifact, so retrying that would just
    // waste the background task's time budget for nothing.
    for (let attempt = 0; attempt <= REAUTH_NETWORK_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REAUTH_TIMEOUT_MS);
        const res = await fetch(LOGIN_URL, {
          redirect: 'follow',
          signal: controller.signal,
          headers: cookieHeader ? { cookie: cookieHeader } : undefined,
        });
        clearTimeout(timeout);
        redirected = res?.redirected;
        finalUrl = res?.url;
        break;
      } catch (_) {
        // Network failure or timeout — loop again if a retry remains, else
        // fall through to the recovery check below.
      }
    }

    // flush() forces the native cookie store to sync before we read it back —
    // without this, a fresh AppCookie the fetch above just wrote can read
    // back stale.
    try {
      await CookieManager.flush?.();
    } catch (_) {
      // Not available on this platform — proceed with whatever get() returns.
    }

    // A stale, already-invalid AppCookie is never cleared by the server on a
    // plain page load, so "is AppCookie present" can't tell "still there,
    // unchanged" apart from "freshly reissued" — that false positive was the
    // actual bug: request() would see recovered:true, retry once, and fail
    // again for real with the same dead cookie. Recovery only counts if we
    // got back a genuinely different value.
    const cookiesAfter = await CookieManager.get(COOKIE_DOMAIN);
    const appCookieAfter = cookiesAfter?.AppCookie?.value;
    const recovered = Boolean(appCookieAfter) && appCookieAfter !== appCookieBefore;
    reauthCooldownUntil = recovered ? 0 : Date.now() + REAUTH_COOLDOWN_MS;
    const result = { recovered, redirected, finalUrl };
    lastReauthAttempt = { ...result, at: new Date().toISOString() };
    return result;
  })();

  try {
    return await reauthInFlight;
  } finally {
    reauthInFlight = null;
  }
}

// --- Generic request helper ------------------------------------------

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

// No retry-via-reauth here — per the session model documented above, a
// missing/rejected AppCookie is never recoverable without a real WebView
// login, so there's nothing to gain from stalling before failing.
async function request(path, { method = 'GET', headers = {}, body } = {}) {
  const cookieHeader = await getStoredCookieHeader();
  if (!cookieHeader.includes('AppCookie=')) {
    throw new AuthError('Missing AppCookie - login required');
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie: cookieHeader,
      ...headers,
    },
    body,
  });

  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`Auth failed (${res.status}) - login required`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${text}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

// --- Endpoints ----------------------------------------------------------

// month: 1-12, year: e.g. 2026
export async function getFutureReports(month, year) {
  return request('/api/Attendance/getFutureReport', {
    method: 'POST',
    headers: { 'content-type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ month, year }),
  });
}

// date format: DD.MM.YYYY
export async function deleteFutureReport(dateToDelete) {
  return request(
    `/api/Attendance/deleteFutureReport?dateToDelete=${encodeURIComponent(dateToDelete)}`,
    { method: 'POST' }
  );
}

// date format: DD.MM.YYYY
export async function insertFutureReport({ mainCode, secondaryCode, note = '', date }) {
  const boundary = `----DochOneApp${Date.now()}`;
  const parts = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="MainCode"',
    '',
    mainCode,
    `--${boundary}`,
    'Content-Disposition: form-data; name="SecondaryCode"',
    '',
    secondaryCode,
    `--${boundary}`,
    'Content-Disposition: form-data; name="Note"',
    '',
    note,
    `--${boundary}`,
    'Content-Disposition: form-data; name="FutureReportDate"',
    '',
    date,
    `--${boundary}--`,
    '',
  ];
  const body = parts.join('\r\n');

  return request('/api/Attendance/InsertFutureReport', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

// --- Local settings -----------------------------------------------------

const SETTINGS_KEY = 'doch1_settings';

export async function getSettings() {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSettings(settings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function getReportedData() {
  return request('/api/Attendance/GetReportedData');
}

export async function loginCommander() {
  return request('/api/account/loginCommander', { method: 'POST' });
}

export async function getGroups(groupCode = '') {
  return request(`/api/attendance/GetGroups?groupcode=${encodeURIComponent(groupCode)}`);
}

// Returns { isUserAuth, isCommanderAuth, error }
export async function getUser() {
  const cookieHeader = await getStoredCookieHeader();
  if (!cookieHeader.includes('AppCookie=')) return { isUserAuth: false, isCommanderAuth: false, error: null };
  const res = await fetch(`${BASE_URL}/api/account/getUser`, {
    headers: { accept: 'application/json, text/plain, */*', cookie: cookieHeader },
  });
  if (!res.ok) return { isUserAuth: false, isCommanderAuth: false, error: null };
  return res.json();
}

// --- Headless session refresh (Microsoft Entra / MSAL) -----------------
//
// The portal authenticates via Azure AD (Entra) using MSAL.js. Recovering a
// dead AppCookie without any user interaction has two layers, mirroring what
// a real WebView login does (confirmed by on-device instrumented traces):
//
//   1. FAST PATH — redeem the cached MSAL refresh token directly at Azure's
//      token endpoint (grant_type=refresh_token) → fresh id_token. This
//      token is short-lived (~24h per hop, rotates each use); it's the
//      credential useLoginDetection's MSAL_RT_CAPTURE_JS pulls out of
//      localStorage and this file persists.
//   2. FALLBACK — if the cached refresh token itself has gone stale
//      (invalid_grant), a real WebView doesn't just give up: MSAL falls back
//      to a SILENT SSO CHECK against Azure (a prompt=none authorize request)
//      that succeeds purely because of Azure's OWN session cookie
//      (ESTSAUTHPERSISTENT etc. on login.microsoftonline.com, ~month-long —
//      already sitting in this app's cookie jar from past real logins). That
//      request returns an authorization code, which is redeemed
//      (grant_type=authorization_code, PKCE) for a fresh id_token AND a new
//      refresh token, restarting the fast-path chain. This is Azure's actual
//      month-long credential — not the refresh token, which is why opening
//      the app after a long gap still works with no password.
//
// Either way, once we have a fresh id_token: GET /api/account/login with
// `Authorization: <id_token>` (the RAW id_token, no "Bearer " prefix —
// verified from the trace) → the backend Set-Cookies a fresh AppCookie.
//
// All of this runs in plain headless JS (including a hand-rolled SHA-256 for
// PKCE — see below — since adding a crypto native module would require a
// prebuild), so the background worker can keep the week filled without the
// app ever being opened, for as long as the underlying login lives.

const MSAL_RT_KEY = 'doch1_msal_rt';
// Scope the SPA itself requests (from the trace). offline_access makes Azure
// return a rotated refresh token each time, so the chain continues.
const AAD_SCOPE = 'User.Read openid profile offline_access';
const AAD_LOGIN_ORIGIN = 'https://login.microsoftonline.com';
const aadAuthority = (tenantId) => `${AAD_LOGIN_ORIGIN}/${tenantId}`;

// { secret, clientId, tenantId, username? } — captured from MSAL's
// localStorage. username (if present) is the account's UPN, used as
// login_hint for the silent-SSO fallback so Azure doesn't have to guess which
// signed-in account to check.
export async function saveMsalRefreshToken(data) {
  if (!data?.secret) return;
  const prev = (await getMsalRefreshToken()) || {};
  await AsyncStorage.setItem(MSAL_RT_KEY, JSON.stringify({ ...prev, ...data }));
}

export async function getMsalRefreshToken() {
  const raw = await AsyncStorage.getItem(MSAL_RT_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function clearMsalRefreshToken() {
  await AsyncStorage.removeItem(MSAL_RT_KEY);
}

function encodeForm(fields) {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// Manual query-string parse (not URLSearchParams — avoids depending on a
// polyfill being present in this RN/Hermes environment).
function parseQuery(qs) {
  const out = {};
  String(qs || '')
    .split('&')
    .filter(Boolean)
    .forEach((kv) => {
      const i = kv.indexOf('=');
      const k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
      const v = decodeURIComponent(i < 0 ? '' : kv.slice(i + 1));
      out[k] = v;
    });
  return out;
}

// --- Pure-JS crypto for PKCE (no native module, so no prebuild needed) ---
// Byte-for-byte cross-checked against Node's own crypto module (sha256 and
// base64) before shipping, including a >64-byte input crossing a block
// boundary and a 32-byte random buffer.
function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}
function sha256(data) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = data.length;
  const padLen = (l + 1 + 8 + 63) & ~63;
  const msg = new Uint8Array(padLen);
  msg.set(data);
  msg[l] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(padLen - 8, Math.floor((l * 8) / 0x100000000), false);
  dv.setUint32(padLen - 4, (l * 8) >>> 0, false);
  const w = new Uint32Array(64);
  for (let chunk = 0; chunk < padLen; chunk += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(chunk + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outDv.setUint32(i * 4, H[i], false);
  return out;
}
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Encode(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const triplet = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0);
    result += B64_CHARS[(triplet >> 18) & 63];
    result += B64_CHARS[(triplet >> 12) & 63];
    result += i + 1 < bytes.length ? B64_CHARS[(triplet >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? B64_CHARS[triplet & 63] : '=';
  }
  return result;
}
function base64UrlEncode(bytes) {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomBytes(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}
function asciiBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

// Redeem the cached MSAL refresh token directly. { ok, idToken, refreshToken }
// on success; on failure, { ok:false, reason, retryWithSso } — retryWithSso
// is set only for invalid_grant (the refresh token itself is dead), where
// falling back to the SSO-cookie path below makes sense; other failures
// (network errors, bad client config) wouldn't be fixed by that fallback.
async function redeemRefreshToken(rt) {
  try {
    const tokenRes = await fetch(`${aadAuthority(rt.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        // SPA-issued refresh tokens must be redeemed cross-origin; Azure
        // checks Origin (AADSTS9002327 otherwise). RN lets us set it.
        origin: BASE_URL,
      },
      body: encodeForm({
        client_id: rt.clientId,
        scope: AAD_SCOPE,
        grant_type: 'refresh_token',
        refresh_token: rt.secret,
        client_info: '1',
      }),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      let errCode = '';
      try {
        errCode = JSON.parse(errText)?.error || '';
      } catch (_) {}
      return {
        ok: false,
        reason: `token-${tokenRes.status}:${errCode} ${errText.slice(0, 160)}`,
        retryWithSso: tokenRes.status === 400 && errCode === 'invalid_grant',
      };
    }
    const tokens = await tokenRes.json();
    if (!tokens?.id_token) return { ok: false, reason: 'no-id-token', retryWithSso: false };
    return { ok: true, idToken: tokens.id_token, refreshToken: tokens.refresh_token };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e).slice(0, 200), retryWithSso: false };
  }
}

// Silent SSO fallback: what a real browser does when MSAL's cached refresh
// token has gone stale but the user is still "logged in" from Azure's point
// of view. A prompt=none authorize request succeeds purely off Azure's own
// session cookie (already in this app's cookie jar from a past real login),
// returning an authorization code we redeem with PKCE — no browser required,
// since RN's fetch never auto-attaches cookies anyway (we already build the
// header by hand everywhere else in this file), and the final redirect lands
// back on our own origin where `res.url` is already relied on elsewhere
// (attemptSilentReauth, TestConnectionScreen's inspectUrl).
async function trySsoSilent(rt) {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(sha256(asciiBytes(verifier)));
  const state = base64UrlEncode(randomBytes(16));
  const nonce = base64UrlEncode(randomBytes(16));

  const authorizeUrl = `${aadAuthority(rt.tenantId)}/oauth2/v2.0/authorize?${encodeForm({
    client_id: rt.clientId,
    response_type: 'code',
    redirect_uri: BASE_URL,
    scope: AAD_SCOPE,
    response_mode: 'query',
    prompt: 'none',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    login_hint: rt.username,
  })}`;

  let authRes;
  try {
    const cookieHeader = await getCookieHeaderForDomain(AAD_LOGIN_ORIGIN);
    authRes = await fetch(authorizeUrl, {
      redirect: 'follow',
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
  } catch (e) {
    return { ok: false, reason: `authorize-network-error: ${String(e?.message || e).slice(0, 160)}` };
  }

  const finalUrl = authRes?.url || '';
  const query = parseQuery(finalUrl.split('?')[1]);
  if (!query.code) {
    return {
      ok: false,
      reason: `authorize-no-code: error=${query.error || 'unknown'} desc=${(query.error_description || '').slice(0, 160)} finalUrl=${finalUrl.slice(0, 200)}`,
    };
  }

  try {
    const tokenRes = await fetch(`${aadAuthority(rt.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', origin: BASE_URL },
      body: encodeForm({
        client_id: rt.clientId,
        scope: AAD_SCOPE,
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: BASE_URL,
        code_verifier: verifier,
        client_info: '1',
      }),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      return { ok: false, reason: `sso-token-${tokenRes.status}: ${errText.slice(0, 160)}` };
    }
    const tokens = await tokenRes.json();
    if (!tokens?.id_token) return { ok: false, reason: 'sso-no-id-token' };
    return { ok: true, idToken: tokens.id_token, refreshToken: tokens.refresh_token };
  } catch (e) {
    return { ok: false, reason: `sso-token-network-error: ${String(e?.message || e).slice(0, 160)}` };
  }
}

// Shared tail of both refresh paths: exchange a fresh id_token for a fresh
// AppCookie, persist a rotated refresh token if we got one, and confirm.
async function finishSessionRefresh(idToken, rt, rotatedRefreshToken) {
  if (rotatedRefreshToken) await saveMsalRefreshToken({ ...rt, secret: rotatedRefreshToken });

  const cookieHeader = await getStoredCookieHeader();
  const loginRes = await fetch(`${BASE_URL}/api/account/login`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      authorization: idToken,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });
  if (!loginRes.ok) return { ok: false, attempted: true, reason: `login-${loginRes.status}` };

  try {
    await CookieManager.flush?.();
  } catch (_) {}
  const verify = await getUser();
  if (verify?.isUserAuth) return { ok: true, attempted: true };
  return { ok: false, attempted: true, reason: 'login-ok-but-getuser-unauth' };
}

// Exposed for on-device testing (TestConnectionScreen's "Test SSO fallback
// (force)") — exercises ONLY the silent-SSO path directly, without waiting
// ~24h for the cached refresh token to actually go stale.
export async function testSsoFallback() {
  const rt = await getMsalRefreshToken();
  if (!rt?.tenantId || !rt?.clientId) return { ok: false, attempted: true, reason: 'no-stored-token-metadata' };
  const sso = await trySsoSilent(rt);
  if (!sso.ok) return { ok: false, attempted: true, reason: sso.reason };
  return finishSessionRefresh(sso.idToken, rt, sso.refreshToken);
}

// Ensure there's a working session, refreshing a dead AppCookie headlessly if
// possible. Returns { ok, attempted }:
//   ok        — we now have a live session (getUser confirms it).
//   attempted — whether a real refresh was tried. Lets the caller tell a
//               genuine long-login death (attempted && !ok → notify
//               "re-login required") apart from "nothing to try" (no stored
//               refresh token yet).
export async function refreshAppCookie() {
  try {
    const user = await getUser();
    if (user?.isUserAuth) return { ok: true, attempted: false };
  } catch (_) {
    // Network hiccup — fall through and try a real refresh.
  }

  const rt = await getMsalRefreshToken();
  if (!rt?.secret || !rt?.tenantId || !rt?.clientId) {
    // No Azure refresh token captured yet — only a real WebView login can
    // seed one. Treat as "needs login".
    return { ok: false, attempted: true, reason: 'no-refresh-token' };
  }

  try {
    // Fast path: redeem the cached refresh token directly.
    const direct = await redeemRefreshToken(rt);
    if (direct.ok) return finishSessionRefresh(direct.idToken, rt, direct.refreshToken);

    if (!direct.retryWithSso) {
      // Not a "refresh token is dead" failure (network blip, bad config) —
      // retrying via SSO wouldn't help, and the token might still be good
      // next time, so don't clear it.
      return { ok: false, attempted: true, reason: direct.reason };
    }

    // Fallback: the cached refresh token is genuinely dead, but the
    // underlying (~monthly) login may still be alive via Azure's SSO
    // cookie — exactly what a real WebView login would fall back to.
    const sso = await trySsoSilent(rt);
    if (sso.ok) return finishSessionRefresh(sso.idToken, rt, sso.refreshToken);

    // Both mechanisms failed — the long-lived login really is dead.
    await clearMsalRefreshToken();
    return { ok: false, attempted: true, reason: `direct:${direct.reason} | sso:${sso.reason}` };
  } catch (e) {
    return { ok: false, attempted: true, reason: String(e?.message || e).slice(0, 200) };
  }
}

export async function getAllFilterStatuses() {
  return request('/api/Attendance/GetAllFilterStatuses');
}

export async function getAllGroupsStatistics() {
  return request('/api/Attendance/getAllGroupsStatistics');
}

export async function getGroupUsers(groupCode) {
  return request(`/api/attendance/GetGroupUsers?groupcode=${encodeURIComponent(groupCode)}`);
}

export async function updateAndSendPrat({ mi, mainStatusCode, secondaryStatusCode, groupCode, note = '' }) {
  return request('/api/Attendance/updateAndSendPrat', {
    method: 'POST',
    headers: { 'content-type': 'application/json;charset=utf-8' },
    body: JSON.stringify({ mi, mainStatusCode, secondaryStatusCode, groupCode: String(groupCode), note }),
  });
}

const STATUSES_CACHE_KEY = 'doch1_statuses';

export async function refreshStatuses() {
  try {
    const data = await getAllFilterStatuses();
    const statuses = (data?.primaries || [])
      .filter((p) => !p.isEmergency)
      .map((p) => ({
        statusCode: p.statusCode,
        statusDescription: p.statusDescription.trim(),
        icon: (p.icon || '').replace('img/', '').replace('.png', ''),
        secondaries: (p.secondaries || [])
          .filter((s) => s.futureReportDays > 0)
          .map((s) => ({
            statusCode: s.statusCode,
            statusDescription: s.statusDescription.trim(),
          })),
      }));
    if (statuses.length > 0) {
      await AsyncStorage.setItem(STATUSES_CACHE_KEY, JSON.stringify(statuses));
    }
    return statuses;
  } catch (_) {
    return null;
  }
}

export async function getCachedStatuses() {
  try {
    const raw = await AsyncStorage.getItem(STATUSES_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}
