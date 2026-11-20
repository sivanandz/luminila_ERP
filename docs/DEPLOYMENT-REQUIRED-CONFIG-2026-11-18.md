# Required production configuration — audit remediation (Nov 2026)

Applies after deploying the 2026-11 audit fixes. Nothing here is needed for a
local dev run; all of it matters in production.

## PocketBase migrations (run automatically on next PocketBase start)

- `1793003401_products_gst_exempt.js` — explicit 0% GST (exempt) flag on products.
- `1793003402_store_settings_rbac.js` — only the owner/Admin role can write or
  delete the canonical `store_config` row (gateway/tax/bank settings).
- `1793003403_customers_rbac.js` + `1793003404_customers_rbac_repair.js` —
  `customers` create/update require a write-capable role at the data plane
  (Admin / Manager / Staff by role name, or the tenant owner), not just in the
  React UI. Custom roles must use one of those names to write customers.
  Verified live: a Viewer role is refused, Staff can create/update.
  NOTE: PocketBase 0.25 surfaces a failed `@collection` join as HTTP 400
  ("Failed to create record") instead of 403 — the write is still refused.

Verify after the first restart: `customers.updateRule` and
`store_settings.updateRule` contain the `@collection.user_roles:…` predicates
(customers via a name-based writer check, store_settings via the Admin check).

## Environment variables

| Variable | Required when | Why |
|---|---|---|
| `TRUST_PROXY_HEADERS=1` (or `TRUSTED_PROXY_HOPS>0`) | Behind Cloudflare or any reverse proxy | Rate-limit client keys otherwise ignore forwarded headers (T-06). Do NOT set it when the app is directly reachable — the headers are caller-controlled. |
| `TENANT_REGISTRY_KEY` (64 hex chars = 32 bytes) | Production | Encrypts the gateway secrets stored by `/api/settings/secrets` at rest (H-23). Without it they are stored readable. |
| `SIDECAR_APP_URL` (e.g. `http://127.0.0.1:3000`) | Always with the WhatsApp sidecar | Lets the sidecar register STOP replies with the ERP when no operator page is open (H-27). |
| `SIDECAR_TENANT_EMAIL` | Multi-account mode only | Names the tenant whose opt-out registry the sidecar reports into. |

## Behaviour changes operators should know

- Storefront catalog 404s for tenants not in `STOREFRONT_TENANTS` /
  `STOREFRONT_TENANT_EMAILS` (multi-account mode only).
- Gateway secrets are no longer in the settings row the browser loads; the
  Settings page fetches them from `/api/settings/secrets` (settings:update
  capability required).
- Loyalty accrual follows the "points per ₹1" label literally — 100× the old
  formula. Confirm the configured rate before the next campaign.
- Manual GST invoices derive the rate from the printed HSN (7117 imitation
  jewellery = 18%, 7113 gold/silver = 3%); exempt products use the explicit
  0% GST flag.
- Printed order invoices no longer repeat the line discount as a header
  discount (the total is unchanged); the discount is already netted into lines.
- A cheque can be cleared even when the ledger balance is below the cheque
  amount — the shortfall is recorded as a warning on the ledger row instead of
  blocking the operation.
