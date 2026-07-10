#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const input = process.argv[2];
const password = process.argv[3] || 'senderid123';
const alias = process.argv[4] || 'senderid';

if (!input) {
  console.error('Usage: npm run extract-signature -- <keystore-or-apk> [password] [alias]');
  process.exit(1);
}

if (!fs.existsSync(input)) {
  console.error('File not found:', input);
  process.exit(1);
}

const isApk = input.toLowerCase().endsWith('.apk');
let out;
try {
  if (isApk) {
    out = execSync(`keytool -printcert -jarfile "${input}"`, { encoding: 'utf8' });
  } else {
    out = execSync(
        `keytool -list -v -keystore "${input}" -alias "${alias}" -storepass "${password}"`,
        { encoding: 'utf8' }
    );
  }
} catch (e) {
  console.error('keytool failed. Install JDK (keytool) and check password/alias.');
  console.error(e.message);
  process.exit(1);
}

const m = out.match(/SHA256:\s*([0-9A-Fa-f:]+)/i);
if (!m) {
  console.error('Could not find SHA256 in keytool output');
  process.exit(1);
}

const hash = m[1].replace(/:/g, '').toLowerCase();
console.log(hash);
console.error('');
console.error('Add to .env or Coolify:');
console.error(`ALLOWED_APK_SIGNATURES=${hash}`);
