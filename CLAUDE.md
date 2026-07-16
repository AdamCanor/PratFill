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

**Session model (confirmed by direct testing, documented in full in `doch1.js`):** `AppCookie` (a ~368-char ASP.NET Data Protection ticket) is the *only* application-level auth cookie *on `one.prat.idf.il`* and is short-lived (~5h observed). Every other cookie the site sets (`incap_ses_*`, `visid_incap_*`, `nlbi_*`, `BIGipServerMFT-One-Frontends`) is Imperva Incapsula (WAF/CDN) or F5 BIG-IP infrastructure — not a secondary session cookie. A plain headless `fetch` of the site's root page can never refresh it (byte-identical static SPA shell regardless of cookie validity, confirmed by direct comparison) — but the actual refresh mechanism (below) has since been identified and confirmed headlessly replicable, so this is no longer a hard limitation. `attemptSilentReauth()` in `doch1.js` still exists but is dead code from `request()`'s point of view — kept only as a manual diagnostic probe in `TestConnectionScreen`.

**Goal — autonomous daily fill:** the background worker should, *without the user opening the app*, get a fresh `AppCookie` on its own once a day and report every uncovered day in the next 7, for as long as the ~monthly login lives. The user gets only a success notification (cadence configurable) or a "re-login required" notification when the long login is genuinely dead.

**The refresh mechanism — identified by on-device trace and CONFIRMED WORKING on-device (Path A, pure JS, no prebuild):** the portal authenticates via **Microsoft Entra ID / MSAL.js**. `refreshAppCookie()` in `doch1.js` revives a dead `AppCookie` with two headless HTTP calls: (1) redeem the MSAL **refresh token** at `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (`grant_type=refresh_token`, `scope=User.Read openid profile offline_access`, `Origin: https://one.prat.idf.il`) → fresh `id_token`; (2) `GET /api/account/login` with `Authorization: <id_token>` (the **raw** id_token, no `Bearer ` prefix) → backend Set-Cookies a fresh `AppCookie`. Verified end-to-end via the "Test headless refresh" button in `TestConnectionScreen`: with `AppCookie` invalidated and no WebView involved, it produced a fresh valid `AppCookie`. The refresh token is captured from MSAL's `localStorage` during real WebView logins (`MSAL_RT_CAPTURE_JS` + `handleLoginWebViewMessage` in `useLoginDetection.js`, injected via `injectedJavaScriptBeforeContentLoaded` — the prop confirmed to reliably re-fire across the SPA's navigations, unlike `injectedJavaScript` which only fires once), stored in AsyncStorage (`doch1_msal_rt`), and rotated on each use. `refreshAppCookie()` returns `{ ok, attempted }`; `attempted` is `true` whenever a refresh is tried, so a genuine failure (dead refresh token) drives the once-per-death "re-login" notification.

**Longevity fallback — implemented and CONFIRMED WORKING on-device:** Azure caps SPA refresh tokens at ~24h per hop but rotates them on each use, so the fast path alone only survives a phone used at least once in any 24h window. To cover a phone left fully asleep for longer (up to the ~monthly login), `refreshAppCookie()` falls back, when the cached refresh token itself comes back `invalid_grant`, to the SAME thing a real WebView does: a silent SSO check against Azure's own session cookie (`ESTSAUTHPERSISTENT` etc. on `login.microsoftonline.com`, already in the native cookie jar from past real logins) — a `prompt=none` request to `/oauth2/v2.0/authorize` (Authorization Code + PKCE, since Azure SPA registrations don't allow implicit flow), redeemed at the token endpoint (`grant_type=authorization_code`) for a fresh `id_token` *and* a new refresh token, restarting the fast-path chain. PKCE needs a SHA-256 + base64url implementation; both are hand-rolled pure JS in `doch1.js` (no native crypto module, so still no prebuild) and were cross-validated byte-for-byte against Node's own `crypto` module (including a >64-byte input crossing a SHA-256 block boundary, and 1/2/32-byte base64 edge cases) before shipping. Verified end-to-end via the **"Test SSO fallback (force)"** button in `TestConnectionScreen` (which forces this path directly, bypassing the fast path, so it didn't need a real 24h-stale token to test): produced a genuinely new `AppCookie` using only the Azure session cookie, no refresh token redemption involved. `refreshAppCookie()` clears the stored refresh token only when *both* the fast path and this fallback fail. The account's `username` (captured alongside the refresh token, when present, as `login_hint`) helps Azure resolve which SSO session to check — confirmed captured correctly in testing.

With both paths confirmed, the autonomous daily fill should now survive the full lifetime of the underlying login (~1 month) with zero app opens. Should real-world use ever reveal a gap (e.g. Azure changing behavior, blocking headless `prompt=none`), the remaining option is **Path B**: a native background `WebView` (`SYSTEM_ALERT_WINDOW` already in the manifest, needs prebuild).

**Session recovery model (supporting pieces already in place):**
- The background task (`src/tasks/autoSubmitTask.js`) is refresh-then-submit: `refreshAppCookie()` → on success `runAutoSubmit()`; on failure notify "re-login" (throttled until a real refresh has been attempted, then always-once-per-death). It fires every ≥360 **minutes** (`expo-background-task`'s `minimumInterval` is in minutes — `15 * 60` once meant ~15 hours here, a unit bug; ~6h so at least one fire lands per day under Doze). Registration re-runs when the interval constant changes.
- `runAutoSubmit()` owns the **success** notification, gated by `autoSubmit.successNotify` (`'daily'` | `'weekly'`, set in `SettingsAutoSubmitScreen`); it only fires when new days were actually filled. Coverage is persisted separately from the last-run record (`doch1_auto_submit_coverage`). A hard cap (`canSendNotificationToday()`/`markNotificationSent()`, shared across both notification types) additionally limits the app to **at most one notification per rolling 24h, period** — a backstop against edge cases neither type's own throttle covers alone (e.g. a partial-fill retry succeeding later the same day, or a session dying mid-day right after an earlier success).
- **Auto-submit is background-only by design** — opening the app never triggers a submit (removed on user request; the foreground affordance for filling is the manual "fill week" button). On launch with a dead session, `RootNavigator` mounts the hidden `SessionRefreshWebView` behind the splash purely to re-authenticate silently (a 1x1 WebView replaying the silent login; also the credential-capture point for the refresh/username tokens) — it never submits reports. The visible `LoginScreen` is the last-resort fallback for a genuinely-expired login. Detection logic is shared via `src/hooks/useLoginDetection.js`.

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
