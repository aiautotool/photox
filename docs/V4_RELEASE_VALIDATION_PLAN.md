# PhotoX V4 — Release Validation Plan

This file tracks release/build validation that must remain green on branch `v4`. It complements `IMPLEMENTATION_PLAN.md` and `V4_BUILD_INTEGRATION_GUIDE.md` and exists so release gates do not regress while feature work continues.

## Completed automated gates

- Repository install and postinstall package builds.
- Repository unit/integration tests.
- Full TypeScript typecheck, including Mobile, Desktop, Relay and shared SDK packages.
- Shared SDK/package production builds.
- Relay production build.
- Mobile iOS JavaScript/assets production export via Expo/Metro.
- Mobile Android JavaScript/assets production export via Expo/Metro.
- Desktop Vite + Electron TypeScript production build.
- Built Desktop renderer smoke test under Electron: root, `.app-shell`, visible text and preload `DesktopBridge` must exist.
- Electron-builder package-directory build.
- Packaged Desktop application smoke test under Xvfb using the same renderer contract.

The root `npm run build` must keep Mobile production exports in addition to Desktop/Relay/package builds. Mobile typecheck alone is not a sufficient release gate.

## Current platform-specific validation

- iOS physical-device install helper performs Expo native sync, Pods install and a Release configuration device build/install. This is useful acceptance coverage but does not replace a signed distributable IPA validation.
- Android signed APK/AAB release is not validated by repository CI.
- macOS/Windows signed installers are not validated by repository CI; the Linux electron-builder packaged application smoke validates renderer/package startup semantics only.

## Still NOT VERIFIED

- Signed iOS IPA/Xcode release distribution.
- Signed Android APK/AAB release distribution.
- Signed/notarized macOS distribution.
- Signed Windows installer distribution.
- Real-device iPhone MOV/HEVC end-to-end acceptance.
- Live Google Drive policy mutation/repair with a real account.
- Live Google Photos OAuth/Picker/migration with real accounts.
- Live Stripe billing E2E.
- Real TLS reverse-proxy Web deployment including WebSocket and Range streaming.

## Next release-validation priorities

1. Preserve the iOS/Android Expo production export gate on every root production build.
2. Add Android native Release compile validation on a suitable runner without requiring signing credentials.
3. Add iOS native Release compile validation on a macOS runner when CI capacity is available; report signing/distribution separately.
4. Add downloadable unsigned/test build artifacts only when they are reproducible and do not embed provider secrets.
5. Keep Desktop packaged renderer smoke mandatory so a white/blank application window cannot pass CI again.
