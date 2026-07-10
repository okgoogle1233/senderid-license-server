#!/bin/sh
# Resolve ALLOWED_APK_SIGNATURES from keystore or APK if not already set.
# Called by docker-entrypoint.sh on container start.

normalize_sha256() {
  echo "$1" | sed 's/.*SHA256: *//' | tr -d ':' | tr 'A-F' 'a-f' | tr -d '[:space:]'
}

extract_from_keystore() {
  ks_path="$1"
  ks_pass="$2"
  ks_alias="${3:-senderid}"
  if [ ! -f "$ks_path" ]; then
    echo "Keystore not found: $ks_path" >&2
    return 1
  fi
  keytool -list -v \
    -keystore "$ks_path" \
    -alias "$ks_alias" \
    -storepass "$ks_pass" 2>/dev/null | grep -i "SHA256:" | head -1
}

extract_from_apk() {
  apk_path="$1"
  if [ ! -f "$apk_path" ]; then
    echo "APK not found: $apk_path" >&2
    return 1
  fi
  keytool -printcert -jarfile "$apk_path" 2>/dev/null | grep -i "SHA256:" | head -1
}

# Already set manually — nothing to do
if [ -n "$ALLOWED_APK_SIGNATURES" ]; then
  echo "ALLOWED_APK_SIGNATURES already set (${#ALLOWED_APK_SIGNATURES} chars)"
  return 0 2>/dev/null || exit 0
fi

TMP_DIR="${TMPDIR:-/tmp}/license-server-$$"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

RAW=""

# Option 1: Base64-encoded keystore in env (best for Coolify secrets)
if [ -n "$RELEASE_KEYSTORE_BASE64" ]; then
  KS_FILE="$TMP_DIR/release.keystore"
  echo "$RELEASE_KEYSTORE_BASE64" | base64 -d > "$KS_FILE"
  RAW=$(extract_from_keystore "$KS_FILE" "$KEYSTORE_PASSWORD" "$KEYSTORE_ALIAS")
  echo "Read signing cert from RELEASE_KEYSTORE_BASE64"
fi

# Option 2: Keystore file path (volume mount)
if [ -z "$RAW" ] && [ -n "$KEYSTORE_PATH" ]; then
  RAW=$(extract_from_keystore "$KEYSTORE_PATH" "$KEYSTORE_PASSWORD" "$KEYSTORE_ALIAS")
  echo "Read signing cert from KEYSTORE_PATH=$KEYSTORE_PATH"
fi

# Option 3: Base64-encoded APK
if [ -z "$RAW" ] && [ -n "$RELEASE_APK_BASE64" ]; then
  APK_FILE="$TMP_DIR/release.apk"
  echo "$RELEASE_APK_BASE64" | base64 -d > "$APK_FILE"
  RAW=$(extract_from_apk "$APK_FILE")
  echo "Read signing cert from RELEASE_APK_BASE64"
fi

# Option 4: APK file path (volume mount)
if [ -z "$RAW" ] && [ -n "$RELEASE_APK_PATH" ]; then
  RAW=$(extract_from_apk "$RELEASE_APK_PATH")
  echo "Read signing cert from RELEASE_APK_PATH=$RELEASE_APK_PATH"
fi

if [ -z "$RAW" ]; then
  echo "ALLOWED_APK_SIGNATURES not set — any APK signature can activate (dev only)."
  echo "Set RELEASE_KEYSTORE_BASE64 + KEYSTORE_PASSWORD, or KEYSTORE_PATH, or RELEASE_APK_PATH."
  return 0 2>/dev/null || exit 0
fi

HASH=$(normalize_sha256 "$RAW")
if [ -z "$HASH" ] || [ "${#HASH}" -lt 32 ]; then
  echo "Failed to parse SHA-256 from certificate output" >&2
  return 1 2>/dev/null || exit 1
fi

export ALLOWED_APK_SIGNATURES="$HASH"
echo "Auto-generated ALLOWED_APK_SIGNATURES=${HASH:0:16}... (${#HASH} hex chars)"
