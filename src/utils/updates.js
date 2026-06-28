import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';

const RELEASES_API = 'https://api.github.com/repos/AdamCanor/PratFill/releases/latest';
const CURRENT_VERSION = Constants.expoConfig?.version ?? '0.0.0';

function parseVersionFromTag(tag) {
  const match = tag.match(/^v(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function isNewerVersion(current, latest) {
  const c = current.split('.').map(Number);
  const l = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}

export async function checkForUpdate() {
  const res = await fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const release = await res.json();

  const latestVersion = parseVersionFromTag(release.tag_name);
  if (!latestVersion || !isNewerVersion(CURRENT_VERSION, latestVersion)) return null;

  const apkAsset = release.assets?.find(a => a.name.endsWith('.apk'));
  if (!apkAsset) return null;

  return {
    version: latestVersion,
    notes: release.body ?? '',
    downloadUrl: apkAsset.browser_download_url,
    size: apkAsset.size,
  };
}

export async function downloadApk(downloadUrl, onProgress) {
  const destUri = FileSystem.cacheDirectory + 'pratfill-update.apk';

  const existing = await FileSystem.getInfoAsync(destUri);
  if (existing.exists) await FileSystem.deleteAsync(destUri, { idempotent: true });

  const task = FileSystem.createDownloadResumable(
    downloadUrl,
    destUri,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite > 0) {
        onProgress(totalBytesWritten / totalBytesExpectedToWrite);
      }
    }
  );

  const result = await task.downloadAsync();
  if (!result?.uri) throw new Error('Download failed');
  return result.uri;
}

export async function installApk(localUri) {
  const contentUri = await FileSystem.getContentUriAsync(localUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
