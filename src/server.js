'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const crypto = require('./crypto');
const { initStore } = require('./store');
const licenseRoutes = require('./routes/license');
const adminRoutes = require('./routes/admin');

const app = express();
const port = parseInt(process.env.PORT || '3847', 10);
const publicDir = path.join(__dirname, '..', 'public');

app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use('/admin', express.static(path.join(publicDir, 'admin')));

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'senderid-license-server',
    status: 'running',
    adminUi: '/admin/',
    endpoints: {
      health: 'GET /health',
      publicKey: 'GET /api/license/public-key',
      activate: 'POST /api/license/activate',
      heartbeat: 'POST /api/license/heartbeat',
      admin: 'POST /api/admin/licenses (Bearer ADMIN_SECRET)',
    },
  });
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin', 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'senderid-license-server',
    database: process.env.DATABASE_URL ? 'postgresql' : 'sqlite',
    schema: process.env.DATABASE_URL
        ? (process.env.PG_SCHEMA || 'senderid_license')
        : undefined,
  });
});

app.get('/api/license/public-key', (_req, res) => {
  res.type('text/plain').send(crypto.getPublicKey());
});

app.use('/api/license', licenseRoutes);
app.use('/api/admin', adminRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

async function main() {
  const { driver } = await initStore();
  app.listen(port, '0.0.0.0', () => {
    console.log(`License server listening on http://0.0.0.0:${port}`);
    console.log(`Database: ${driver}`);
    console.log(`Admin UI:  http://0.0.0.0:${port}/admin/`);
    console.log('Health: GET /health');
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
