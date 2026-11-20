# Luminila hosting profile — public storefront, private ERP

This kit runs the app on one VPS with a deliberate split:

- **Public:** only `niththigal.com` (`www.niththigal.com`) + `api.niththigal.com` (the storefront web app + the public storefront/tracking/Razorpay webhook endpoints it calls).
- **Private:** the ERP UI, PocketBase, and the WhatsApp sidecar are reachable **only over Tailscale** — no public DNS, no exposed ports.

```
Cloudflare (public TLS, WAF)
   │ cloudflared tunnel (outbound only, no inbound ports)
   ▼
Hostinger VPS
 ├─ Storefront Next server      127.0.0.1:3001   niththigal.com / www.niththigal.com
 ├─ ERP Next standalone server  127.0.0.1:3000   public: /api/storefront/*, /api/tracking/*, /api/webhooks/razorpay, /tracking
 │                                               private (tailnet only): /pos, /inventory, /invoices, /customers, /whatsapp
 ├─ PocketBase (primary)        127.0.0.1:8090   tailnet only (https :10000)
 ├─ tenant PocketBase processes 127.0.0.1:8092+  loopback only
 └─ WPPConnect sidecar          127.0.0.1:21465  tailnet only (https :8443)

Tailscale (private TLS)
   │
   ▼
staff PC / tablet / phone ──► https://<machine>.<tailnet>.ts.net/       (ERP / POS)
                              https://<machine>.<tailnet>.ts.net:10000  (PocketBase)
                              https://<machine>.<tailnet>.ts.net:8443   (WhatsApp sidecar)
```

The app enforces the split itself through `src/proxy.ts` + `src/lib/host-guard.ts`
(Next 16 runs proxy files on the Node.js runtime, so `ADMIN_HOSTS` and
`STOREFRONT_HOSTS` are read at request time — no rebuild needed to change them):
the storefront hosts can serve only `/checkout`, `/tracking`, `/api/storefront/*`,
`/api/tracking/*`, `/api/webhooks/razorpay`, and static assets; everything else returns 404. Unknown hosts
get the public-safe view. With `ADMIN_HOSTS`/`STOREFRONT_HOSTS` unset (desktop,
`next dev`, CI) the guard is a no-op.

## 1. Host requirements

- Ubuntu 22.04/24.04 VPS with 2+ GB RAM for one store (each additional tenant
  PocketBase process needs its own memory).
- Node.js 20+ (repo requires Next 16), `git`, `sqlite3`, `cloudflared`, `tailscale`.
- PocketBase 0.25.x Linux binary (the repo ships only the Windows build).
- Build on the VPS or any Linux/NTFS machine; the exFAT Windows workaround
  (`scripts/fix-exfat-readlink.cjs`) is not needed on ext4.

## 2. Install layout

```bash
sudo useradd -r -m -d /opt/luminila luminila
sudo mkdir -p /opt/luminila/{app,pocketbase/pb_data,pocketbase/pb_migrations}
sudo mkdir -p /etc/luminila /var/backups/luminila

# application
sudo -u luminila git clone <repo> /opt/luminila/app
cd /opt/luminila/app

# PocketBase binary + migrations (migrations are already in the repo)
sudo -u luminila curl -L -o /tmp/pb.zip \
  https://github.com/pocketbase/pocketbase/releases/download/v0.25.0/pocketbase_0.25.0_linux_amd64.zip
sudo -u luminila unzip -o -j /tmp/pb.zip pocketbase -d /opt/luminila/pocketbase
sudo chmod +x /opt/luminila/pocketbase/pocketbase
sudo -u luminila cp -r pocketbase/pb_migrations /opt/luminila/pocketbase/pb_migrations

# environment (ERP + Storefront)
sudo install -m 600 deploy/env.example /etc/luminila/env
sudo install -m 600 deploy/storefront.env.example /etc/luminila/storefront.env
sudo nano /etc/luminila/env             # fill in secrets and hostnames
sudo nano /etc/luminila/storefront.env  # fill in storefront URLs/contact
```

**Build both Next standalone servers with their public env values inlined** — `NEXT_PUBLIC_*` is baked into the browser bundle:

