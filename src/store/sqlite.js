'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { daysRemaining, licenseMeta } = require('./shared');

let db;

function init() {
  const dataDir = process.env.SQLITE_PATH
      ? path.dirname(process.env.SQLITE_PATH)
      : path.join(__dirname, '..', '..', 'data');
  const dbFile = process.env.SQLITE_PATH || path.join(dataDir, 'licenses.db');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  db = new Database(dbFile);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT NOT NULL UNIQUE,
      label TEXT,
      max_devices INTEGER NOT NULL DEFAULT 1,
      valid_days INTEGER,
      activated_at TEXT,
      expires_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id INTEGER NOT NULL,
      device_hash TEXT NOT NULL,
      apk_signature TEXT NOT NULL,
      build_fingerprint TEXT,
      version_code INTEGER,
      last_seen_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(license_id, device_hash),
      FOREIGN KEY (license_id) REFERENCES licenses(id)
    );

    CREATE TABLE IF NOT EXISTS activation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_key TEXT,
      device_hash TEXT,
      apk_signature TEXT,
      success INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const cols = db.prepare('PRAGMA table_info(licenses)').all().map(c => c.name);
  if (!cols.includes('valid_days')) db.exec('ALTER TABLE licenses ADD COLUMN valid_days INTEGER');
  if (!cols.includes('activated_at')) db.exec('ALTER TABLE licenses ADD COLUMN activated_at TEXT');
  if (!cols.includes('expires_at')) db.exec('ALTER TABLE licenses ADD COLUMN expires_at TEXT');
}

async function findLicense(key) {
  return db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(key);
}

async function createLicense(key, label, maxDevices, validDays) {
  const days = validDays > 0 ? validDays : null;
  const info = db.prepare(
      'INSERT INTO licenses (license_key, label, max_devices, valid_days) VALUES (?, ?, ?, ?)'
  ).run(key, label || null, maxDevices, days);
  return info.lastInsertRowid;
}

async function ensureActivated(license) {
  if (!license || !license.valid_days || license.valid_days <= 0) return license;
  if (license.activated_at) return license;
  const expires = new Date(Date.now() + license.valid_days * 86400000).toISOString();
  db.prepare(`
    UPDATE licenses
    SET activated_at = datetime('now'), expires_at = ?
    WHERE id = ?
  `).run(expires, license.id);
  return findLicense(license.license_key);
}

function isExpired(license) {
  if (!license || !license.expires_at) return false;
  return new Date(license.expires_at).getTime() <= Date.now();
}

async function countDevices(licenseId) {
  const row = db.prepare(
      'SELECT COUNT(*) AS c FROM devices WHERE license_id = ? AND revoked = 0'
  ).get(licenseId);
  return row.c;
}

async function findDevice(licenseId, deviceHash) {
  return db.prepare(
      'SELECT * FROM devices WHERE license_id = ? AND device_hash = ?'
  ).get(licenseId, deviceHash);
}

async function upsertDevice(licenseId, deviceHash, apkSignature, buildFingerprint, versionCode) {
  const existing = await findDevice(licenseId, deviceHash);
  if (existing) {
    db.prepare(`
      UPDATE devices
      SET apk_signature = ?, build_fingerprint = ?, version_code = ?,
          last_seen_at = datetime('now'), revoked = 0
      WHERE id = ?
    `).run(apkSignature, buildFingerprint, versionCode, existing.id);
    return existing.id;
  }
  const info = db.prepare(`
    INSERT INTO devices (license_id, device_hash, apk_signature, build_fingerprint, version_code, last_seen_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(licenseId, deviceHash, apkSignature, buildFingerprint, versionCode);
  return info.lastInsertRowid;
}

async function touchDevice(licenseId, deviceHash) {
  db.prepare(`
    UPDATE devices SET last_seen_at = datetime('now')
    WHERE license_id = ? AND device_hash = ? AND revoked = 0
  `).run(licenseId, deviceHash);
}

async function logActivation(licenseKey, deviceHash, apkSignature, success, reason) {
  db.prepare(`
    INSERT INTO activation_log (license_key, device_hash, apk_signature, success, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(licenseKey, deviceHash, apkSignature, success ? 1 : 0, reason || null);
}

async function listLicenses() {
  return db.prepare(`
    SELECT l.*, (
      SELECT COUNT(*) FROM devices d WHERE d.license_id = l.id AND d.revoked = 0
    ) AS active_devices
    FROM licenses l ORDER BY l.id DESC
  `).all();
}

async function revokeLicense(licenseKey) {
  const lic = await findLicense(licenseKey);
  if (!lic) return false;
  db.prepare('UPDATE licenses SET revoked = 1 WHERE id = ?').run(lic.id);
  db.prepare('UPDATE devices SET revoked = 1 WHERE license_id = ?').run(lic.id);
  return true;
}

async function revokeDevice(licenseKey, deviceHash) {
  const lic = await findLicense(licenseKey);
  if (!lic) return false;
  const info = db.prepare(`
    UPDATE devices SET revoked = 1
    WHERE license_id = ? AND device_hash = ?
  `).run(lic.id, deviceHash);
  return info.changes > 0;
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
