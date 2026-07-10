'use strict';

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const keysDir = path.join(__dirname, '..', 'keys');
const privatePath = path.join(keysDir, 'private.pem');
const publicPath = path.join(keysDir, 'public.pem');

function ensureKeys() {
  if (!fs.existsSync(privatePath) || !fs.existsSync(publicPath)) {
    throw new Error(
      'RSA keys missing. Run: npm run generate-keys'
    );
  }
}

function getPrivateKey() {
  ensureKeys();
  return fs.readFileSync(privatePath, 'utf8');
}

function getPublicKey() {
  ensureKeys();
  return fs.readFileSync(publicPath, 'utf8');
}

function signLicenseToken(payload, ttlSec) {
  return jwt.sign(payload, getPrivateKey(), {
    algorithm: 'RS256',
    expiresIn: ttlSec,
  });
}

function signInjectToken(payload, ttlSec) {
  return jwt.sign({ ...payload, typ: 'inject' }, getPrivateKey(), {
    algorithm: 'RS256',
    expiresIn: ttlSec,
  });
}

function verifyToken(token) {
  return jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
}

/** Short-lived admin UI session (HS256, signed with ADMIN_SECRET). */
function signAdminSession(adminSecret, ttlSec = 86400) {
  return jwt.sign({ typ: 'admin' }, adminSecret, {
    algorithm: 'HS256',
    expiresIn: ttlSec,
  });
}

function verifyAdminSession(token, adminSecret) {
  const claims = jwt.verify(token, adminSecret, { algorithms: ['HS256'] });
  if (claims.typ !== 'admin') throw new Error('invalid admin token');
  return claims;
}

module.exports = {
  getPublicKey,
  signLicenseToken,
  signInjectToken,
  verifyToken,
  signAdminSession,
  verifyAdminSession,
};
