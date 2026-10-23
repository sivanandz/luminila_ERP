# Luminila hosting profile — public storefront, private ERP

This kit runs the app on one VPS with a deliberate split:

- **Public:** only `shop.<domain>` (the storefront + the public storefront APIs it calls).
- **Private:** the ERP UI, PocketBase, and the WhatsApp sidecar are reachable **only over Tailscale** — no public DNS, no exposed ports.

```
Cloudflare (public TLS, WAF)
   │ cloudflared tunnel (outbound only, no inbound ports)
   ▼
VPS
 ├─ Next standalone server      127.0.0.1:3000   shop.<domain> public; ERP only via tailnet
 ├─ PocketBase (primary)        127.0.0.1:8090   tailnet only (https :10000)
 ├─ tenant PocketBase processes 127.0.0.1:8092+  loopback only
 └─ WPPConnect sidecar          127.0.0.1:21465  tailnet only (https :8443)

Tailscale (private TLS)
   │
   ▼
owner's laptop/phone ──► https://<machine>.<tailnet>.ts.net/       (ERP)
                         https://<machine>.<tailnet>.ts.net:10000  (PocketBase)
                         https://<machine>.<tailnet>.ts.net:8443   (WhatsApp sidecar)
```

The app enforces the split itself through `src/proxy.ts` + `src/lib/host-guard.ts`:
the storefront host can serve only `/checkout`, `/tracking`, `/api/storefront/*`,
`/api/tracking/*` and static assets; everything else returns 404. Unknown hosts
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
sudo -u luminila curl -L -o /opt/luminila/pocketbase/pocketbase \
  https://github.com/pocketbase/pocketbase/releases/download/v0.25.0/pocketbase_0.25.0_linux_amd64.zip
# (unzip; or install the unzipped binary directly)
sudo -u luminila cp -r pocketbase/pb_migrations /opt/luminila/pocketbase/pb_migrations

# environment
sudo install -m 600 deploy/env.example /etc/luminila/env
sudo nano /etc/luminila/env        # fill in secrets and hostnames
```

**Build with the public env values inlined** — `NEXT_PUBLIC_*` is baked into the
browser bundle:

```bash
set -a; . /etc/luminila/env; set +a
sudo -u luminila npm ci
sudo -u luminila npm run build:desktop    # emits .next/standalone -> server-dist/
```

## 3. systemd services

```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now luminila-pocketbase luminila-next luminila-whatsapp
systemctl status luminila-pocketbase luminila-next luminila-whatsapp
```

PocketBase applies `pb_migrations` on start, so the database schema follows the
repository.

## 4. Public ingress — Cloudflare Tunnel (storefront only)

```bash
cloudflared tunnel login
cloudflared tunnel create luminila
cloudflared tunnel route dns luminila shop.<domain>
sudo cp deploy/cloudflared/config.yml /etc/cloudflared/config.yml   # edit tunnel id
sudo systemctl enable --now cloudflared
```

There is deliberately **no ingress hostname for the ERP** in this config. Verify
from outside the tailnet:

```bash
curl -I https://shop.<domain>/checkout/whatsapp   # 200 (or app redirect)
curl -I https://shop.<domain>/inventory           # 404 — guard working
curl -I https://shop.<domain>/api/system/tenant-db # 404
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

1. Open the ERP over Tailscale → `/setup` → provision the tenant.
2. Run the registry re-key **inside the deployed environment** (this is the step
   that cannot be done on a machine without tenants):

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

## 7. Backups

```bash
sudo cp deploy/backup/backup.sh /usr/local/bin/luminila-backup
sudo chmod 750 /usr/local/bin/luminila-backup
sudo cp deploy/backup/luminila-backup.cron /etc/cron.d/luminila-backup
```

The script uses SQLite's online `.backup` for the primary DB and every tenant DB,
then copies JSON/ZIP backups produced by the in-app `/backup` page. Copy
`/var/backups/luminila` off the VPS regularly — a backup on the same disk is not
a backup.

## 8. Security checklist

- [ ] Only `cloudflared` has a public ingress; no firewall ports open except SSH.
- [ ] SSH restricted to Tailscale (`ufw allow in on tailscale0`), not the internet.
- [ ] `shop.<domain>/inventory`, `/settings`, `/api/system/tenant-db` return 404.
- [ ] `ADMIN_HOSTS` contains the tailnet hostname; `STOREFRONT_HOSTS` the shop host.
- [ ] `/etc/luminila/env` is `600`, owned by root:luminila.
- [ ] S-06 re-key applied and `--verify` exits 0.
- [ ] All required secrets set: `CUSTOMER_SESSION_SECRET`, `JWT_SECRET`,
      `CATALOG_SYNC_KEY`, `META_*`, `RAZORPAY_WEBHOOK_SECRET`,
      `POCKETBASE_SUPERUSER_*`, `WPPCONNECT_SECRET` (≥16 chars), `TENANT_REGISTRY_KEY`.
- [ ] Cloudflare WAF rate limit on `/api/storefront/auth/send-otp`.
- [ ] PocketBase and the sidecar are never published through Cloudflare.
- [ ] Backups run daily and a restore has been tested once.

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
sudo systemctl restart luminila-next luminila-pocketbase luminila-whatsapp
```

Migrations in `pb_migrations/` are applied automatically on the PocketBase
restart; take a backup before pulling if a migration is included.
