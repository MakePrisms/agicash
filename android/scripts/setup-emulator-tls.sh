#!/usr/bin/env bash
# Configure the Pixel 7 emulator so the Agicash app can reach the local
# Supabase stack (https://10.0.2.2:54321) signed by the operator's mkcert
# root CA.
#
# Background
# ----------
# rustls-platform-verifier (the TLS verifier the Rust ffi uses on Android)
# reads CAs straight from the system trust store via JNI:
#   KeyStore.getInstance(...) + TrustManagerFactory + X509TrustManagerExtensions
# It does NOT consult network_security_config.xml, so bundling the mkcert
# root in res/raw and listing it under <domain-config> does nothing.
#
# Android 14+ stores the live trust anchors under
#   /apex/com.android.conscrypt/cacerts/
# which is read-only and lives in its own mount namespace. To inject a
# user CA we have to:
#   1. Boot the emulator with -writable-system + adb root + adb remount
#   2. Build a tmpfs that mirrors the APEX cacerts + adds our cert
#   3. Bind that tmpfs over /apex/com.android.conscrypt/cacerts in EVERY
#      running process's mount namespace (init + zygote + every app).
# This script automates steps 2-3 on a device that's already booted with
# -writable-system. (Step 1 is one-time per boot: relaunch the emulator
# with `emulator -avd $AVD -writable-system -no-snapshot-load`.)
#
# Reference: https://httptoolkit.com/blog/android-14-install-system-ca-certificate/
set -euo pipefail

AVD="${AVD:-agicash-pixel7}"
SERIAL="${SERIAL:-emulator-5554}"
ROOT_CA="${ROOT_CA:-$HOME/Library/Application Support/mkcert/rootCA.pem}"

if [ ! -f "$ROOT_CA" ]; then
  echo "mkcert root CA not found at $ROOT_CA" >&2
  echo "Run \`nix develop -c mkcert -install\` first to create it." >&2
  exit 1
fi

if ! adb -s "$SERIAL" get-state > /dev/null 2>&1; then
  echo "emulator $SERIAL not online. Launch with:" >&2
  echo "  emulator -avd $AVD -writable-system -no-snapshot-load -no-snapshot-save" >&2
  exit 1
fi

HASH=$(openssl x509 -inform PEM -subject_hash_old -in "$ROOT_CA" -noout)
HOST_CERT=$(mktemp -t mkcert-android.XXXXXX).pem
# Android system CA files are PEM body followed by `openssl x509 -text`.
cat "$ROOT_CA" > "$HOST_CERT"
openssl x509 -inform PEM -in "$ROOT_CA" -text -fingerprint -noout >> "$HOST_CERT"

# Need root + writable /system.
adb -s "$SERIAL" root > /dev/null
# Give adbd a moment to come back.
until adb -s "$SERIAL" shell whoami 2>/dev/null | grep -q root; do sleep 1; done
adb -s "$SERIAL" remount > /dev/null

# Push cert + the on-device installer.
adb -s "$SERIAL" push "$HOST_CERT" "/data/local/tmp/$HASH.0" > /dev/null
adb -s "$SERIAL" push "$(dirname "$0")/install-mkcert-system-ca.sh" \
  /data/local/tmp/install-mkcert-system-ca.sh > /dev/null
adb -s "$SERIAL" shell chmod 755 /data/local/tmp/install-mkcert-system-ca.sh

# Run the installer (bind-mounts the merged tmpfs into every mount namespace).
adb -s "$SERIAL" shell su 0 sh /data/local/tmp/install-mkcert-system-ca.sh

rm -f "$HOST_CERT"

echo
echo "Verification (should print our hash + 146 certs):"
adb -s "$SERIAL" shell "ls /apex/com.android.conscrypt/cacerts/$HASH.0"
adb -s "$SERIAL" shell "ls /apex/com.android.conscrypt/cacerts | wc -l"
