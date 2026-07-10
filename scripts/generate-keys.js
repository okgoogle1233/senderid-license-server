#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, '..', 'keys');
const privatePath = path.join(keysDir, 'private.pem');
const publicPath = path.join(keysDir, 'public.pem');
const androidAsset = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'license_public.pem');

if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });

if (fs.existsSync(privatePath)) {
  console.log('Keys already exist at', keysDir);
  process.exit(0);
}

console.log('Generating RSA-2048 key pair...');
execSync(`openssl genrsa -out "${privatePath}" 2048`, { stdio: 'inherit' });
execSync(`openssl rsa -in "${privatePath}" -pubout -out "${publicPath}"`, { stdio: 'inherit' });

if (fs.existsSync(path.dirname(androidAsset))) {
  fs.copyFileSync(publicPath, androidAsset);
  console.log('Copied public key to', androidAsset);
}

console.log('Done. Keep private.pem secret — never commit it.');
