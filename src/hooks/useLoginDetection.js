import { useCallback, useRef } from 'react';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { COOKIE_DOMAIN, saveMsalRefreshToken } from '../api/doch1';

// Pages that only render once the AppCookie session is established.
export const LOGGED_IN_PATH_HINTS = ['/hp', '/secondaries', '/calendar', '/primaries'];

// Injected into the login WebView to capture MSAL's Azure refresh token out
// of localStorage so the headless background refresh (refreshAppCookie in
// doch1.js) has a credential to work with. MSAL writes the token after its
// own exchange completes, so poll briefly. The token never leaves the device
// — it's postMessage'd to RN and stored in AsyncStorage, mirroring where MSAL
// itself keeps it (localStorage).
//
// Must be injected via `injectedJavaScriptBeforeContentLoaded`, not
// `injectedJavaScript` — the latter is only guaranteed to fire once, on the
// very first page load, and does not reliably re-run across the SPA's
// subsequent navigations. `injectedJavaScriptBeforeContentLoaded` re-fires on
// every top-level navigation (confirmed reliable — it's what
// TestConnectionScreen's instrumented trace uses, and that trace is what
// proved this exact localStorage key/shape in the first place).
export const MSAL_RT_CAPTURE_JS = `
(function () {
  function findUsername() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        // The MSAL AccountEntity key looks like <homeAccountId>-login.microsoftonline.com-<realm>
        // — distinguish it from the credential keys (refreshtoken/accesstoken/idtoken).
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
  function grab() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf('-refreshtoken-') >= 0) {
          var v = JSON.parse(localStorage.getItem(k) || '{}');
          if (v && v.secret) {
            var tid = '';
            if (v.homeAccountId && v.homeAccountId.indexOf('.') >= 0) tid = v.homeAccountId.split('.')[1];
            window.ReactNativeWebView.postMessage(JSON.stringify({ __msalRt: true, secret: v.secret, clientId: v.clientId || '', tenantId: tid, username: findUsername() }));
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  }
  if (!grab()) { var n = 0; var iv = setInterval(function () { if (grab() || ++n > 20) clearInterval(iv); }, 1000); }
  true;
})();
`;

// Origins the login WebViews legitimately load: the IDF portal (where MSAL.js
// runs and keeps its tokens) and Microsoft's sign-in host. A refresh token is
// trusted only when its message arrives from one of these — a postMessage from
// any other page the WebView might be steered to is ignored, so a forged token
// can't be planted from off-origin content.
export const TRUSTED_WEBVIEW_ORIGINS = [
  'https://one.prat.idf.il',
  'https://login.microsoftonline.com',
];

export function isTrustedWebViewOrigin(url) {
  const u = String(url || '');
  return TRUSTED_WEBVIEW_ORIGINS.some((o) => u === o || u.startsWith(o + '/'));
}

// onMessage handler for the login WebViews — persists a captured refresh
// token. Safe to wire on any WebView that injects MSAL_RT_CAPTURE_JS.
export async function handleLoginWebViewMessage(event) {
  try {
    if (!isTrustedWebViewOrigin(event?.nativeEvent?.url)) return;
    const msg = JSON.parse(event?.nativeEvent?.data);
    if (msg?.__msalRt && msg.secret && msg.tenantId && msg.clientId) {
      await saveMsalRefreshToken({ secret: msg.secret, clientId: msg.clientId, tenantId: msg.tenantId, username: msg.username || '' });
    }
  } catch (_) {
    // Non-RT message or parse error — ignore.
  }
}

// Shared "did this WebView actually log us in?" detection, used by both the
// visible LoginScreen and the hidden SessionRefreshWebView so the two paths
// can't drift. Watches navigation for logged-in pages, then confirms the
// session. `isAcceptable(appCookieValue)` (sync or async) lets callers add a
// stricter check than mere cookie presence — a stale AppCookie is never
// removed by the server, so presence alone can be a false positive.
// `onAuthenticated(appCookieValue)` fires at most once.
export function useLoginDetection({ onAuthenticated, isAcceptable, onLoggedInPageSeen, onCheckSettled }) {
  const checkingRef = useRef(false);
  const doneRef = useRef(false);

  const checkCookie = useCallback(async () => {
    if (checkingRef.current || doneRef.current) return;
    checkingRef.current = true;
    try {
      // Sync the native cookie store before reading, or a value the WebView
      // just wrote can read back stale.
      try {
        await CookieManager.flush?.();
      } catch (_) {}
      const cookies = await CookieManager.get(COOKIE_DOMAIN);
      const value = cookies?.AppCookie?.value;
      if (value && (!isAcceptable || (await isAcceptable(value))) && !doneRef.current) {
        doneRef.current = true;
        onAuthenticated(value);
      }
    } finally {
      checkingRef.current = false;
      if (!doneRef.current) onCheckSettled?.(false);
    }
  }, [onAuthenticated, isAcceptable, onCheckSettled]);

  // Attach to both onNavigationStateChange and onLoadEnd — some transitions
  // only surface through one of the two.
  const onNavigationStateChange = useCallback(
    (navState) => {
      const url = navState?.url || '';
      if (LOGGED_IN_PATH_HINTS.some((p) => url.includes(p))) {
        onLoggedInPageSeen?.(url);
        checkCookie();
      }
    },
    [checkCookie, onLoggedInPageSeen]
  );

  return { onNavigationStateChange };
}