```bash
# 1. ERP + Storefront APIs (:3000)
cd /opt/luminila/app
set -a; . /etc/luminila/env; set +a
sudo -u luminila npm ci
sudo -u luminila npm run build:desktop    # emits .next/standalone -> server-dist/

# 2. Standalone Storefront (:3001)
cd /opt/luminila/app/storefront
set -a; . /etc/luminila/storefront.env; set +a
sudo -u luminila npm ci
sudo -u luminila BUILD_STANDALONE=true npm run build
sudo -u luminila cp -r .next/static .next/standalone/.next/static
sudo -u luminila cp -r public .next/standalone/public
```

## 3. systemd services

```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now luminila-pocketbase luminila-next luminila-storefront luminila-whatsapp
systemctl status luminila-pocketbase luminila-next luminila-storefront luminila-whatsapp
```

PocketBase applies `pb_migrations` on start, so the database schema follows the
repository.

## 4. Public ingress — Cloudflare Tunnel (storefront only)

```bash
cloudflared tunnel login
cloudflared tunnel create luminila
cloudflared tunnel route dns luminila niththigal.com
cloudflared tunnel route dns luminila www.niththigal.com
cloudflared tunnel route dns luminila api.niththigal.com
sudo cp deploy/cloudflared/config.yml /etc/cloudflared/config.yml   # edit tunnel id
sudo systemctl enable --now cloudflared
```

There is deliberately **no ingress hostname for the ERP** in this config. Verify
from outside the tailnet:

```bash
curl -I https://niththigal.com/                                    # 200 (storefront)
curl -I https://api.niththigal.com/api/storefront/catalog          # 200 (public API)
curl -I https://niththigal.com/inventory                           # 404 — guard working
curl -I https://api.niththigal.com/inventory                       # 404 — guard working
curl -I https://api.niththigal.com/api/system/tenant-db            # 404
```

## 5. Private ingress — Tailscale

Follow `deploy/tailscale.md`. Short version, from the VPS:

```bash
tailscale up
tailscale serve --bg --https=443   http://127.0.0.1:3000    # ERP
tailscale serve --bg --https=10000 http://127.0.0.1:8090    # PocketBase
tailscale serve --bg --https=8443  http://127.0.0.1:21465   # WhatsApp sidecar
tailscale serve status
```

Then, from any device on your tailnet, open `https://<machine>.<tailnet>.ts.net/`
and sign in. Nothing on this hostname exists in public DNS.

## 6. First run and the S-06 re-key

**Single-account mode (the shipped default):** there is no `/setup` wizard —
it redirects to `/login`. On the first start of the ERP server, when the
`users` collection is empty, the boot hook creates the login from
`INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` (in `/etc/luminila/env`),
seeds the role rows and writes the store settings. Sign in over Tailscale at
`https://<machine>.<tailnet>.ts.net/login` with the account address. The
registry re-key below does not apply — single mode has no tenant registry to
encrypt. Full reference: `docs/SINGLE_ACCOUNT_DEPLOYMENT_2026-10-29.md`.

1. Open the ERP over Tailscale and sign in with the account email and
   `INITIAL_ADMIN_PASSWORD`.
2. Multi-account deployments only (`TENANT_MODE=multi`): provision the tenant
   through `/setup`, then run the registry re-key **inside the deployed
   environment** (this is the step that cannot be done on a machine without
   tenants):

```bash
cd /opt/luminila/app
set -a; . /etc/luminila/env; set +a
npx tsx scripts/rekey-tenant-registry.ts --verify   # expect "to encrypt: N" or plaintext warning
npx tsx scripts/rekey-tenant-registry.ts --apply    # writes registry.json.bak-* first
npx tsx scripts/rekey-tenant-registry.ts --verify   # exit 0 when all values are encrypted
```

