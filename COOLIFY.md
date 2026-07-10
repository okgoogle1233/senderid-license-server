# Deploy on Coolify (one-command)

This guide deploys **senderid-license-server** on [Coolify](https://coolify.io) using Docker.

## Database

| Environment | Database | Config |
|-------------|----------|--------|
| **Coolify / production** | **PostgreSQL** (recommended) | `DATABASE_URL` env var |
| **Local dev** | SQLite file | Leave `DATABASE_URL` unset → uses `data/licenses.db` |

**Where to add the database link on Coolify:**

1. In Coolify → **+ New Resource** → **Database** → **PostgreSQL**
2. After it is created, open the database → copy **Postgres URL** / **Connection String**
3. Open your **license-server** application → **Environment Variables**
4. Add:

   ```
   DATABASE_URL=postgres://user:pass@coolify-postgres:5432/license
   ```

   Or use Coolify’s **Connect to Database** button on the app — it injects `DATABASE_URL` automatically.

5. (Optional) If SSL is required by your provider, also set `DATABASE_SSL=true`

---

## One-command deploy

### Option A — Coolify UI (recommended)

1. Push this repo to GitHub: `okgoogle1233/senderid-license-server`
2. Coolify → **+ New Resource** → **Application**
3. Source: GitHub → select `senderid-license-server`
4. Build pack: **Dockerfile** (auto-detected)
5. Add PostgreSQL database (step above) and link it
6. Set environment variables:

   | Variable | Required | Example |
   |----------|----------|---------|
   | `ADMIN_SECRET` | Yes | long random string |
   | `DATABASE_URL` | Yes | from Coolify Postgres |
   | `ALLOWED_APK_SIGNATURES` | Prod | your APK cert SHA-256 |
   | `PORT` | Auto | Coolify sets this |

7. **Persistent storage** — add a volume mount (important):

   | Path in container | Purpose |
   |-------------------|---------|
   | `/app/keys` | RSA signing keys (survive redeploys) |

8. Deploy → Coolify builds the Dockerfile and starts the app

### Option B — Docker Compose (local / VPS)

```bash
cd license-server
cp .env.example .env   # set ADMIN_SECRET
docker compose up -d --build
```

Health check: `curl http://localhost:3847/health`

---

## After deploy

1. **Create a license** (from your machine, against the live URL):

   ```bash
   curl -X POST https://license.yourdomain.com/api/admin/licenses \
     -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"licenseKey":"USER-30D-001","maxDevices":1,"validDays":30}'
   ```

2. **Copy public key** into the Android app:

   ```bash
   curl https://license.yourdomain.com/api/license/public-key \
     > ../app/src/main/assets/license_public.pem
   ```

   Rebuild the APK and set `LICENSE_SERVER` in `app/build.gradle` to your Coolify URL.

3. **Set `ALLOWED_APK_SIGNATURES`** to your release keystore SHA-256.

---

## Environment reference

```env
PORT=3847                          # Coolify overrides automatically
ADMIN_SECRET=your-secret           # Required for admin API
DATABASE_URL=postgres://...        # Required on Coolify (PostgreSQL)
DATABASE_SSL=true                  # Only if provider requires SSL
ALLOWED_APK_SIGNATURES=abc123...     # Release APK cert hash(es)
MIN_VERSION_CODE=1
INJECT_TOKEN_TTL_SEC=120
LICENSE_TOKEN_TTL_SEC=604800
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| App restarts, licenses lost | Set `DATABASE_URL` to PostgreSQL (not SQLite) |
| `Invalid or missing license token` after redeploy | Mount `/app/keys` persistent volume |
| `Set ADMIN_SECRET` error | Set `ADMIN_SECRET` in Coolify env vars |
| DB connection refused | Link Postgres to app in Coolify; check internal hostname |
