import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_LAUNCH_REFRESH_KEY = 'doch1_launch_refresh_last_run';

// Diagnostic trail for RootNavigator's launch-time session recovery — which
// mechanism (headless refreshAppCookie vs. the hidden SessionRefreshWebView)
// actually produced the working session, and why the other one (if tried)
// didn't. Only written when getUser() first came back unauthenticated — the
// common already-logged-in launch stays quiet.
export async function recordLaunchRefresh(result) {
  await AsyncStorage.setItem(
    LAST_LAUNCH_REFRESH_KEY,
    JSON.stringify({ ...result, at: new Date().toISOString() })
  );
}

export async function getLastLaunchRefresh() {
  const raw = await AsyncStorage.getItem(LAST_LAUNCH_REFRESH_KEY);
  return raw ? JSON.parse(raw) : null;
}
