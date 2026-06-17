import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import SettingsScreen from '../screens/SettingsScreen';
import TestConnectionScreen from '../screens/TestConnectionScreen';
import { getUser, refreshStatuses } from '../api/doch1';
import { colors } from '../theme';
import { AccentProvider } from '../AccentContext';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

export default function RootNavigator() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [isCommander, setIsCommander] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await getUser();
      setIsCommander(!!user?.isCommanderAuth);
      setInitialRoute(user?.isUserAuth ? 'Home' : 'Login');
      if (user?.isUserAuth) refreshStatuses().catch(() => {});
    })();
  }, []);

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
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <AccentProvider>
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ title: 'התחברות' }}
        />
        <Stack.Screen
          name="Home"
          options={{ title: 'דוח 67', headerShown: false }}
        >
          {(props) => <HomeScreen {...props} isCommanderProp={isCommander} />}
        </Stack.Screen>
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'הגדרות' }}
        />
        <Stack.Screen
          name="TestConnection"
          component={TestConnectionScreen}
          options={{ title: 'Test Connection' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
    </AccentProvider>
  );
}
