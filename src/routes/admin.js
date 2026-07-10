'use strict';

const express = require('express');
const crypto = require('../crypto');
const { getStore } = require('../store');

const router = express.Router();

function getAdminSecret() {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret === 'change-me-to-a-long-random-string') return null;
  return secret;
}

function adminAuth(req, res, next) {
  const secret = getAdminSecret();
  if (!secret) {
    return res.status(503).json({
      ok: false,
      error: 'Set ADMIN_SECRET in .env before using admin routes',
    });
  }
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : req.headers['x-admin-secret'];
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  if (token === secret) return next();
  try {
    crypto.verifyAdminSession(token, secret);
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
}

/** POST /api/admin/login { secret } → admin session JWT for the web UI */
router.post('/login', (req, res) => {
  const secret = getAdminSecret();
  if (!secret) {
    return res.status(503).json({ ok: false, error: 'ADMIN_SECRET not configured' });
  }
  const { secret: provided } = req.body || {};
  if (!provided || provided !== secret) {
    return res.status(401).json({ ok: false, error: 'Invalid admin secret' });
  }
  const ttl = parseInt(process.env.ADMIN_SESSION_TTL_SEC || '86400', 10);
  const token = crypto.signAdminSession(secret, ttl);
  return res.json({ ok: true, token, expiresIn: ttl });
});

/** GET /api/admin/me — check session */
router.get('/me', adminAuth, (_req, res) => {
  res.json({ ok: true, role: 'admin' });
});

router.use(adminAuth);

/** POST /api/admin/licenses */
router.post('/licenses', async (req, res) => {
  const store = getStore();
  const { licenseKey, label, maxDevices, validDays } = req.body || {};
  if (!licenseKey || typeof licenseKey !== 'string' || licenseKey.length < 8) {
    return res.status(400).json({ ok: false, error: 'licenseKey required (min 8 chars)' });
  }
  if (await store.findLicense(licenseKey)) {
    return res.status(409).json({ ok: false, error: 'License already exists' });
  }
  const days = parseInt(validDays, 10);
  const id = await store.createLicense(licenseKey, label, maxDevices || 1, days);
  const license = await store.findLicense(licenseKey);
  return res.json({
    ok: true,
    id,
    licenseKey,
    maxDevices: maxDevices || 1,
    ...store.licenseMeta(license),
  });
});

/** GET /api/admin/licenses */
router.get('/licenses', async (_req, res) => {
  const store = getStore();
  const licenses = await store.listLicenses();
  const enriched = licenses.map((lic) => ({
    ...lic,
    ...store.licenseMeta(lic),
    revoked: !!lic.revoked,
  }));
  return res.json({ ok: true, licenses: enriched });
});

/** GET /api/admin/licenses/:licenseKey/devices */
router.get('/licenses/:licenseKey/devices', async (req, res) => {
  const store = getStore();
  const lic = await store.findLicense(req.params.licenseKey);
  if (!lic) return res.status(404).json({ ok: false, error: 'License not found' });
  const devices = await store.listDevices(lic.id);
  return res.json({
    ok: true,
    licenseKey: lic.license_key,
    devices: devices.map((d) => ({
      ...d,
      revoked: !!d.revoked,
    })),
  });
});

/** POST /api/admin/licenses/revoke */
router.post('/licenses/revoke', async (req, res) => {
  const store = getStore();
  const { licenseKey } = req.body || {};
  if (!licenseKey) return res.status(400).json({ ok: false, error: 'licenseKey required' });
  const ok = await store.revokeLicense(licenseKey);
  return res.json({ ok });
});

/** POST /api/admin/devices/revoke */
router.post('/devices/revoke', async (req, res) => {
  const store = getStore();
  const { licenseKey, deviceHash } = req.body || {};
  if (!licenseKey || !deviceHash) {
    return res.status(400).json({ ok: false, error: 'licenseKey and deviceHash required' });
  }
  const ok = await store.revokeDevice(licenseKey, deviceHash);
  return res.json({ ok });
});

module.exports = router;
