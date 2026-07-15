import React, { useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, spacing } from '../theme';
import { LOGIN_URL } from '../api/doch1';
import { useLoginDetection, MSAL_RT_CAPTURE_JS, handleLoginWebViewMessage } from '../hooks/useLoginDetection';

export default function LoginScreen({ navigation }) {
  const webviewRef = useRef(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('ממתין להתחברות...');

  const { onNavigationStateChange } = useLoginDetection({
    onLoggedInPageSeen: () => {
      setStatus('מאמת חיבור...');
      setChecking(true);
    },
    onCheckSettled: () => setChecking(false),
    onAuthenticated: useCallback(() => {
      setChecking(false);
      setStatus('התחברות הצליחה');
      navigation.replace('Home');
    }, [navigation]),
  });

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
        injectedJavaScript={MSAL_RT_CAPTURE_JS}
        onMessage={handleLoginWebViewMessage}
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
