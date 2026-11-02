# WA agent report — WhatsApp audit findings (WA-01…WA-24)

Date: 2026-11-02
Scope owner: **wa-agent** (see `docs/ACTIVE_WORK_CLAIMS.md`)
Verification: `npx tsc --noEmit --incremental false` → **exit 0, no diagnostics** (full, cache-free run).

## Findings

| ID | Status | Files | One-line evidence |
| :-- | :-- | :-- | :-- |
| WA-01 | fixed | `pocketbase/pb_migrations/1793001100_flash_drops.js`, `src/lib/whatsapp-flash-drops.ts`, `src/app/checkout/whatsapp/page.tsx` | `flash_drops` + `flash_drop_reservations` collections with hardened tenant rules; the lib reads/writes PocketBase and the public page reads via the server route. `localStorage` is no longer a store. |
| WA-02 | fixed | `src/app/api/storefront/flash-drop/route.ts`, `src/app/checkout/whatsapp/page.tsx` | Public route `reserve` / `pay-intent` / `order`: price from the drop snapshot, `sales_orders` + `sales_order_items` stamped `account_email`, `applyChannelStock(..., { channel: 'storefront', referenceId: order.id })`, payment verified with the gateway before confirmation. |
| WA-03 | fixed | `src/lib/whatsapp-broadcast.ts` | `resolveAudienceDetailed`, `loadLoyaltyTiers` (per-tenant cache), `sentTodayCount`, `queueCampaign`, `processBroadcastQueue`, `getCampaignQueueSnapshot` all use `withTenantFilter`; queued rows carry `account_email`. |
| WA-04 | fixed | `src/lib/whatsapp-crm.ts`, `src/lib/whatsapp-message-store.ts` | `withTenantFilter` / `tenantScopeEmail` / `recordBelongsToTenant` added and applied to chats, messages, customers, vendors, opt-outs, label queue; all writes stamp `account_email`. |
| WA-05 | fixed | `src/lib/chat-inventory.ts` | Product/variant/image-hash queries tenant-scoped; creates stamp `account_email`; base64/data-URI media goes to `image_data`, HTTP URLs to `image_url`. |
| WA-06 | fixed | `src/lib/whatsapp-order-ingestion.ts`, `src/lib/chat-sales.ts` | SKU lookup is `is_active = true && account_email = tenant`; `createSaleFromChat` rejects foreign/inactive products, variant queries add `product.is_active = true && account_email`, and `sales`/`sale_items` mirror rows carry `account_email`. |
| WA-07 | fixed | `src/lib/whatsapp-crm.ts`, `src/app/whatsapp/page.tsx` | `categories`/`product_variants`/`stock_movements` stamped; both Create-Product handlers now drop `mmg.whatsapp.net`/encrypted URLs and leave the image empty when `downloadMedia` fails. |
| WA-08 | fixed | `src/app/whatsapp/page.tsx`, `src/lib/chat-sales.ts`, `src/lib/whatsapp-catalog.ts`, `src/lib/whatsapp-event-sync.ts` | Every sellable `product_variants` query now carries `product.is_active = true` (concierge variant picker, chat sale, publishable catalog, stealth sync + reconcile). |
| WA-09 | fixed | `src/app/whatsapp/page.tsx` | `handleConnect` calls `whatsappManager.setSessionId(tenantSessionId)`; the shared `"luminila"` literal is gone from the connect/reset path. |
| WA-10 | fixed | `src/components/whatsapp/WhatsAppDrawer.tsx`, `src/components/whatsapp/WhatsAppCatalogEditorModal.tsx` | Drawer selects `getTenantWhatsAppSessionId(user.id/email)` on mount; editor defaults to the same instead of `"luminila"`. |
| WA-11 | fixed | `src/app/whatsapp/page.tsx` | Invoice and order-confirmation copy is pre-filled into the composer (`setReplyText`) with a review toast; `/tracking` now reads `shipments` via `listShipmentsForOrder` and the fake `BD102938475` AWB is removed. |
| WA-12 | fixed | `src/lib/chat-sales.ts` | Creation no longer calls `applyPurchaseAggregates`/`earnPoints`; settlement (`settleCapturedOrder`) owns CRM aggregates and loyalty on capture. |
| WA-13 | fixed | `src/lib/whatsapp.ts` | Sidecar secret is resolved per call (`readSidecarSecret`), and the Bearer header is attached only when the URL targets `getWhatsAppUrl()` instead of any `"/api/"` substring. |
| WA-14 | fixed | `src/lib/whatsapp-binding.ts` | `getAdminUsers` filters `users`/`user_roles` by tenant; the hardcoded `admin@luminila.local` fallback is removed (empty list returned instead). |
| WA-15 | fixed | `src/lib/whatsapp-flash-drops.ts` | Broadcast uses `whatsappManager.sendImage(jid, item.imageUrl, message, …)`; `sendFile` no longer receives an HTTP URL. |
| WA-16 | partial | `src/lib/whatsapp.ts`, `src/lib/whatsapp-event-sync.ts`, `src/app/whatsapp/page.tsx` | `WA_SIDECAR_TOKEN`, `WA_CUSTOM_URL`, `whatsapp_catalog_auto_sync`, `wa_read_timestamps`, `wa_badge_layout` are tenant-suffixed. **Residual:** `pos:cart-updated` is still shared because its subscriber lives in `src/app/pos/page.tsx` (out of scope). |
| WA-17 | fixed | `src/app/whatsapp/page.tsx` | Catalog Sync sidebar binds to `getStealthSyncStatus()` + `getPublishableProducts()` (real synced/total, queue, last sync, error state); `"45"`/`"0"` removed. |
| WA-18 | fixed | `src/components/whatsapp/FlashDropModal.tsx` | Reads `expand.product_variants_via_product` (legacy key kept as fallback); refuses to add a product with no variant instead of falling back to `prod.id`; price includes `price_adjustment`. |
| WA-19 | fixed | `src/lib/whatsapp-crm.ts` | `sendProductCard` uses `image_data \|\| image_url`, `getChannelPrice(product, 'whatsapp', price_adjustment)`, and refuses inactive/foreign products. |
| WA-20 | blocked | — | No client caller remains: `findstr catalog/feed src` only matches `src/app/api/catalog/feed/route.ts` itself (owned by audit-fix). Signed-token support requires editing that route, outside this scope. |
| WA-21 | fixed | — | `createPaymentOrder` does not exist in the current tree (`findstr createPaymentOrder src` → no matches); the sales-order creation it described was already consolidated into `chat-sales.ts`/`whatsapp-event-sync` rewrite. |
| WA-22 | fixed | `src/components/whatsapp/ProductBroadcastModal.tsx` | Product picker applies an in-memory `account_email` tenant guard in addition to the lib's tenant clause. |
| WA-23 | fixed | — | `RazorpayPaymentModal.tsx` contains no `sales_orders` query (`findstr sales_orders src/components/whatsapp` → no matches); the cited fetch is gone. |
| WA-24 | fixed | — | `openWhatsAppRequirementAlert` does not exist in the current tree; `mobile-whatsapp.ts` only exposes `sendReceipt`/`openWhatsAppIntent`, which no page calls. |
| CRM-10 | fixed | `src/lib/whatsapp-broadcast.ts` | `resolveAudienceDetailed` adds `opt_in_marketing != false` to every PB segment filter and to the in-memory fallback; the member loop also skips `opt_in_marketing === false`. |
| CRM-18 | fixed (optional) | `src/lib/whatsapp-broadcast.ts` | `queueCampaign` accepts `customRecipients?: {id, phone, name?}[]`; ids are re-read under the tenant scope, then the same phone/STOP checks apply. Segment behaviour unchanged. |

