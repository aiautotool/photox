# Mobile image editor

PhotoX mobile uses `@dariyd/react-native-image-filters` for real image editing.

## Capabilities
- GPU real-time preview through `FilteredImageView`
- Photo presets including vivid, dramatic, warm, cool, vintage and Instagram-style filters
- Adjustable brightness, contrast, saturation, exposure, temperature, tint, sharpness and vibrance
- Interactive native crop using `CropperView`
- Crop aspect ratios: free, 1:1, 4:3, 3:4, 16:9 and 9:16
- Native crop output using `cropImage`
- Rotation using `rotateImage`
- Full-size filtered export using `applyFilter`
- Edited result is saved as a new MediaLibrary asset; source photo remains unchanged

## Runtime requirements
The upstream library currently requires:
- React Native 0.74+ with New Architecture
- iOS 18.0+
- Android 13 / API 33+
- native development build; Expo Go is not supported

PhotoX therefore sets iOS deployment target to 18.0 and Android minSdkVersion to 33.

## Install / rebuild
```bash
npm install
npx expo prebuild --clean
npx expo run:ios
# or
npx expo run:android
```

After adding or updating this package, rebuild the native application. Metro reload alone cannot link the TurboModule/native views.

## Architecture
`mobile/app/index.tsx` prepares a local image URI and pushes `/editor`.

`mobile/src/editor/PhotoEditorScreen.tsx` owns:
- preview/filter state
- custom adjustment state
- crop rectangle and aspect-ratio state
- rotation
- export

`mobile/app/editor.tsx` persists the edit recipe and saves the rendered URI to the device photo library.
