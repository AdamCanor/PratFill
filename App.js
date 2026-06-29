import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { registerAutoSubmitTask } from './src/tasks/autoSubmitTask';
import UpdateModal from './src/components/UpdateModal';
import { checkForUpdate } from './src/utils/updates';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdate, setShowUpdate] = useState(false);

  useEffect(() => {
    Notifications.requestPermissionsAsync();
    registerAutoSubmitTask().catch(() => {});
    const updateTimer = setTimeout(() => {
      checkForUpdate()
        .then(info => {
          if (info) {
            setUpdateInfo(info);
            setShowUpdate(true);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(updateTimer);
  }, []);

  return (
    <ThemeProvider>
      <RootNavigator />
      <StatusBar style="light" />
      <UpdateModal
        visible={showUpdate}
        updateInfo={updateInfo}
        onDismiss={() => setShowUpdate(false)}
      />
    </ThemeProvider>
  );
}
