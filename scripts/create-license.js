#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store = require('../src/db');

const licenseKey = process.argv[2];
const maxDevices = parseInt(process.argv[3] || '1', 10);
const validDays = parseInt(process.argv[4] || '0', 10);
const label = process.argv[5] || null;

if (!licenseKey) {
  console.error('Usage: npm run create-license -- <LICENSE_KEY> [maxDevices] [validDays] [label]');
  console.error('  validDays: 0 or omit = lifetime license');
  console.error('  Example:   npm run create-license -- USER-30D-001 1 30 "30-day trial"');
  process.exit(1);
}

if (store.findLicense(licenseKey)) {
  console.error('License already exists:', licenseKey);
  process.exit(1);
}

const id = store.createLicense(licenseKey, label, maxDevices, validDays);
const license = store.findLicense(licenseKey);
const meta = store.licenseMeta(license);

console.log('Created license:');
console.log('  id:         ', id);
console.log('  licenseKey: ', licenseKey);
console.log('  maxDevices: ', maxDevices);
console.log('  validDays:  ', meta.lifetime ? 'lifetime' : validDays);
if (label) console.log('  label:      ', label);
console.log('');
console.log('Note: day-count starts on first device activation, not on creation.');
