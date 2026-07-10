# License Server

Standalone licensing backend for **SMS Sender ID Injector**. Keeps activation, heartbeat, and inject-token issuance separate from `x.cheifx.be`.

## Database

| Mode | Engine | How to configure |
|------|--------|------------------|
| **Coolify / production** | **PostgreSQL** | Set `DATABASE_URL` env var (from Coolify Postgres resource) |
| **Local dev** | **SQLite** | Leave `DATABASE_URL` unset → file at `data/licenses.db` |

**Where to add the database link:** set the `DATABASE_URL` environment variable.

- **Coolify:** create a PostgreSQL database → link it to the app (auto-injects `DATABASE_URL`) or paste the Postgres URL manually in **Environment Variables**. See **[COOLIFY.md](./COOLIFY.md)** for one-command deploy steps.
- **Docker Compose:** `docker compose up -d` (includes Postgres + sets `DATABASE_URL` automatically).
- **Local:** no `DATABASE_URL` needed — SQLite is used automatically.

## Quick start (local)

```bash
cd license-server
cp .env.example .env
# Edit .env — set ADMIN_SECRET to a long random string

npm install
npm run generate-keys   # only if keys/ is empty
npm run create-license -- DEMO-LICENSE-001 3 30 "30-day trial"
npm start
```

## Deploy on Coolify (one command)

```bash
docker compose up -d --build   # local test with Postgres
```

For Coolify cloud: connect GitHub repo → Dockerfile build → add PostgreSQL → set `ADMIN_SECRET` → mount `/app/keys` volume.

Full guide: **[COOLIFY.md](./COOLIFY.md)**

Server runs on **port 3847** by default (`http://YOUR_SERVER:3847`).

## Admin web UI

Open **`/admin/`** in a browser (e.g. `https://license.yourdomain.com/admin/`).

1. Sign in with your **`ADMIN_SECRET`**
2. Create licenses (key, label, max devices, valid days)
3. View / revoke licenses and individual devices

Session lasts 24 hours (configurable via `ADMIN_SESSION_TTL_SEC`).

## Day-based licenses

Each license can have a **`validDays`** duration. Important rules:

- **`validDays: 0` or omitted** → lifetime license (never expires)
- **Clock starts on first activation** (when a device first activates the key), not when you create the key
- After expiry, activate/heartbeat return `403 License expired` and the app stops injecting

Create a 30-day license:

```bash
npm run create-license -- USER-30D-001 1 30 "30-day customer"
```

Or via admin API:

```json
{ "licenseKey": "USER-30D-001", "maxDevices": 1, "validDays": 30, "label": "30-day customer" }
```

Activate/heartbeat responses include:

```json
{
  "lifetime": false,
  "validDays": 30,
  "activatedAt": "2026-07-10T12:00:00.000Z",
  "expiresAt": "2026-08-09T12:00:00.000Z",
  "daysRemaining": 30
}
```

## API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | — | Health check |
| GET | `/api/license/public-key` | — | RSA public key (PEM) |
| POST | `/api/license/activate` | — | Bind device + issue tokens |
| POST | `/api/license/heartbeat` | license JWT | Refresh inject token |
| POST | `/api/license/status` | license JWT | Lightweight validity check |

### Activate body

```json
{
  "licenseKey": "DEMO-LICENSE-001",
  "deviceHash": "sha256hex...",
  "apkSignature": "sha256hex...",
  "buildFingerprint": "google/...",
  "versionCode": 2
}
```

### Response

```json
{
  "ok": true,
  "licenseToken": "eyJ...",
  "injectToken": "eyJ...",
  "licenseExpiresIn": 604800,
  "injectExpiresIn": 120,
  "lifetime": false,
  "validDays": 30,
  "expiresAt": "2026-08-09T12:00:00.000Z",
  "daysRemaining": 30
}
```

## Admin API

All admin routes require header `Authorization: Bearer <ADMIN_SECRET>`.

```bash
# Create license
curl -X POST http://localhost:3847/api/admin/licenses \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"USER-ABC-123","maxDevices":1,"validDays":30}'

# List licenses
curl http://localhost:3847/api/admin/licenses \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET"

# Revoke license
curl -X POST http://localhost:3847/api/admin/licenses/revoke \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"USER-ABC-123"}'

# Revoke single device
curl -X POST http://localhost:3847/api/admin/devices/revoke \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"licenseKey":"USER-ABC-123","deviceHash":"..."}'
```

## Production hardening

1. **Regenerate keys** on your server (`npm run generate-keys`), copy `public.pem` into the Android app `assets/`, rebuild APK.
2. Set `ALLOWED_APK_SIGNATURES` in `.env` to your release signing cert SHA-256 (hex, lowercase). Get it from the app log on first launch or:
   ```bash
   keytool -list -v -keystore your-release.keystore -alias youralias | grep SHA256
   ```
   (Remove colons, lowercase.)
3. Put the server behind HTTPS (nginx/Caddy + Let's Encrypt).
4. Set `LICENSE_SERVER` in `app/build.gradle` `release` buildConfig to your HTTPS URL.
5. Never commit `keys/private.pem` or `.env`.

## Deploy example (VPS)

```bash
git clone <repo>
cd SmsSenderIdInjector/license-server
cp .env.example .env && nano .env
npm install --production
npm run generate-keys
npm run create-license -- PROD-KEY-001 1
PORT=3847 node src/server.js
```

Use `pm2` or systemd for persistence. Reverse-proxy `:3847` to `https://license.yourdomain.com`.
