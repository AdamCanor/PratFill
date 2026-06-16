@AGENTS.md

# PratFill — Claude working notes

## Project summary
React Native / Expo app (SDK 56) for IDF soldiers to submit future attendance reports ("דו״ח 1") via the One.Prat API.

## File map

| Path | Purpose |
|---|---|
| `src/api/doch1.js` | All API calls + cookie auth. |
| `src/data/statuses.js` | Static list of report codes. |
| `src/utils/dates.js` | Date helpers (`getUpcomingDates`, `toApiDate`, etc.). |
| `src/theme.js` | All colors, spacing, radius tokens. Use these — no hardcoded hex values in components. |
| `src/screens/HomeScreen.js` | Main screen. |
| `src/screens/LoginScreen.js` | WebView login flow — sets AppCookie. |
| `src/screens/SettingsScreen.js` | User preferences (default report codes). |
| `src/screens/TestConnectionScreen.js` | Debug screen for testing API connectivity. |
| `src/navigation/RootNavigator.js` | Stack navigator, auth gate. |
| `android/` | Committed native project — see Native section below. |

## UI conventions
- Dark theme. Accent: `colors.accent` (`#E8C547`).
- Hebrew-first, RTL. Use `I18nManager.forceRTL(true)` in screens.
- All style values from `src/theme.js` (`colors`, `spacing`, `radius`).
- Icons: `@expo/vector-icons` (`MaterialCommunityIcons`) — already installed, no new deps needed.

## Native project (android/)
`android/` is committed to the repo so CI skips `expo prebuild`.

**Re-run prebuild locally and commit the result when you:**
- Add or remove a package that has native Android code (anything with an `android/` folder in `node_modules/<pkg>/`)

```bash
npx expo prebuild -p android
git add android/
git commit -m "Update android/ after adding <package>"
```

Pure JS package changes (no native code) do not require a prebuild.

## API response shapes (confirmed)

### `getFutureReports(month, year)`
```json
{
  "days": [
    {
      "date": "2026-06-17T00:00:00",
      "reportedStatusCode": "0101",
      "reportedMainName": "נמצא/ת ביחידה",
      "secondaryStatusReported": "נוכח/ת",
      "icon": "img/basis.png",
      "showStatusMsg": false
    }
  ],
  "minDate": "2026-06-17T00:00:00+03:00",
  "maxDate": "2026-07-17T00:00:00+03:00",
  "isWeekendNachsalReportActive": true
}
```
- `reportedStatusCode` is 4 chars: first 2 = mainCode, last 2 = secondaryCode (e.g. `"0101"`)
- `date` is ISO string without timezone — treat as local date
- `normalizeDate()` in HomeScreen converts `date` → `DD.MM.YYYY` for matching

## Patch: `@react-native-cookies/cookies`
The library references the defunct JCenter Maven repo, which breaks Gradle.

- Patch file: `patches/@react-native-cookies+cookies+6.2.1.patch`
- Applied automatically via `postinstall: patch-package` in `package.json`
- **`npm ci` must always run in CI** (never skip on cache hit) so the postinstall hook fires and the patch is applied. The workflow caches `~/.npm` (the npm download cache) to keep installs fast without skipping them.

## CI (GitHub Actions)
Workflow: `.github/workflows/build-apk.yml`
- Builds a **debug APK** (`assembleDebug`) — no signing needed for sideloading.
- Skips `expo prebuild` (android/ is committed).
- `npm ci` only runs on `node_modules` cache miss.
- Artifact: `android/app/build/outputs/apk/debug/app-debug.apk`

## Branch & PR workflow
- Development branch: `claude/jolly-ride-ceaez3`
- Push commits there — open PRs update automatically.
- Merge via GitHub MCP (`mcp__github__merge_pull_request`, owner: `AdamCanor`, repo: `PratFill`).
