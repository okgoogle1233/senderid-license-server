'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('./crypto');
const licenseRoutes = require('./routes/license');
const adminRoutes = require('./routes/admin');

const app = express();
const port = parseInt(process.env.PORT || '3847', 10);

app.use(cors());
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'senderid-license-server' });
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

app.listen(port, () => {
  console.log(`License server listening on http://0.0.0.0:${port}`);
  console.log('Health: GET /health');
  console.log('Create license: npm run create-license -- YOUR-KEY-HERE');
});
