# V4 Run 39 — Mobile Workspace Navigation

## Goal
Make the already-implemented authenticated Mobile `/workspace` screen discoverable from the main Mobile experience without inventing any new admin mutation surface.

## Analysis
The `/workspace` route already loaded authoritative workspace/quota/device data through the paired Desktop v2 session and already implemented loading, retry and safe read-only behavior. The remaining gap was navigation: `mobile/app/index.tsx` exported `MobileHome` directly, so users had no explicit route into the workspace screen from the primary Mobile UI.

## Implementation
- Replaced the direct `MobileHome` route export with a small route wrapper.
- Added a visible `Workspace & dung lượng` shortcut above the existing bottom navigation.
- The shortcut uses Expo Router to open `/workspace`; it does not calculate quota locally or add new destructive actions.
- Kept all workspace authorization, role semantics and data loading inside the existing workspace client/screen.
- Updated `V4_RELEASE_NOTES.md`, `V4_BUILD_INTEGRATION_GUIDE.md` and `V4_UI_SPEC.md`.

## UX notes
The shortcut is intentionally an integration step, not a new permanent bottom tab. The preferred longer-term layout remains an account/profile entry when the account sheet is refactored into a reusable component. No duplicate workspace implementation should be created during that refactor.

## Security / tenancy
No tenant identifier, role decision, quota computation or credential is introduced into the navigation wrapper. The destination screen continues to require the authenticated paired Desktop v2 workspace session and shows an error/re-pair path when that session is unavailable.

## Validation gate
This batch must be marked complete only after final-HEAD repository CI passes its available install, unit/integration test, TypeScript typecheck and production build steps. Signed iOS/Android release artifacts remain NOT VERIFIED unless explicitly built in an appropriate signing environment.

## Next priority
1. Member/invite lifecycle with authoritative workspace-scoped persistence and role rules.
2. Continue provider/index tenant-ID isolation audit.
3. Hosted/deployment/update hardening.
4. Keep checkout/payment-method/customer-portal UI gated until backing billing contracts exist.
