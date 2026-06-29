import { DownloadTask, Paths, File } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
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
  const destFile = new File(Paths.cache, 'pratfill-update.apk');

  try { destFile.delete(); } catch {}

  const task = new DownloadTask(downloadUrl, destFile);
  task.addListener('progress', ({ bytesWritten, totalBytes }) => {
    if (totalBytes > 0) onProgress(bytesWritten / totalBytes);
  });

  const downloaded = await task.downloadAsync();
  if (!downloaded?.uri) throw new Error('Download failed');
  return downloaded.uri;
}

export async function installApk(localUri) {
  const contentUri = await getContentUriAsync(localUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}
