import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SettingsPresetsScreen from '../screens/SettingsPresetsScreen';
import SettingsQuickButtonsScreen from '../screens/SettingsQuickButtonsScreen';
import SettingsAutoSubmitScreen from '../screens/SettingsAutoSubmitScreen';
import SettingsGeneralScreen from '../screens/SettingsGeneralScreen';
import SettingsDevScreen from '../screens/SettingsDevScreen';
import TestConnectionScreen from '../screens/TestConnectionScreen';
import { getUser, refreshAppCookie, refreshStatuses } from '../api/doch1';
import SessionRefreshWebView from '../components/SessionRefreshWebView';
import { recordLaunchRefresh } from '../utils/launchRefreshLog';
import { colors } from '../theme';
import { useTheme } from '../context/ThemeContext';

const Stack = createNativeStackNavigator();

// refreshAppCookie()'s own fetch chain carries no timeout (only the dead
// attemptSilentReauth() in doch1.js has one) — without this, a hung request
// here would strand the launch spinner forever, upstream of the WebView
// fallback that would otherwise time out on its own in 30s.
const HEADLESS_REFRESH_TIMEOUT_MS = 8000;
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

export default function RootNavigator() {
  const { accentColor } = useTheme();
  const [initialRoute, setInitialRoute] = useState(null);
  const [isCommander, setIsCommander] = useState(false);
  const [silentRefreshing, setSilentRefreshing] = useState(false);
  const headlessResultRef = useRef(null);

  const onAuthenticated = useCallback((user) => {
    setIsCommander(!!user?.isCommanderAuth);
    setSilentRefreshing(false);
    setInitialRoute('Home');
    refreshStatuses().catch(() => {});
    // Auto-submit is background-only by design — opening the app never
    // triggers a submit. In the foreground the user presses the fill button
    // themselves; only the background worker fills on its own.
  }, []);

  useEffect(() => {
    (async () => {
      const user = await getUser();
      if (user?.isUserAuth) {
        onAuthenticated(user);
        return;
      }

      // Not authenticated — but per the session model in doch1.js the
      // underlying login usually still lives (~1 month); only AppCookie
      // (~5h) has died. Try the SAME headless refresh the background task
      // already uses before falling back to the hidden-WebView replay: the
      // background task rotates the cached Azure refresh token on every run,
      // which can leave the WebView's own separately-cached copy stale and
      // force it onto a slower path that can miss its 30s timeout — even
      // though the headless path succeeds instantly with the same Azure
      // session.
      const headless = await withTimeout(refreshAppCookie(), HEADLESS_REFRESH_TIMEOUT_MS, {
        ok: false,
        attempted: true,
        reason: 'client-timeout',
      });

      if (headless.ok) {
        const refreshed = await getUser();
        if (refreshed?.isUserAuth) {
          recordLaunchRefresh({ resolvedVia: 'headless', headless: { ok: true }, webview: null }).catch(() => {});
          onAuthenticated(refreshed);
          return;
        }
      }

      headlessResultRef.current = { ok: false, reason: headless.ok ? 're-check-failed' : headless.reason };
      setSilentRefreshing(true);
    })();
  }, [onAuthenticated]);

  const navTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: accentColor,
    },
  };

  if (!initialRoute) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={accentColor} size="large" />
        {silentRefreshing && (
          <SessionRefreshWebView
            onSuccess={(user) => {
              recordLaunchRefresh({
                resolvedVia: 'webview',
                headless: headlessResultRef.current,
                webview: { ok: true },
              }).catch(() => {});
              onAuthenticated(user);
            }}
            onFailure={(reason) => {
              recordLaunchRefresh({
                resolvedVia: 'login-required',
                headless: headlessResultRef.current,
                webview: { ok: false, reason },
              }).catch(() => {});
              setSilentRefreshing(false);
              setInitialRoute('Login');
            }}
          />
        )}
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ title: 'התחברות' }}
        />
        <Stack.Screen
          name="Home"
          options={{ title: 'דו"ח 10', headerShown: false }}
        >
          {(props) => <HomeScreen {...props} isCommanderProp={isCommander} />}
        </Stack.Screen>
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'הגדרות' }}
        />
        <Stack.Screen
          name="SettingsPresets"
          component={SettingsPresetsScreen}
          options={{ title: 'תבניות שבועיות' }}
        />
        <Stack.Screen
          name="SettingsQuickButtons"
          component={SettingsQuickButtonsScreen}
          options={{ title: 'כפתורים מהירים' }}
        />
        <Stack.Screen
          name="SettingsAutoSubmit"
          component={SettingsAutoSubmitScreen}
          options={{ title: 'דיווח אוטומטי' }}
        />
        <Stack.Screen
          name="SettingsGeneral"
          component={SettingsGeneralScreen}
          options={{ title: 'כללי ומראה' }}
        />
        <Stack.Screen
          name="SettingsDev"
          component={SettingsDevScreen}
          options={{ title: 'כלי פיתוח' }}
        />
        <Stack.Screen
          name="TestConnection"
          component={TestConnectionScreen}
          options={{ title: 'Test Connection' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
