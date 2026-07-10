'use strict';

const { Pool } = require('pg');
const { daysRemaining, licenseMeta } = require('./shared');

let pool;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    license_key TEXT NOT NULL UNIQUE,
    label TEXT,
    max_devices INTEGER NOT NULL DEFAULT 1,
    valid_days INTEGER,
    activated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    license_id INTEGER NOT NULL REFERENCES licenses(id),
    device_hash TEXT NOT NULL,
    apk_signature TEXT NOT NULL,
    build_fingerprint TEXT,
    version_code INTEGER,
    last_seen_at TIMESTAMPTZ,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(license_id, device_hash)
  );

  CREATE TABLE IF NOT EXISTS activation_log (
    id SERIAL PRIMARY KEY,
    license_key TEXT,
    device_hash TEXT,
    apk_signature TEXT,
    success BOOLEAN NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

async function init() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for PostgreSQL');
  pool = new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await pool.query(SCHEMA);
}

async function findLicense(key) {
  const { rows } = await pool.query('SELECT * FROM licenses WHERE license_key = $1', [key]);
  return rows[0] || null;
}

async function createLicense(key, label, maxDevices, validDays) {
  const days = validDays > 0 ? validDays : null;
  const { rows } = await pool.query(
      `INSERT INTO licenses (license_key, label, max_devices, valid_days)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [key, label || null, maxDevices, days]
  );
  return rows[0].id;
}

async function ensureActivated(license) {
  if (!license || !license.valid_days || license.valid_days <= 0) return license;
  if (license.activated_at) return license;
  const expires = new Date(Date.now() + license.valid_days * 86400000);
  await pool.query(
      `UPDATE licenses SET activated_at = NOW(), expires_at = $1 WHERE id = $2`,
      [expires, license.id]
  );
  return findLicense(license.license_key);
}

function isExpired(license) {
  if (!license || !license.expires_at) return false;
  return new Date(license.expires_at).getTime() <= Date.now();
}

async function countDevices(licenseId) {
  const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM devices WHERE license_id = $1 AND revoked = FALSE',
      [licenseId]
  );
  return rows[0].c;
}

async function findDevice(licenseId, deviceHash) {
  const { rows } = await pool.query(
      'SELECT * FROM devices WHERE license_id = $1 AND device_hash = $2',
      [licenseId, deviceHash]
  );
  return rows[0] || null;
}

async function upsertDevice(licenseId, deviceHash, apkSignature, buildFingerprint, versionCode) {
  const existing = await findDevice(licenseId, deviceHash);
  if (existing) {
    await pool.query(
        `UPDATE devices
         SET apk_signature = $1, build_fingerprint = $2, version_code = $3,
             last_seen_at = NOW(), revoked = FALSE
         WHERE id = $4`,
        [apkSignature, buildFingerprint, versionCode, existing.id]
    );
    return existing.id;
  }
  const { rows } = await pool.query(
      `INSERT INTO devices (license_id, device_hash, apk_signature, build_fingerprint, version_code, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
      [licenseId, deviceHash, apkSignature, buildFingerprint, versionCode]
  );
  return rows[0].id;
}

async function touchDevice(licenseId, deviceHash) {
  await pool.query(
      `UPDATE devices SET last_seen_at = NOW()
       WHERE license_id = $1 AND device_hash = $2 AND revoked = FALSE`,
      [licenseId, deviceHash]
  );
}

async function logActivation(licenseKey, deviceHash, apkSignature, success, reason) {
  await pool.query(
      `INSERT INTO activation_log (license_key, device_hash, apk_signature, success, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [licenseKey, deviceHash, apkSignature, success, reason || null]
  );
}

async function listLicenses() {
  const { rows } = await pool.query(`
    SELECT l.*, (
      SELECT COUNT(*)::int FROM devices d WHERE d.license_id = l.id AND d.revoked = FALSE
    ) AS active_devices
    FROM licenses l ORDER BY l.id DESC
  `);
  return rows;
}

async function revokeLicense(licenseKey) {
  const lic = await findLicense(licenseKey);
  if (!lic) return false;
  await pool.query('UPDATE licenses SET revoked = TRUE WHERE id = $1', [lic.id]);
  await pool.query('UPDATE devices SET revoked = TRUE WHERE license_id = $1', [lic.id]);
  return true;
}

async function revokeDevice(licenseKey, deviceHash) {
  const lic = await findLicense(licenseKey);
  if (!lic) return false;
  const { rowCount } = await pool.query(
      'UPDATE devices SET revoked = TRUE WHERE license_id = $1 AND device_hash = $2',
      [lic.id, deviceHash]
  );
  return rowCount > 0;
}

module.exports = {
  init,
  daysRemaining,
  licenseMeta,
  findLicense,
  createLicense,
  ensureActivated,
  isExpired,
  countDevices,
  findDevice,
  upsertDevice,
  touchDevice,
  logActivation,
  listLicenses,
  revokeLicense,
  revokeDevice,
};
