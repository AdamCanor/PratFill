import AsyncStorage from '@react-native-async-storage/async-storage';
import CookieManager from '@preeternal/react-native-cookie-manager';

const BASE_URL = 'https://one.prat.idf.il';
const COOKIE_DOMAIN = 'https://one.prat.idf.il';

// --- Cookie handling -------------------------------------------------

export async function getStoredCookieHeader() {
  const cookies = await CookieManager.get(COOKIE_DOMAIN);
  // Build a Cookie header from whatever cookies are present for the domain.
  // AppCookie is the important one, but send everything that's there.
  return Object.entries(cookies || {})
    .map(([name, c]) => `${name}=${c.value}`)
    .join('; ');
}

export async function hasAppCookie() {
  const cookies = await CookieManager.get(COOKIE_DOMAIN);
  return Boolean(cookies && cookies.AppCookie && cookies.AppCookie.value);
}

export async function clearCookies() {
  await CookieManager.clearAll();
}

// --- Generic request helper ------------------------------------------

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

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

export { AuthError };

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

export async function getAllFilterStatuses() {
  return request('/api/Attendance/GetAllFilterStatuses');
}
