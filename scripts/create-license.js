#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { initStore, getStore } = require('../src/store');

const licenseKey = process.argv[2];
const maxDevices = parseInt(process.argv[3] || '1', 10);
const validDays = parseInt(process.argv[4] || '0', 10);
const label = process.argv[5] || null;

if (!licenseKey) {
  console.error('Usage: npm run create-license -- <LICENSE_KEY> [maxDevices] [validDays] [label]');
  process.exit(1);
}

async function run() {
  await initStore();
  const store = getStore();
  if (await store.findLicense(licenseKey)) {
    console.error('License already exists:', licenseKey);
    process.exit(1);
  }
  const id = await store.createLicense(licenseKey, label, maxDevices, validDays);
  const license = await store.findLicense(licenseKey);
  const meta = store.licenseMeta(license);
  console.log('Created license:');
  console.log('  id:         ', id);
  console.log('  licenseKey: ', licenseKey);
  console.log('  maxDevices: ', maxDevices);
  console.log('  validDays:  ', meta.lifetime ? 'lifetime' : validDays);
  if (label) console.log('  label:      ', label);
  console.log('');
  console.log('Note: day-count starts on first device activation, not on creation.');
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
