# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project summary
React Native / Expo app (SDK 56) for IDF soldiers to submit future attendance reports ("דו"ח 10") via the One.Prat API (`https://one.prat.idf.il`).

## Commands

```bash
npx expo start --lan   # Dev server for local phone testing (LAN mode)
npm run android        # Build and run on Android emulator
```

No test or lint scripts are configured.

## Architecture

**Entry:** `index.js` → `App.js` (wraps everything in `ThemeProvider`) → `RootNavigator.js`

**Auth gate in `RootNavigator.js`:** calls `getUser()` (a live server check, not just local cookie presence) on mount; routes to `LoginScreen` or `HomeScreen` based on `isUserAuth`.

**Login flow (`LoginScreen.js`):** Opens a WebView to the IDF portal. Monitors navigation URLs for path fragments (`/hp`, `/secondaries`, `/calendar`, `/primaries`) then calls `CookieManager.get()` to confirm `AppCookie` is set. On success, navigates to `HomeScreen`.

**HomeScreen.js** (~1100 lines) has two tabs:
- *Personal* — shows upcoming 7 days, lets soldier report/delete attendance, supports batch "fill week by preset"
- *Team* (commander-only) — lists soldiers in group, allows updating their status via modal

**SettingsScreen.js** (~600 lines) manages:
- Weekly presets: per-day-of-week default status templates
- Quick buttons: 2 configurable one-tap fill buttons shown on HomeScreen
- Commander mode toggle (shows/hides Team tab)
- Accent color selection (6 presets, stored in ThemeContext)

**State / persistence:**
- `ThemeContext` (`src/context/ThemeContext.js`) holds accent color, persists to AsyncStorage key `doch1_accent_color`
- Settings persist to AsyncStorage key `doch1_settings` (weeklyPresets, quickButtons, commanderMode)
- Status list cached to `doch1_statuses` (refreshed on login)

## API (`src/api/doch1.js`)

All calls go to `https://one.prat.idf.il`. Auth is entirely cookie-based — `AppCookie` must be present. `getStoredCookieHeader()` builds the `Cookie:` header from `CookieManager`. Any 401/403 or missing cookie throws a custom `AuthError`; screens catch this and navigate back to Login.

**Session model (confirmed by direct testing, documented in full in `doch1.js`):** `AppCookie` (a ~368-char ASP.NET Data Protection ticket) is the *only* application-level auth cookie and is short-lived (~5h observed). Every other cookie the site sets (`incap_ses_*`, `visid_incap_*`, `nlbi_*`, `BIGipServerMFT-One-Frontends`) is Imperva Incapsula (WAF/CDN) or F5 BIG-IP infrastructure — not a secondary session cookie. There is no silent/headless way to refresh a dead `AppCookie`: the site's root page returns an identical static SPA shell (no redirect, no `Set-Cookie`) regardless of cookie validity. Recovery always requires a real login through `LoginScreen.js`'s WebView. `attemptSilentReauth()` in `doch1.js` still exists but is dead code from `request()`'s point of view — kept only as a manual diagnostic probe in `TestConnectionScreen`.

Key endpoints:
| Function | Method + Path |
|---|---|
| `getUser()` | GET `/api/account/getUser` — `{isUserAuth, isCommanderAuth}` |
| `getFutureReports(month, year)` | POST `/api/Attendance/getFutureReport` |
| `insertFutureReport(...)` | POST `/api/Attendance/InsertFutureReport` (multipart/form-data) |
| `deleteFutureReport(...)` | POST `/api/Attendance/deleteFutureReport` |
| `getAllStatuses()` | GET `/api/Attendance/GetAllFilterStatuses` |
| `loginCommander()` | POST `/api/account/loginCommander` — must call before GetGroups |
| `getGroups(groupCode)` | GET `/api/attendance/GetGroups?groupcode=` |
| `updateAndSendPrat(...)` | POST `/api/Attendance/updateAndSendPrat` |

`reportedStatusCode` from the API is 4 chars: first 2 = mainCode, last 2 = secondaryCode (e.g. `"0101"`). `date` fields are ISO strings without timezone — treat as local. `normalizeDate()` in HomeScreen converts them to `DD.MM.YYYY` for matching.

## UI conventions
- Dark theme. All colors/spacing/radius from `src/theme.js` — no hardcoded hex values in components. Accent is `colors.accent` (default `#E8C547`, user-configurable).
- Hebrew-first, RTL. Call `I18nManager.forceRTL(true)` in new screens.
- Icons: `MaterialCommunityIcons` from `@expo/vector-icons` — already installed.
- Status selection is two-stage (primary → secondary), modal-driven. Reuse this pattern for any new status picker.
- `src/data/statuses.js` contains hardcoded fallback statuses used when the API is unavailable.

## Native project (`android/`)
`android/` is committed so CI skips `expo prebuild`. Only re-run prebuild when adding/removing packages that have native Android code:

```bash
npx expo prebuild -p android
git add android/
git commit -m "Update android/ after adding <package>"
```

Pure JS changes do not require a prebuild.

## Development workflow
- **Local testing:** `npx expo start --lan` — connects a physical phone on the same network via Expo Go.
- **Claude's working branch:** `claude/main` — all Claude Code changes go here. Never commit directly to `dev` or `main`.
- **Merging:** when work is ready, merge `claude/main` → `dev` via PR, then `dev` → `main` for a release.
- **No CI on `dev`** — `dev` pushes trigger nothing.
- **Release:** merge `dev` → `main` via PR. On `main` push, `release.yml` builds a production APK and publishes a GitHub Release tagged `v{version}-{sha}`.
- **GitHub Actions workflows (all in `.github/workflows/`):**
  - `release.yml` — auto on `main` push; builds release APK, creates GitHub Release
  - `build-apk-release.yml` — manual dispatch only; builds release APK, uploads as artifact (useful for testing release builds without merging to main)
  - `build-apk-debug.yml` — manual dispatch only; builds debug APK, uploads as artifact
- Merge PRs via `mcp__github__merge_pull_request` (owner: `AdamCanor`, repo: `PratFill`).

## Cookie library
Uses `@preeternal/react-native-cookie-manager` (drop-in for deprecated `@react-native-cookies/cookies`). Same API: `CookieManager.get(domain)`, `CookieManager.clearAll()`.
