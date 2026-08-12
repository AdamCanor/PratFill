const { withAndroidManifest } = require('expo/config-plugins');

// Force android:allowBackup="false" on the <application> node. expo-build-properties
// does not expose allowBackup, and prebuild regenerates the manifest with the
// default (true), so a hand edit to android/ would be silently reverted on the
// next prebuild. This plugin makes the secure default part of the config so it
// survives every prebuild: the app's private storage — including the SecureStore
// token — must not be eligible for adb/auto-backup extraction.
module.exports = function withDisableAllowBackup(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:allowBackup'] = 'false';
    }
    return cfg;
  });
};
