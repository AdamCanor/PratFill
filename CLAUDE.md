@AGENTS.md

# PratFill — Claude working notes

## Project summary
React Native / Expo app (SDK 56) for IDF soldiers to submit future attendance reports ("דו״ח 1") via the One.Prat API.

## File map

| Path | Purpose |
|---|---|
| `src/api/doch1.js` | All API calls + cookie auth. **Do not modify.** |
| `src/data/statuses.js` | Static list of report codes. **Do not modify.** |
| `src/utils/dates.js` | Date helpers (`getUpcomingDates`, `toApiDate`, etc.). **Do not modify.** |
| `src/theme.js` | All colors, spacing, radius tokens. **Do not modify.** Use these — no hardcoded hex values in components. |
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
