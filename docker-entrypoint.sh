#!/bin/sh
set -e

# Generate RSA keys on first boot if missing (persist /app/keys as a Coolify volume)
if [ ! -f /app/keys/private.pem ]; then
  echo "Generating RSA key pair in /app/keys ..."
  node scripts/generate-keys.js
fi

# Auto-set ALLOWED_APK_SIGNATURES from keystore/APK on deploy (if not already set)
if [ -f /app/scripts/resolve-allowed-signatures.sh ]; then
  chmod +x /app/scripts/resolve-allowed-signatures.sh
  . /app/scripts/resolve-allowed-signatures.sh
fi

exec node src/server.js
