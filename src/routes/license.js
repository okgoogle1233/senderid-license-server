'use strict';

const express = require('express');
const store = require('../db');
const crypto = require('../crypto');

const router = express.Router();

function envList(name) {
  const raw = process.env[name] || '';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function reject(res, code, message) {
  return res.status(code).json({ ok: false, error: message });
}

function assertApkSignature(apkSignature) {
  const allowed = envList('ALLOWED_APK_SIGNATURES');
  if (allowed.length === 0) return true;
  return allowed.includes((apkSignature || '').toLowerCase());
}

function assertMinVersion(versionCode) {
  const min = parseInt(process.env.MIN_VERSION_CODE || '1', 10);
  return !versionCode || versionCode >= min;
}

function tokenTtlSec(license, defaultTtl) {
  if (!license.expires_at) return defaultTtl;
  const sec = Math.floor((new Date(license.expires_at).getTime() - Date.now()) / 1000);
  if (sec <= 0) return 0;
  return Math.min(defaultTtl, sec);
}

function assertNotExpired(license) {
  if (store.isExpired(license)) {
    return { ok: false, error: 'License expired' };
  }
  return { ok: true, license };
}

function issueTokens(license, device) {
  const defaultLicenseTtl = parseInt(process.env.LICENSE_TOKEN_TTL_SEC || '604800', 10);
  const injectTtlDefault = parseInt(process.env.INJECT_TOKEN_TTL_SEC || '120', 10);
  const licenseTtl = tokenTtlSec(license, defaultLicenseTtl);
  const injectTtl = tokenTtlSec(license, injectTtlDefault);
  if (licenseTtl <= 0 || injectTtl <= 0) {
    return null;
  }

  const lexp = license.expires_at
      ? Math.floor(new Date(license.expires_at).getTime() / 1000)
      : null;

  const licenseToken = crypto.signLicenseToken({
    typ: 'license',
    lic: license.license_key,
    sub: device.device_hash,
    apk: device.apk_signature,
    lexp,
  }, licenseTtl);

  const injectToken = crypto.signInjectToken({
    sub: device.device_hash,
    apk: device.apk_signature,
    lic: license.license_key,
    lexp,
  }, injectTtl);

  return {
    licenseToken,
    injectToken,
    licenseExpiresIn: licenseTtl,
    injectExpiresIn: injectTtl,
    ...store.licenseMeta(license),
  };
}

/** POST /api/license/activate */
router.post('/activate', (req, res) => {
  const { licenseKey, deviceHash, apkSignature, buildFingerprint, versionCode } = req.body || {};

  if (!licenseKey || !deviceHash || !apkSignature) {
    store.logActivation(licenseKey, deviceHash, apkSignature, false, 'missing_fields');
    return reject(res, 400, 'licenseKey, deviceHash, and apkSignature are required');
  }

  if (!assertApkSignature(apkSignature)) {
    store.logActivation(licenseKey, deviceHash, apkSignature, false, 'apk_not_allowed');
    return reject(res, 403, 'APK signature not authorized');
  }

  if (!assertMinVersion(versionCode)) {
    store.logActivation(licenseKey, deviceHash, apkSignature, false, 'version_too_old');
    return reject(res, 403, 'App version too old');
  }

  let license = store.findLicense(licenseKey);
  if (!license || license.revoked) {
    store.logActivation(licenseKey, deviceHash, apkSignature, false, 'invalid_license');
    return reject(res, 403, 'Invalid or revoked license');
  }

  let device = store.findDevice(license.id, deviceHash);
  const isNewDevice = !device || device.revoked;
  if (isNewDevice) {
    const active = store.countDevices(license.id);
    if (active >= license.max_devices) {
      store.logActivation(licenseKey, deviceHash, apkSignature, false, 'device_limit');
      return reject(res, 403, 'Device limit reached for this license');
    }
  }

  // Day-based licenses: clock starts on first activation (any device).
  license = store.ensureActivated(license);
  const expiryCheck = assertNotExpired(license);
  if (!expiryCheck.ok) {
    store.logActivation(licenseKey, deviceHash, apkSignature, false, 'license_expired');
    return reject(res, 403, expiryCheck.error);
  }

  store.upsertDevice(license.id, deviceHash, apkSignature, buildFingerprint, versionCode);
  device = store.findDevice(license.id, deviceHash);

  if (device.revoked) {
    store.logActivation(licenseKey, deviceHash, apkSignature, false, 'device_revoked');
    return reject(res, 403, 'Device revoked');
  }

  const tokens = issueTokens(license, device);
  if (!tokens) {
    store.logActivation(licenseKey, deviceHash, apkSignature, false, 'license_expired');
    return reject(res, 403, 'License expired');
  }

  store.logActivation(licenseKey, deviceHash, apkSignature, true, 'activated');

  return res.json({
    ok: true,
    licenseKey: license.license_key,
    maxDevices: license.max_devices,
    ...tokens,
  });
});

/** POST /api/license/heartbeat */
router.post('/heartbeat', (req, res) => {
  const {
    licenseToken,
    deviceHash,
    apkSignature,
    versionCode,
  } = req.body || {};

  if (!licenseToken || !deviceHash || !apkSignature) {
    return reject(res, 400, 'licenseToken, deviceHash, and apkSignature are required');
  }

  let claims;
  try {
    claims = crypto.verifyToken(licenseToken);
  } catch (e) {
    return reject(res, 401, 'Invalid or expired license token');
  }

  if (claims.typ !== 'license' || claims.sub !== deviceHash) {
    return reject(res, 401, 'License token mismatch');
  }

  if (!assertApkSignature(apkSignature)) {
    return reject(res, 403, 'APK signature not authorized');
  }

  if (!assertMinVersion(versionCode)) {
    return reject(res, 403, 'App version too old — update required');
  }

  let license = store.findLicense(claims.lic);
  if (!license || license.revoked) {
    return reject(res, 403, 'License revoked');
  }

  const expiryCheck = assertNotExpired(license);
  if (!expiryCheck.ok) {
    return reject(res, 403, expiryCheck.error);
  }

  const device = store.findDevice(license.id, deviceHash);
  if (!device || device.revoked) {
    return reject(res, 403, 'Device not authorized');
  }

  if ((device.apk_signature || '').toLowerCase() !== (apkSignature || '').toLowerCase()) {
    return reject(res, 403, 'APK signature changed');
  }

  store.touchDevice(license.id, deviceHash);
  const tokens = issueTokens(license, device);
  if (!tokens) {
    return reject(res, 403, 'License expired');
  }

  return res.json({
    ok: true,
    ...tokens,
  });
});

/** POST /api/license/status — lightweight check */
router.post('/status', (req, res) => {
  const { licenseToken, deviceHash } = req.body || {};
  if (!licenseToken || !deviceHash) {
    return reject(res, 400, 'licenseToken and deviceHash required');
  }
  try {
    const claims = crypto.verifyToken(licenseToken);
    if (claims.typ !== 'license' || claims.sub !== deviceHash) {
      return reject(res, 401, 'mismatch');
    }
    const license = store.findLicense(claims.lic);
    if (!license || license.revoked) return reject(res, 403, 'revoked');
    if (store.isExpired(license)) return reject(res, 403, 'License expired');
    const device = store.findDevice(license.id, deviceHash);
    if (!device || device.revoked) return reject(res, 403, 'device_revoked');
    return res.json({ ok: true, licenseKey: license.license_key, ...store.licenseMeta(license) });
  } catch (e) {
    return reject(res, 401, 'invalid_token');
  }
});

module.exports = router;
