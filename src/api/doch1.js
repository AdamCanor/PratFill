import AsyncStorage from '@react-native-async-storage/async-storage';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { sha256, base64UrlEncode, randomBytes, asciiBytes } from '../utils/pkce';

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

// Diagnostic-only summary of the Azure SSO cookie jar (login.microsoftonline.com),
// for folding into a failure reason. Reports cookie NAMES only — never their
// values, since a cookie value here IS the session secret — plus the count, the
// built Cookie-header length, and the presence/expiry of the two Azure session
// cookies. This is what lets a silent-SSO login_required failure (AADSTS50058)
// say whether we even had an ESTSAUTH cookie to send (never captured → Case A)
// versus sent one Azure rejected (expired/session-only → Case B); the raw
// AADSTS50058 text is identical either way.
async function summarizeAadCookies() {
  try {
    const jar = (await CookieManager.get(AAD_LOGIN_ORIGIN)) || {};
    const names = Object.keys(jar);
    const note = (n) => (jar[n] ? `${n}(exp=${jar[n].expires || 'session'})` : `${n}=absent`);
    return `aadCookies=[${names.join(',') || 'none'}] count=${names.length} headerLen=${buildCookieHeader(jar).length} ${note('ESTSAUTHPERSISTENT')} ${note('ESTSAUTH')}`;
  } catch (e) {
    return `aadCookies=error:${String(e?.message || e).slice(0, 80)}`;
  }
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
// — CONFIRMED WORKING on-device, both its fast path (direct MSAL refresh
// token redemption) and its fallback (silent SSO via Azure's own session
// cookie, for when the refresh token itself has gone stale) — see
// refreshAppCookie's own doc block for the full flow and how each was
// verified.
//
// Supporting pieces already in place:
// - refreshAppCookie() (below) is the seam the background worker calls before
//   every submit — see its own doc block for the full flow.
// - On launch with a dead session, RootNavigator mounts the hidden
//   SessionRefreshWebView (components/SessionRefreshWebView.js) behind the
//   splash — a real WebView login, minus the screen. This is a SECONDARY
//   safety net (and the credential-capture point for the refresh/username
//   tokens), not the feature itself. The visible LoginScreen is the
//   last-resort fallback for a genuinely-expired (~monthly) login.
// - A background AuthError can still happen (transient network issues,
//   Azure hiccups); the worker only notifies "re-login" when a real refresh
//   attempt genuinely failed, or (before any refresh has ever been attempted)
//   when the filled window is actually about to run out (see
//   tasks/runAutoSubmit.js and tasks/autoSubmitTask.js).
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

// month: 1-12, year: e.g. 2026. Normalized to always return a plain array —
// the API wraps the actual list under one of a few keys depending on
// endpoint version (.days / .futureReports / .data), and every caller needs
// the flat list, not the wrapper.
export async function getFutureReports(month, year) {
  const data = await request('/api/Attendance/getFutureReport', {
    method: 'POST',
    headers: { 'content-type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ month, year }),
  });
  if (Array.isArray(data)) return data;
  return data?.days || data?.futureReports || data?.data || [];
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

// PKCE crypto (sha256/base64UrlEncode/randomBytes/asciiBytes) lives in
// ../utils/pkce.js — standard textbook SHA-256, extracted there to keep this
// file focused on the API/auth logic. Imported at the top of the file.

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
  // Captured before the request so it's available in every failure branch —
  // tells us which Azure session cookies we actually had to send (see
  // summarizeAadCookies).
  const cookieSummary = await summarizeAadCookies();
  try {
    const cookieHeader = await getCookieHeaderForDomain(AAD_LOGIN_ORIGIN);
    authRes = await fetch(authorizeUrl, {
      redirect: 'follow',
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
  } catch (e) {
    return { ok: false, reason: `authorize-network-error: ${String(e?.message || e).slice(0, 160)} | ${cookieSummary}` };
  }

  const finalUrl = authRes?.url || '';
  const query = parseQuery(finalUrl.split('?')[1]);
  if (!query.code) {
    return {
      ok: false,
      reason: `authorize-no-code: error=${query.error || 'unknown'} desc=${(query.error_description || '').slice(0, 160)} finalUrl=${finalUrl.slice(0, 200)} | ${cookieSummary}`,
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