## Verification notes

- `npx tsc --noEmit --incremental false` — clean (exit 0). No errors in files owned by other agents.
- `node --check pocketbase/pb_migrations/1793001100_flash_drops.js` — syntax OK.
- **Migration executed, not just parsed:** copied `pocketbase/pb_data` to a throwaway `%TEMP%` directory, copied the binary, and ran `pocketbase migrate up --automigrate=false --migrationsDir <temp>` with only `1793001100_flash_drops.js`. Result: `Applied 1793001100_flash_drops.js` — both collections, all fields, tenant rules and all five indexes (including the partial unique active-hold index) were created. `migrate down 1` then reverted both collections cleanly. Construction order is the A-05-safe one: create empty collection → `app.save` → `fields.add(...)` → `app.save` → `unmarshal(rules/indexes)` → `app.save`, with explicit `created`/`updated` autodate fields.
- Flash-drop flow: `GET` (public projection + availability) → `POST reserve` (10-min hold, idempotent per phone/variant) → `POST pay-intent` (order + Razorpay order) → Razorpay checkout → `POST order` (gateway capture + amount check → stock deduction → settlement → hold completed).
- Tenant resolution on the public route is `createTenantClient(accountEmail)` per request; `ensureServerAuth` is not used.
- Fail-closed: no gateway credentials → 503 at `pay-intent`; no `paymentId` → 402 at `order`; uncaptured/mismatched payment → 409; stock shortfall after capture records the payment for manual reconciliation instead of confirming an unfulfillable order.

## Residuals / risks

1. **WA-16 (`pos:cart-updated`)** — the writer in `whatsapp-crm.ts` still uses the shared key. Suffixing it alone would break the POS terminal's subscriber in `src/app/pos/page.tsx` (not in this scope); both ends must change together.
2. **WA-20** — a signed feed token must be added to `src/app/api/catalog/feed/route.ts`, which is owned by audit-fix. There is currently no UI caller to switch to authenticated `fetch`/Blob download.
3. **Public links in multi-tenant mode** — new broadcasts include `account_email`; old links without it only resolve in single-account mode (defaults to `SINGLE_ACCOUNT_EMAIL`) and otherwise return 400 by design.
4. **Payment gateway configuration** — the flash-drop route uses the server-side `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`. A store configured only in browser storage cannot collect payment through the public route (503, fail closed). No COD path was added.
5. **Hold quantity** — reservations are one unit per hold (`quantity` field min/max 1), matching the existing 10-minute single-piece design; multi-quantity drops would need a schema change.
6. **CRM-18 consent** — custom cohorts check `whatsapp_opt_out` and the STOP registry, but do not re-check `opt_in_marketing`; the caller selects the cohort. Segment-based campaigns do enforce opt-in.
7. **CRM-10 backfill** — PocketBase stores an unset bool as `false`, so customers whose `opt_in_marketing` was never set are excluded from marketing audiences until the consent ledger backfills the flag. This is the consent-safe reading, but it can shrink an existing audience.
8. **WA-08 catalog editor** — `getWhatsAppCatalogInventory` still lists variants of inactive products by design (the editor must be able to unlink/hide them); only sellable/publishable paths carry the active guard.
