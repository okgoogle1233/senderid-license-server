'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'licenses.db'));
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

(function migrate() {
  const cols = db.prepare('PRAGMA table_info(licenses)').all().map(c => c.name);
  if (!cols.includes('valid_days')) db.exec('ALTER TABLE licenses ADD COLUMN valid_days INTEGER');
  if (!cols.includes('activated_at')) db.exec('ALTER TABLE licenses ADD COLUMN activated_at TEXT');
  if (!cols.includes('expires_at')) db.exec('ALTER TABLE licenses ADD COLUMN expires_at TEXT');
})();

function daysRemaining(license) {
  if (!license || !license.expires_at) return null;
  const ms = new Date(license.expires_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

module.exports = {
  db,
  daysRemaining,

  findLicense(key) {
    return db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(key);
  },

  createLicense(key, label, maxDevices, validDays) {
    const days = validDays > 0 ? validDays : null;
    const info = db.prepare(
      'INSERT INTO licenses (license_key, label, max_devices, valid_days) VALUES (?, ?, ?, ?)'
    ).run(key, label || null, maxDevices, days);
    return info.lastInsertRowid;
  },

  /** Start the day-count on first successful activation. */
  ensureActivated(license) {
    if (!license || !license.valid_days || license.valid_days <= 0) return license;
    if (license.activated_at) return license;
    const expires = new Date(Date.now() + license.valid_days * 86400000).toISOString();
    db.prepare(`
      UPDATE licenses
      SET activated_at = datetime('now'), expires_at = ?
      WHERE id = ?
    `).run(expires, license.id);
    return module.exports.findLicense(license.license_key);
  },

  isExpired(license) {
    if (!license || !license.expires_at) return false;
    return new Date(license.expires_at).getTime() <= Date.now();
  },

  licenseMeta(license) {
    const lifetime = !license.valid_days || license.valid_days <= 0;
    return {
      validDays: lifetime ? null : license.valid_days,
      lifetime,
      activatedAt: license.activated_at || null,
      expiresAt: license.expires_at || null,
      daysRemaining: daysRemaining(license),
    };
  },

  countDevices(licenseId) {
    const row = db.prepare(
      'SELECT COUNT(*) AS c FROM devices WHERE license_id = ? AND revoked = 0'
    ).get(licenseId);
    return row.c;
  },

  findDevice(licenseId, deviceHash) {
    return db.prepare(
      'SELECT * FROM devices WHERE license_id = ? AND device_hash = ?'
    ).get(licenseId, deviceHash);
  },

  upsertDevice(licenseId, deviceHash, apkSignature, buildFingerprint, versionCode) {
    const existing = module.exports.findDevice(licenseId, deviceHash);
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
  },

  touchDevice(licenseId, deviceHash) {
    db.prepare(`
      UPDATE devices SET last_seen_at = datetime('now')
      WHERE license_id = ? AND device_hash = ? AND revoked = 0
    `).run(licenseId, deviceHash);
  },

  logActivation(licenseKey, deviceHash, apkSignature, success, reason) {
    db.prepare(`
      INSERT INTO activation_log (license_key, device_hash, apk_signature, success, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(licenseKey, deviceHash, apkSignature, success ? 1 : 0, reason || null);
  },

  listLicenses() {
    return db.prepare(`
      SELECT l.*, (
        SELECT COUNT(*) FROM devices d WHERE d.license_id = l.id AND d.revoked = 0
      ) AS active_devices
      FROM licenses l ORDER BY l.id DESC
    `).all();
  },

  revokeLicense(licenseKey) {
    const lic = module.exports.findLicense(licenseKey);
    if (!lic) return false;
    db.prepare('UPDATE licenses SET revoked = 1 WHERE id = ?').run(lic.id);
    db.prepare('UPDATE devices SET revoked = 1 WHERE license_id = ?').run(lic.id);
    return true;
  },

  revokeDevice(licenseKey, deviceHash) {
    const lic = module.exports.findLicense(licenseKey);
    if (!lic) return false;
    const info = db.prepare(`
      UPDATE devices SET revoked = 1
      WHERE license_id = ? AND device_hash = ?
    `).run(lic.id, deviceHash);
    return info.changes > 0;
  },
};
