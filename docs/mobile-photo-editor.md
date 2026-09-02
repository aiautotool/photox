# Mobile Photo Editor Integration

## Current policy

PhotoSync uses the native IMG.LY/CE.SDK photo editor as the default editor on iOS and Android. The custom PhotoX editor remains experimental and is not used by a normal Edit tap.

This is intentional: every control shown in the default editor must execute a real edit and produce an exported image. Normal Edit must not route to recipe-only or mock UI.

## User flow

1. User opens a photo in the viewer.
2. User taps Edit.
3. `prepareAssetForEditing()` resolves the asset to an editable local file. Cloud-only media is downloaded to the app cache first.
4. `IMGLYEditor.openEditor(..., EditorPreset.PHOTO, ...)` opens the native photo editor.
5. The user can crop/rotate/flip, adjust image properties, apply filters/effects and use the tools exposed by the native editor build.
6. When the editor returns an artifact, PhotoSync creates a new Media Library asset. The source photo is preserved.
7. The library is refreshed and the newly edited photo becomes the active viewer item.

## Routing

`mobile/src/editor/EditorNavigationBridge.ts` no longer hijacks normal photo editor calls.

The custom PhotoX editor can only be opened explicitly by supplying:

```ts
metadata.__photoxUseCustomEditor = true
```

Do not set this flag in the normal photo viewer Edit action until the custom editor reaches feature parity with the native editor.

## Native requirements

Package:

```text
@imgly/editor-react-native
```

The app uses `expo-build-properties` and requires:

- iOS deployment target 16+
- Android minSdkVersion 24+
- IMG.LY Maven repository for Android native dependencies
- a valid `EXPO_PUBLIC_IMGLY_LICENSE` for production use

Current Android Maven repository:

```text
https://artifactory.img.ly/artifactory/maven
```

## Saving behavior

Never overwrite the original asset. The exported artifact is saved as a new Media Library item. This keeps editing non-destructive from the user's perspective and avoids accidental loss of originals.

## Custom editor rule

The custom Skia/ImageManipulator editor is kept for future PhotoX-specific UI work, but incomplete tools must not be exposed as functioning production tools. A tool can return to the default editor only after it has:

- real preview rendering,
- real export rendering,
- undo/reset behavior,
- correct full-resolution output,
- iOS and Android device testing.

## Build after changing native editor dependencies

Run dependency installation and rebuild the native apps. A Metro-only reload is not enough after native dependency/config changes.
