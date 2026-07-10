#!/bin/sh
set -e

# Generate RSA keys on first boot if missing (persist /app/keys as a Coolify volume)
if [ ! -f /app/keys/private.pem ]; then
  echo "Generating RSA key pair in /app/keys ..."
  node scripts/generate-keys.js
fi

exec node src/server.js
