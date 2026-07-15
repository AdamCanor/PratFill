import { useCallback, useRef } from 'react';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { COOKIE_DOMAIN } from '../api/doch1';

// Pages that only render once the AppCookie session is established.
export const LOGGED_IN_PATH_HINTS = ['/hp', '/secondaries', '/calendar', '/primaries'];

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
