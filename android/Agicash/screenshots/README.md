# Screenshots

This directory will hold emulator screenshots once an Android Emulator AVD is
available on the dev host.

## Operator setup required

The android-scaffold lane built the APK green (~40MB, see
`app/build/outputs/apk/debug/app-debug.apk`) but did NOT capture emulator
screenshots because no AVD was installed.

To unblock emulator captures, run the following on this host:

```bash
export ANDROID_SDK_ROOT="/opt/homebrew/share/android-commandlinetools"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:$PATH"

# Install the emulator + a system image. ~2GB download.
sdkmanager "emulator" "system-images;android-35;google_apis;arm64-v8a"

# Create an AVD.
echo no | avdmanager create avd \
    --name agicash-emu \
    --package "system-images;android-35;google_apis;arm64-v8a"

# Boot it (headless OK; -no-window for screenshots only).
$ANDROID_SDK_ROOT/emulator/emulator -avd agicash-emu -no-window -no-audio &

# Wait for boot.
$ANDROID_SDK_ROOT/platform-tools/adb wait-for-device
until $ANDROID_SDK_ROOT/platform-tools/adb shell getprop sys.boot_completed | grep -q 1; do sleep 2; done

# Install + launch.
$ANDROID_SDK_ROOT/platform-tools/adb install \
    ../app/build/outputs/apk/debug/app-debug.apk
$ANDROID_SDK_ROOT/platform-tools/adb shell monkey \
    -p com.makeprisms.agicash 1

# Capture the login screen.
$ANDROID_SDK_ROOT/platform-tools/adb shell screencap -p > login.png
```
