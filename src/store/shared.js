'use strict';

function daysRemaining(license) {
  if (!license || !license.expires_at) return null;
  const ms = new Date(license.expires_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

function licenseMeta(license) {
  const lifetime = !license.valid_days || license.valid_days <= 0;
  return {
    validDays: lifetime ? null : license.valid_days,
    lifetime,
    activatedAt: license.activated_at || null,
    expiresAt: license.expires_at || null,
    daysRemaining: daysRemaining(license),
  };
}

module.exports = { daysRemaining, licenseMeta };
