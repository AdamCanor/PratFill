import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/context/ThemeContext';
import { registerAutoSubmitTask } from './src/tasks/autoSubmitTask';
import { runAutoSubmitIfStale } from './src/tasks/runAutoSubmit';
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
    // Opportunistic catch-up on return from background — the app was likely
    // just opened because of (or shortly after) a background auth failure,
    // and the session is at its freshest right now. Launch itself is covered
    // by RootNavigator's auth flow; this handles warm foregrounds. If the
    // cookie died while backgrounded this throws AuthError and is swallowed
    // — the next cold launch recovers via the silent WebView refresh.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runAutoSubmitIfStale().catch(() => {});
    });
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
    return () => {
      clearTimeout(updateTimer);
      sub.remove();
    };
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
