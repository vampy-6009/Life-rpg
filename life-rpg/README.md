# Life RPG — Part 1 (Core Loop)

Splash → Permission Prompt → Character Creation → Home Dashboard → Quests → XP/Level.

## What's in this pass

- All screens/logic above, fully wired end to end.
- **Persistence**: SQLite (`@capacitor-community/sqlite`) as the primary
  store, with a JSON snapshot written to Capacitor Preferences after
  every save — this is the hybrid you asked for.
- **Startup flow**: matches the spec's sequence exactly — init storage,
  check DB integrity, restore from JSON backup if corrupted or missing,
  load player, route to Character Creation (no profile) or Home
  (profile exists).
- **Permissions**: custom explanation screen shown once, *then* the real
  Android notification prompt. Denial never blocks the app — it just
  continues without reminders.
- **XP/Level math**: `level = floor(xp / 1000) + 1`, matching your
  `GameEngine.java` formula exactly, ported to `player.js`.

## Not in this pass (next parts, per your own spec's structure)

- Hero, Skills, Inventory, Achievements, Settings screens — the bottom
  nav buttons for these are visible but disabled ("Coming soon") so the
  UI doesn't imply features that don't exist yet.
- Avatar image/camera capture — no CAMERA permission is requested
  anywhere in this build, since no feature uses it yet (your own spec
  says only request permissions when the feature exists).
- Native `CrashHandler.java` / Java-level lifecycle hooks — this build
  is 100% Capacitor + JS with no custom native Java files. If you want
  a native crash handler specifically (vs. the JS-level try/catch and
  backup-restore already in `database.js`), that's an additional native
  Android layer to scope separately.
- Auto-backup on a 24-hour timer — currently backup happens after every
  write (arguably stronger), not on a clock. Easy to add if you want the
  literal 24h scheduled version too.

## One spec conflict I resolved

The original spec asked for both "Room Database" (native Java) and the
"Capacitor SQLite plugin" (JS-callable) as if they're the same layer.
They're not — Room has no bridge into a Capacitor webview, and using it
would mean rewriting this UI as native Android views, which contradicts
the "lightweight HTML/CSS/JS, no heavy assets" goal from your own spec.
This build uses the Capacitor SQLite plugin only, which is the only one
of the two that's actually reachable from `www/js/*.js`.

## Setup

```bash
npm install
npx cap add android
npm run sync
npx cap open android
```

### Android 13+ notification permission

After `cap add android`, confirm `AndroidManifest.xml` includes:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

The community SQLite and local-notifications plugins normally inject
their own required manifest entries automatically on `cap sync` — worth
a manual check the first time regardless.

## Before zipping to move machines

Delete first: `node_modules/`, `android/`, `.vite/` (none should be
present in this delivered zip already).

## Verification note

I don't have network access in this sandbox, so I could not run
`npm install` / open this in an emulator / build an APK here. What I did
verify:
- Every `.js` file passes `node --check` (no syntax errors).
- Every DOM id referenced via `getElementById` in `app.js` exists in
  `index.html` (cross-checked programmatically).
- HTML tags and CSS braces are balanced.

What I could NOT verify here: the actual SQLite plugin API calls against
a real device, permission dialogs firing, or that `npm install` resolves
cleanly on your machine. Please run `npm install` first and tell me the
exact error if anything fails — that's the fastest way to fix real
issues, faster than me guessing at more code blind.