`TENANT_REGISTRY_KEY` must already be in `/etc/luminila/env`; generate it per
deployment (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
and keep an offline copy.

## 7. Backups (Local SQLite + WhatsApp Tokens + Off-VPS Sync)

```bash
sudo cp deploy/backup/backup.sh /usr/local/bin/luminila-backup
sudo chmod 750 /usr/local/bin/luminila-backup
sudo cp deploy/backup/luminila-backup.cron /etc/cron.d/luminila-backup
```

The script uses SQLite's online `.backup` for the primary DB and every tenant DB,
then copies JSON/ZIP exports produced by the in-app `/backup` page and
`wppconnect-sidecar/tokens`. To push backups off the Hostinger disk daily to
Cloudflare R2 or Backblaze B2, configure an `rclone` remote as the `luminila`
user (`sudo -u luminila rclone config`) and set `RCLONE_DEST=r2:niththigal-backups`
inside `/etc/luminila/backup.env` (`chmod 600`, owned by `luminila:luminila`) — a
backup only on the same disk is not a backup.

## 8. Security & Cloudflare WAF checklist

- [ ] **Firewall (Hostinger UFW):** `ufw default deny incoming`, `ufw allow in on tailscale0`, and `ufw allow in on tailscale0 to any port 22 proto tcp`; delete public `22/tcp` once Tailscale SSH works (keep Hostinger hPanel VNC as emergency console).
- [ ] **Cloudflare Tunnel only:** Only `cloudflared` serves public ingress; zero public firewall ports open.
- [ ] `niththigal.com/inventory`, `api.niththigal.com/inventory`, `/settings`, `/api/system/tenant-db` return 404.
- [ ] `ADMIN_HOSTS` contains the tailnet hostname; `STOREFRONT_HOSTS` contains `niththigal.com,www.niththigal.com,api.niththigal.com`.
- [ ] `/etc/luminila/env` and `/etc/luminila/storefront.env` are `600`, owned by `root:luminila`.
- [ ] S-06 re-key applied and `--verify` exits 0.
- [ ] All required secrets set: `CUSTOMER_SESSION_SECRET`, `JWT_SECRET`,
      `CATALOG_SYNC_KEY`, `META_*`, `RAZORPAY_WEBHOOK_SECRET`,
      `POCKETBASE_SUPERUSER_*`, `WPPCONNECT_SECRET` (≥16 chars), `TENANT_REGISTRY_KEY`.
- [ ] **Cloudflare WAF Rate Limiting** (Security → WAF → Rate limiting rules):
      - `POST /api/storefront/auth/send-otp` & `/api/storefront/auth/verify-otp` (e.g. max 5 req / min per IP)
      - `POST /api/storefront/order` (e.g. max 10 req / min per IP to block spam orders & inventory holds)
- [ ] PocketBase and the sidecar are never published through Cloudflare.
- [ ] Nightly backups run (`RCLONE_DEST` off-VPS copy enabled) and a restore has been tested once.
- [ ] The audit-remediation requirements in
      `docs/DEPLOYMENT-REQUIRED-CONFIG-2026-11-18.md` are applied: the three new
      RBAC migrations ran on the PocketBase first start, `TRUST_PROXY_HEADERS=1`
      is set (both ingresses proxy), `SIDECAR_APP_URL` is set for unattended
      STOP registration, and `TENANT_REGISTRY_KEY` is present so the gateway
      secrets stored by `/api/settings/secrets` are encrypted at rest.

## 9. WhatsApp sidecar notes

- Runs as `luminila-whatsapp`, `127.0.0.1:21465`, protected by
  `WPPCONNECT_SECRET` (the sidecar refuses secrets shorter than 16 characters).
- The ERP page calls it from your browser, so the sidecar is exposed on the
  tailnet at `:8443` and `WPP_ALLOWED_ORIGINS` must include the ERP origin
  (`https://<machine>.<tailnet>.ts.net`).
- Pair the WhatsApp session once over the tailnet (scan the QR from the ERP);
  the session data lives on the VPS and must be included in backups.

## 10. Updating

```bash
cd /opt/luminila/app
sudo -u luminila git pull
set -a; . /etc/luminila/env; set +a
sudo -u luminila npm ci && sudo -u luminila npm run build:desktop
cd /opt/luminila/app/storefront
set -a; . /etc/luminila/storefront.env; set +a
sudo -u luminila npm ci && sudo -u luminila BUILD_STANDALONE=true npm run build
sudo -u luminila cp -r .next/static .next/standalone/.next/static
sudo -u luminila cp -r public .next/standalone/public
sudo systemctl restart luminila-next luminila-storefront luminila-pocketbase luminila-whatsapp
```

Migrations in `pb_migrations/` are applied automatically on the PocketBase
restart; take a backup before pulling if a migration is included.
