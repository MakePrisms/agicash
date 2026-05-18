#!/system/bin/sh
# On-device installer: bind-mounts a tmpfs containing the existing
# /apex/com.android.conscrypt/cacerts/* plus any cert files staged under
# /data/local/tmp/*.0 over /apex/com.android.conscrypt/cacerts in every
# process mount namespace.
#
# Invoked by android/scripts/setup-emulator-tls.sh from the host.
# Reference: https://httptoolkit.com/blog/android-14-install-system-ca-certificate/
set -eu

STAGE=/data/local/tmp/cacerts
APEX_DIR=/apex/com.android.conscrypt/cacerts

if ! ls /data/local/tmp/*.0 > /dev/null 2>&1; then
  echo "no extra CA files staged at /data/local/tmp/*.0" >&2
  exit 1
fi

# Build the merged dir.
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -f $APEX_DIR/* "$STAGE/"
cp -f /data/local/tmp/*.0 "$STAGE/"
chown root:root "$STAGE"/*
chmod 644 "$STAGE"/*
chcon u:object_r:system_security_cacerts_file:s0 "$STAGE"/*

# Bind-mount the merged dir over the APEX cacerts in INIT's namespace.
nsenter --mount=/proc/1/ns/mnt -- /system/bin/sh <<'INIT_NS'
set -eu
APEX_DIR=/apex/com.android.conscrypt/cacerts
STAGE=/data/local/tmp/cacerts
mount -t tmpfs tmpfs $APEX_DIR
cp $STAGE/* $APEX_DIR/
chown root:root $APEX_DIR/*
chmod 644 $APEX_DIR/*
chcon u:object_r:system_security_cacerts_file:s0 $APEX_DIR/*
INIT_NS

# Propagate to every PID with a different mount namespace.
init_ns=$(readlink /proc/1/ns/mnt)
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  [ "$pid" = "1" ] && continue
  [ -r "/proc/$pid/ns/mnt" ] || continue
  pid_ns=$(readlink "/proc/$pid/ns/mnt" 2>/dev/null) || continue
  [ "$pid_ns" = "$init_ns" ] && continue
  nsenter --mount=/proc/$pid/ns/mnt -- /system/bin/sh -c '
    APEX_DIR=/apex/com.android.conscrypt/cacerts
    STAGE=/data/local/tmp/cacerts
    if ! ls $APEX_DIR/*.0 > /dev/null 2>&1 || [ "$(ls $APEX_DIR | wc -l)" -lt 146 ]; then
      mount -t tmpfs tmpfs "$APEX_DIR" 2>/dev/null || exit 0
      cp $STAGE/* "$APEX_DIR/" 2>/dev/null || true
      chown root:root "$APEX_DIR"/* 2>/dev/null || true
      chmod 644 "$APEX_DIR"/* 2>/dev/null || true
      chcon u:object_r:system_security_cacerts_file:s0 "$APEX_DIR"/* 2>/dev/null || true
    fi
  ' 2>/dev/null || true
done

echo "init ns now sees:"
nsenter --mount=/proc/1/ns/mnt -- ls "$APEX_DIR" | wc -l
echo "done"
