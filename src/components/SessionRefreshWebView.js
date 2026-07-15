import React, { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { LOGIN_URL, getUser } from '../api/doch1';
import { useLoginDetection } from '../hooks/useLoginDetection';

const REFRESH_TIMEOUT_MS = 30000;

// Off-screen WebView that replays the portal's silent login. Per the session
// model in doch1.js, a dead AppCookie can never be refreshed by a headless
// fetch — but a real browser engine loading the portal recovers silently for
// as long as the underlying ~2-week login lasts. This component is that
// browser engine, minus the screen: mount it, and it either produces a
// working session (onSuccess(user)) or gives up (onFailure(reason)) so the
// caller can fall back to the visible LoginScreen.
//
// Success is confirmed with a live getUser() call rather than cookie
// presence or value comparison: it's the same authoritative check the app
// gates on at launch, and it also covers the case where the original
// failure was transient and the existing cookie is still valid.
export default function SessionRefreshWebView({ onSuccess, onFailure }) {
  const settledRef = useRef(false);
  const userRef = useRef(null);

  const settle = useCallback((fire) => {
    if (settledRef.current) return;
    settledRef.current = true;
    fire();
  }, []);

  const { onNavigationStateChange } = useLoginDetection({
    isAcceptable: async () => {
      try {
        const user = await getUser();
        userRef.current = user;
        return !!user?.isUserAuth;
      } catch (_) {
        // Network hiccup — treat as not-yet-authenticated; the timeout is
        // the backstop.
        return false;
      }
    },
    onAuthenticated: () => {
      settle(() => onSuccess(userRef.current));
    },
  });

  useEffect(() => {
    const timer = setTimeout(
      () => settle(() => onFailure('timeout')),
      REFRESH_TIMEOUT_MS
    );
    return () => clearTimeout(timer);
  }, [settle, onFailure]);

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        source={{ uri: LOGIN_URL }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        onNavigationStateChange={onNavigationStateChange}
        onLoadEnd={onNavigationStateChange}
        onError={() => settle(() => onFailure('load error'))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // 1x1 instead of 0x0 — some Android WebView versions skip layout (and JS
  // execution with it) for zero-sized views.
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
});
