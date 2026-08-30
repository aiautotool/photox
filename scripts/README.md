# PhotoX local build scripts

These scripts build the existing mobile/desktop apps without changing their application code.

## Prerequisites

- Node.js 22+
- npm
- iOS: macOS, current Xcode, CocoaPods/Xcode command-line tools, Apple development signing configured in Xcode, physical iPhone with Developer Mode enabled
- Android: JDK + Android SDK
- Desktop macOS installers: macOS
- Desktop Windows installer: Windows is recommended

Run once after cloning:

```bash
npm install
chmod +x scripts/*.sh scripts/lib/*.sh
```

## Mobile

Build/run iOS development app (simulator by default):

```bash
./scripts/build-mobile.sh ios
```

Build/run Android development app:

```bash
./scripts/build-mobile.sh android
```

Build Android debug APK:

```bash
./scripts/build-mobile.sh android-apk
```

## Install on a physical iPhone

Connect the iPhone by USB (or enable wireless debugging), unlock it, accept Trust Computer, and enable Developer Mode.

Interactive device picker:

```bash
./scripts/install-ios-device.sh
```

Target a device by name or identifier:

```bash
IOS_DEVICE="My iPhone" ./scripts/install-ios-device.sh
# or
./scripts/install-ios-device.sh "00008110-..."
```

The script lists connected devices first and then delegates native generation/build/install to Expo/Xcode. Signing remains in Xcode; no Apple Team ID or certificate is committed to git.

If signing is not configured yet, open `mobile/ios/*.xcworkspace` after the first prebuild, select the app target, Signing & Capabilities, choose your Apple Development Team, then run the script again.

## Desktop

Build only:

```bash
./scripts/build-desktop.sh build
```

macOS Apple Silicon installer:

```bash
./scripts/build-desktop.sh mac-arm64
```

macOS Intel installer:

```bash
./scripts/build-desktop.sh mac-x64
```

Windows NSIS installer:

```bash
./scripts/build-desktop.sh win
```

Automatic host target:

```bash
./scripts/build-desktop.sh auto
```

Desktop installer output is under `desktop/release/`.

## Build both

```bash
MOBILE_TARGET=android-apk DESKTOP_TARGET=build ./scripts/build-all.sh
```

On macOS, defaults are mobile iOS + host desktop target:

```bash
./scripts/build-all.sh
```
