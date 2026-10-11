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
import LaunchSteps from '../components/LaunchSteps';
import { recordLaunchRefresh } from '../utils/launchRefreshLog';
import { colors, spacing } from '../theme';
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

// getUser() is a bare fetch: no timeout (RN's fetch has none), and it throws
// on a network error. Unguarded, a slow/hung server strands the spinner for
// as long as the socket stays open, and a throw kills the launch IIFE before
// it ever sets a route — spinner forever. null = no verdict; callers treat it
// like "not authenticated" and move on to the next recovery step.
const USER_CHECK_TIMEOUT_MS = 12000;
async function checkUser() {
  try {
    return await withTimeout(getUser(), USER_CHECK_TIMEOUT_MS, null);
  } catch (_) {
    return null;
  }
}

// The launch recovery chain below, in order. 'recheck' only runs when the
// headless refresh succeeds — on failure it's dropped from the list and the
// chain jumps straight to the WebView replay.
const LAUNCH_STEPS = [
  { id: 'check', label: 'בודק התחברות…' },
  { id: 'refresh', label: 'מחדש התחברות…' },
  { id: 'recheck', label: 'מאמת התחברות…' },
  { id: 'webview', label: 'מתחבר מחדש לפורטל…' },
];

export default function RootNavigator() {
  const { accentColor } = useTheme();
  const [initialRoute, setInitialRoute] = useState(null);
  const [isCommander, setIsCommander] = useState(false);
  const [silentRefreshing, setSilentRefreshing] = useState(false);
  const [steps, setSteps] = useState(LAUNCH_STEPS);
  const [phase, setPhase] = useState('check');
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
      const user = await checkUser();
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
      setPhase('refresh');
      const headless = await withTimeout(refreshAppCookie(), HEADLESS_REFRESH_TIMEOUT_MS, {
        ok: false,
        attempted: true,
        reason: 'client-timeout',
      });

      if (headless.ok) {
        setPhase('recheck');
        const refreshed = await checkUser();
        if (refreshed?.isUserAuth) {
          recordLaunchRefresh({ resolvedVia: 'headless', headless: { ok: true }, webview: null }).catch(() => {});
          onAuthenticated(refreshed);
          return;
        }
      }

      headlessResultRef.current = { ok: false, reason: headless.ok ? 're-check-failed' : headless.reason };
      if (!headless.ok) setSteps((prev) => prev.filter((s) => s.id !== 'recheck'));
      setPhase('webview');
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
        <View style={{ marginTop: spacing.md, alignSelf: 'stretch' }}>
          <LaunchSteps steps={steps} currentId={phase} accentColor={accentColor} />
        </View>
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
