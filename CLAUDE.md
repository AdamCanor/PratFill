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

### `getReportedData()` — GET /api/Attendance/GetReportedData
Returns current user info: `{ firstName, lastName, commander: bool, reported: bool, mainStatusReported, secondaryStatusReported, ... }`

### `loginCommander()` — POST /api/account/loginCommander
Must be called before GetGroups. Returns `{ isUserAuth, isCommanderAuth, error }`.

### `getGroups(groupCode)` — GET /api/attendance/GetGroups?groupcode=
Returns `{ firstGroup: { users: [...] }, ... }`. Each user: `{ mi, firstName, lastName, reportedMainCode, reportedMainName, reportedSecondaryCode, reportedSecondaryName, createdToday, isFutureReport, groupCode }`.

## Cookie library
Uses `@preeternal/react-native-cookie-manager` — a drop-in replacement for the deprecated `@react-native-cookies/cookies`. Same API (`CookieManager.get(domain)`, `CookieManager.clearAll()`). No patch needed.

## CI (GitHub Actions)
Two workflows:
- `build-apk.yml` — triggers on `dev` push and PRs into `main`. Builds a **release APK** (standalone, no Metro needed). Artifact: `android/app/build/outputs/apk/release/app-release.apk`
- `release.yml` — triggers on `main` push. Builds release APK and publishes a **GitHub Release** tagged `v{version}-{sha}`.

Both skip `expo prebuild` (android/ is committed) and use the debug keystore (sufficient for sideloading).

## Branch & PR workflow
- Development branch: `dev`
- Push commits to `dev` — CI builds APK as artifact.
- When ready to release: open PR `dev` → `main`, merge it — CI publishes a GitHub Release automatically.
- Merge via GitHub MCP (`mcp__github__merge_pull_request`, owner: `AdamCanor`, repo: `PratFill`).
