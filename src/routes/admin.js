'use strict';

const express = require('express');
const store = require('../db');

const router = express.Router();

function adminAuth(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret === 'change-me-to-a-long-random-string') {
    return res.status(503).json({
      ok: false,
      error: 'Set ADMIN_SECRET in .env before using admin routes',
    });
  }
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : req.headers['x-admin-secret'];
  if (token !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

router.use(adminAuth);

/** POST /api/admin/licenses { licenseKey, label?, maxDevices?, validDays? } */
router.post('/licenses', (req, res) => {
  const { licenseKey, label, maxDevices, validDays } = req.body || {};
  if (!licenseKey || typeof licenseKey !== 'string' || licenseKey.length < 8) {
    return res.status(400).json({ ok: false, error: 'licenseKey required (min 8 chars)' });
  }
  if (store.findLicense(licenseKey)) {
    return res.status(409).json({ ok: false, error: 'License already exists' });
  }
  const days = parseInt(validDays, 10);
  const id = store.createLicense(licenseKey, label, maxDevices || 1, days);
  const license = store.findLicense(licenseKey);
  return res.json({
    ok: true,
    id,
    licenseKey,
    maxDevices: maxDevices || 1,
    ...store.licenseMeta(license),
  });
});

/** GET /api/admin/licenses */
router.get('/licenses', (_req, res) => {
  return res.json({ ok: true, licenses: store.listLicenses() });
});

/** POST /api/admin/licenses/revoke { licenseKey } */
router.post('/licenses/revoke', (req, res) => {
  const { licenseKey } = req.body || {};
  if (!licenseKey) return res.status(400).json({ ok: false, error: 'licenseKey required' });
  const ok = store.revokeLicense(licenseKey);
  return res.json({ ok });
});

/** POST /api/admin/devices/revoke { licenseKey, deviceHash } */
router.post('/devices/revoke', (req, res) => {
  const { licenseKey, deviceHash } = req.body || {};
  if (!licenseKey || !deviceHash) {
    return res.status(400).json({ ok: false, error: 'licenseKey and deviceHash required' });
  }
  const ok = store.revokeDevice(licenseKey, deviceHash);
  return res.json({ ok });
});

module.exports = router;
