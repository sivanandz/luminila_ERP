# Private ingress with Tailscale

The ERP, PocketBase and the WhatsApp sidecar are reachable only from devices on
your tailnet. Nothing is published to public DNS.

## On the VPS

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up          # sign in; note the machine name, e.g. luminila-vps
```

### Tailnet HTTPS (MagicDNS + certificates)

```bash
# ERP UI (Next server)
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000

# PocketBase REST + realtime (used by the ERP browser bundle)
sudo tailscale serve --bg --https=10000 http://127.0.0.1:8090

# WPPConnect sidecar (used by the ERP WhatsApp screens)
sudo tailscale serve --bg --https=8443 http://127.0.0.1:21465

sudo tailscale serve status
```

Tailscale's HTTPS proxy accepts 443, 8443 and 10000, which is exactly the split
above. `tailscale serve` issues certificates for the machine's
`<machine>.<tailnet>.ts.net` name automatically.

The resulting URLs (put them in `/etc/luminila/env` **before building**):

| Purpose | URL |
|---|---|
| ERP UI | `https://<machine>.<tailnet>.ts.net/` |
| PocketBase | `https://<machine>.<tailnet>.ts.net:10000` |
| WhatsApp sidecar | `https://<machine>.<tailnet>.ts.net:8443` |

`ADMIN_HOSTS` must contain `<machine>.<tailnet>.ts.net`.

## On your laptop/phone

1. Install Tailscale and sign in to the same tailnet.
2. Open `https://<machine>.<tailnet>.ts.net/` — the ERP login.
3. Nothing here resolves from the public internet; the public side only knows
   `shop.<domain>` through Cloudflare.

## Firewall

```bash
sudo ufw default deny incoming
sudo ufw allow in on tailscale0
sudo ufw allow 22/tcp        # or restrict to tailnet only:
# sudo ufw delete allow 22/tcp
# sudo ufw allow in on tailscale0 to any port 22 proto tcp
sudo ufw enable
```

Ports 3000, 8090, 8092-8199 and 21465 must not be exposed publicly. They are
bound to `127.0.0.1` by the systemd units, so even a firewall mistake does not
publish them.

## Notes

- The ERP browser bundle talks to PocketBase directly; that is why PocketBase is
  on the tailnet at `:10000`. `NEXT_PUBLIC_POCKETBASE_URL` must be set to that
  URL at build time.
- The WhatsApp sidecar checks the browser Origin; `WPP_ALLOWED_ORIGINS` must be
  `https://<machine>.<tailnet>.ts.net` (no port, since the ERP page is served at
  443).
- If you later want the ERP reachable without Tailscale, do not publish it
  directly — put Cloudflare Access in front of a second tunnel hostname and
  leave this profile's defaults alone.
