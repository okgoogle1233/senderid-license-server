const TOKEN_KEY = 'license_admin_token';

const $ = (id) => document.getElementById(id);

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function token() { return sessionStorage.getItem(TOKEN_KEY); }
function setToken(t) { sessionStorage.setItem(TOKEN_KEY, t); }
function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function trunc(s, n = 12) {
  if (!s) return '—';
  return s.length <= n ? s : s.slice(0, n) + '…';
}

// ── Login ──

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('loginError');
  hide(err);
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ secret: $('adminSecret').value }),
      headers: {}, // no token yet
    });
    setToken(data.token);
    showDashboard();
  } catch (ex) {
    err.textContent = ex.message;
    show(err);
  }
});

$('logoutBtn').addEventListener('click', () => {
  clearToken();
  hide($('dashView'));
  show($('loginView'));
  $('adminSecret').value = '';
});

// ── Dashboard ──

async function showDashboard() {
  hide($('loginView'));
  show($('dashView'));
  try {
    await api('/api/admin/me');
    await loadLicenses();
  } catch {
    clearToken();
    show($('loginView'));
    hide($('dashView'));
  }
}

async function loadLicenses() {
  const tbody = $('licenseRows');
  tbody.innerHTML = '<tr><td colspan="7" class="muted center">Loading…</td></tr>';
  try {
    const { licenses } = await api('/api/admin/licenses');
    if (!licenses.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted center">No licenses yet</td></tr>';
      return;
    }
    tbody.innerHTML = licenses.map((lic) => {
      const revoked = lic.revoked;
      const duration = lic.lifetime ? 'Lifetime' : `${lic.validDays || '?'} days`;
      const expires = lic.lifetime ? '—' : (lic.expiresAt ? fmtDate(lic.expiresAt) : 'On first activation');
      const daysLeft = lic.lifetime ? '∞' : (lic.daysRemaining != null ? `${lic.daysRemaining}d` : '—');
      const status = revoked
        ? '<span class="badge off">Revoked</span>'
        : (lic.expiresAt && lic.daysRemaining === 0
          ? '<span class="badge off">Expired</span>'
          : '<span class="badge ok">Active</span>');
      return `<tr>
        <td class="mono">${esc(lic.license_key)}</td>
        <td>${esc(lic.label || '—')}</td>
        <td>${lic.active_devices || 0} / ${lic.max_devices}</td>
        <td>${duration}<br><span class="muted">${daysLeft} left</span></td>
        <td>${expires}</td>
        <td>${status}</td>
        <td class="actions">
          <button class="btn ghost sm" data-devices="${esc(lic.license_key)}">Devices</button>
          ${revoked ? '' : `<button class="btn danger sm" data-revoke="${esc(lic.license_key)}">Revoke</button>`}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-revoke]').forEach((btn) => {
      btn.addEventListener('click', () => revokeLicense(btn.dataset.revoke));
    });
    tbody.querySelectorAll('[data-devices]').forEach((btn) => {
      btn.addEventListener('click', () => loadDevices(btn.dataset.devices));
    });
  } catch (ex) {
    tbody.innerHTML = `<tr><td colspan="7" class="error center">${esc(ex.message)}</td></tr>`;
  }
}

$('refreshBtn').addEventListener('click', loadLicenses);

$('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('createMsg');
  hide(msg);
  try {
    await api('/api/admin/licenses', {
      method: 'POST',
      body: JSON.stringify({
        licenseKey: $('newKey').value.trim(),
        label: $('newLabel').value.trim() || null,
        maxDevices: parseInt($('newMax').value, 10) || 1,
        validDays: parseInt($('newDays').value, 10) || 0,
      }),
    });
    msg.textContent = 'License created';
    msg.className = 'msg ok';
    show(msg);
    $('createForm').reset();
    $('newMax').value = '1';
    $('newDays').value = '30';
    await loadLicenses();
  } catch (ex) {
    msg.textContent = ex.message;
    msg.className = 'msg err';
    show(msg);
  }
});

async function revokeLicense(key) {
  if (!confirm(`Revoke license "${key}" and all its devices?`)) return;
  try {
    await api('/api/admin/licenses/revoke', {
      method: 'POST',
      body: JSON.stringify({ licenseKey: key }),
    });
    await loadLicenses();
    if ($('devicesLicenseKey').textContent === key) hide($('devicesPanel'));
  } catch (ex) {
    alert(ex.message);
  }
}

async function loadDevices(licenseKey) {
  $('devicesLicenseKey').textContent = licenseKey;
  const tbody = $('deviceRows');
  tbody.innerHTML = '<tr><td colspan="5" class="muted center">Loading…</td></tr>';
  show($('devicesPanel'));
  try {
    const { devices } = await api(`/api/admin/licenses/${encodeURIComponent(licenseKey)}/devices`);
    if (!devices.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted center">No devices activated</td></tr>';
      return;
    }
    tbody.innerHTML = devices.map((d) => {
      const status = d.revoked
        ? '<span class="badge off">Revoked</span>'
        : '<span class="badge ok">Active</span>';
      return `<tr>
        <td class="mono" title="${esc(d.device_hash)}">${trunc(d.device_hash, 20)}</td>
        <td class="mono" title="${esc(d.apk_signature)}">${trunc(d.apk_signature, 16)}</td>
        <td>${fmtDate(d.last_seen_at)}</td>
        <td>${status}</td>
        <td>${d.revoked ? '' : `<button class="btn danger sm" data-rdev="${esc(d.device_hash)}">Revoke</button>`}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-rdev]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Revoke this device?')) return;
        try {
          await api('/api/admin/devices/revoke', {
            method: 'POST',
            body: JSON.stringify({ licenseKey, deviceHash: btn.dataset.rdev }),
          });
          await loadDevices(licenseKey);
          await loadLicenses();
        } catch (ex) { alert(ex.message); }
      });
    });
  } catch (ex) {
    tbody.innerHTML = `<tr><td colspan="5" class="error center">${esc(ex.message)}</td></tr>`;
  }
}

$('closeDevices').addEventListener('click', () => hide($('devicesPanel')));

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
}

// Boot
if (token()) showDashboard();
else show($('loginView'));
