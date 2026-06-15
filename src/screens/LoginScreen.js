import React, { useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import CookieManager from '@react-native-cookies/cookies';
import { colors, spacing } from '../theme';

const LOGIN_URL = 'https://one.prat.idf.il/';
// Pages that only render once the AppCookie session is established.
const LOGGED_IN_PATH_HINTS = ['/hp', '/secondaries', '/calendar', '/primaries'];

export default function LoginScreen({ navigation }) {
  const webviewRef = useRef(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('טוען...');

  const checkCookie = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const cookies = await CookieManager.get('https://one.prat.idf.il');
      if (cookies && cookies.AppCookie && cookies.AppCookie.value) {
        setStatus('התחברות הצליחה');
        navigation.replace('Home');
        return;
      }
    } finally {
      setChecking(false);
    }
  }, [checking, navigation]);

  const onNavigationStateChange = useCallback(
    (navState) => {
      const url = navState.url || '';
      const matchesLoggedIn = LOGGED_IN_PATH_HINTS.some((p) => url.includes(p));
      if (matchesLoggedIn) {
        setStatus('מאמת חיבור...');
        checkCookie();
      }
    },
    [checkCookie]
  );

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>{status}</Text>
        {checking && <ActivityIndicator color={colors.accent} style={{ marginLeft: spacing.sm }} />}
      </View>
      <WebView
        ref={webviewRef}
        source={{ uri: LOGIN_URL }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        onNavigationStateChange={onNavigationStateChange}
        onLoadEnd={onNavigationStateChange}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bannerText: { color: colors.textMuted, fontSize: 13 },
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
