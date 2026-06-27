import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { registerAutoSubmitTask } from './src/tasks/autoSubmitTask';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  useEffect(() => {
    Notifications.requestPermissionsAsync();
    registerAutoSubmitTask().catch(() => {});
  }, []);

  return (
    <ThemeProvider>
      <RootNavigator />
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
