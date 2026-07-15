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
// — which needs the portal's real silent-refresh mechanism, still to be
// identified via the "Instrumented login trace" in TestConnectionScreen.
//
// Supporting pieces already in place:
// - refreshAppCookie() is the seam the background worker calls before every
//   submit. Its refresh body is a no-op until the trace identifies the
//   mechanism (then Path A: replicate the HTTP call the SPA's JS makes, or
//   Path B: drive a native background WebView).
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

// Ensure there's a working session, refreshing a dead AppCookie headlessly if
// possible. This is the seam the whole autonomous-daily background feature
// hangs on: the worker calls it before every submit so the week stays filled
// without the user ever opening the app.
//
// Returns { ok, attempted }:
//   ok        — we now have a live session (getUser confirms it).
//   attempted — whether a real headless refresh was actually tried. This lets
//               the caller tell a genuine long-login death (attempted && !ok
//               → notify "re-login required") apart from "no refresh mechanism
//               wired up yet" (!attempted && !ok → stay quiet / fall back to a
//               coverage-based throttle).
//
// The refresh BODY is deliberately still a no-op: a plain headless fetch
// cannot revive a dead AppCookie for this site (proven — see the session
// model above), and the mechanism a real browser uses is not yet identified.
// The "Instrumented login trace" tool in TestConnectionScreen exists to
// capture it; once known, this is where Path A (replicate the HTTP call[s]
// the SPA's JS makes) or Path B (drive a native background WebView) plugs in,
// setting attempted:true.
export async function refreshAppCookie() {
  try {
    const user = await getUser();
    if (user?.isUserAuth) return { ok: true, attempted: false };
  } catch (_) {
    // Network hiccup — fall through and report we couldn't establish one.
  }

  // >>> Step 2 (post-trace) implements the real headless refresh here. <<<
  return { ok: false, attempted: false, reason: 'refresh-not-implemented' };
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
