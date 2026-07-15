import React, { useCallback, useEffect, useState } from 'react';
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
import { getUser, refreshStatuses } from '../api/doch1';
import { runAutoSubmitIfStale } from '../tasks/runAutoSubmit';
import SessionRefreshWebView from '../components/SessionRefreshWebView';
import { colors } from '../theme';
import { useTheme } from '../context/ThemeContext';

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { accentColor } = useTheme();
  const [initialRoute, setInitialRoute] = useState(null);
  const [isCommander, setIsCommander] = useState(false);
  const [silentRefreshing, setSilentRefreshing] = useState(false);

  const onAuthenticated = useCallback((user) => {
    setIsCommander(!!user?.isCommanderAuth);
    setSilentRefreshing(false);
    setInitialRoute('Home');
    refreshStatuses().catch(() => {});
    // Catch-up fill: with the session fresh, any reports the background task
    // missed while AppCookie was dead get submitted right now.
    runAutoSubmitIfStale().catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const user = await getUser();
      if (user?.isUserAuth) {
        onAuthenticated(user);
      } else {
        // Not authenticated — but per the session model in doch1.js the
        // underlying login usually still lives (~2 weeks); only AppCookie
        // (~5h) has died. Try the hidden-WebView refresh behind the splash
        // before falling back to the visible Login screen.
        setSilentRefreshing(true);
      }
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
            onSuccess={onAuthenticated}
            onFailure={() => {
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
