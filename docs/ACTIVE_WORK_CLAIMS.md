# Active Work Claims — 2026-11-02

Two sessions are editing this working tree. **Read this file immediately before editing any file below.** If a file is claimed by another owner, do not edit it — append a handoff note instead.

Protocol:
1. Owner claims files/IDs below before starting.
2. Never overwrite another owner's file wholesale; make surgical edits.
3. Commit/merge frequently. If a claimed file changes underneath you, re-read it before re-applying.
4. This file is owned by the **audit-fix** session. Workers append their findings to `docs/_agent_reports/<name>.md`, not here.

## Claims

| Owner | Audit IDs | Files (exclusive write scope) | Status |
| :-- | :-- | :-- | :-- |
| **audit-fix (ZCode)** | A-07, A-17, A-18, A-21; POS-08…POS-24; ORD-07…ORD-24; SF-14, SF-16, SF-18…SF-25; CRM-06, CRM-09, CRM-10, CRM-13…CRM-22 | `src/lib/pos-sales.ts`, `src/lib/invoice.ts`, `src/lib/sequence-generator.ts`, `src/lib/invoice-math.ts`, `src/lib/orders.ts`, `src/lib/channel-orders.ts`, `src/lib/returns.ts`, `src/lib/challan.ts`, `src/lib/shipments.ts`, `src/lib/storefront.ts`, `src/lib/storefront-tenant.ts`, `src/app/api/storefront/order/route.ts`, `src/app/api/storefront/content/route.ts`, `src/lib/razorpay*.ts`, `src/lib/payment-reconciliation.ts`, `src/lib/meta-catalog-batch.ts`, `src/lib/catalog-sync.ts`, `src/lib/webhook-dedupe.ts`, `src/app/api/catalog/feed/route.ts`, `src/app/api/storefront/catalog/route.ts`, `src/app/pos/page.tsx`, `src/app/orders/**`, `src/app/challan/**`, `src/app/returns/**`, `src/app/invoices/**`, `src/components/orders/**`, `src/components/shipping/**`, `src/components/pos/**`, `src/components/invoices/**`, `src/lib/customers.ts`, `src/lib/customer-lookup.ts`, `src/lib/crm-rfm.ts`, `src/lib/crm-lifecycle-triggers.ts`, `src/lib/consent-ledger.ts`, `src/lib/campaign-attribution.ts`, `src/app/customers/**`, `src/lib/discounts.ts`, `src/lib/loyalty.ts`, `src/lib/register.ts`, `src/lib/offline-queue.ts`, `src/lib/mobile-printer.ts`, `src/lib/gstin.ts`, `src/app/users/page.tsx`, `src/app/setup/page.tsx`, `src/app/login/page.tsx`, `src/lib/setup.ts`, `src/lib/tenant-db-manager.ts` | in progress |
| **inv-agent** | INV-07…INV-25 | `src/lib/discrepancies.ts`, `manufacturing-jobs.ts`, `manufacturing-engine.ts`, `multi-location.ts`, `barcode-generator.ts`, `excel-import.ts`, `image-matcher.ts`, `sku-generator.ts`, `csv.ts`, `valuation.ts`, `products.ts`, `vendors.ts`, `categories.ts`, `attributes.ts`, `purchase.ts`, `src/components/inventory/**`, `src/components/vendor/VendorForm.tsx`, `src/app/labels/page.tsx`, `src/app/purchase/create/page.tsx`, `src/app/vendors/detail/page.tsx`, `src/app/api/catalog/batch/route.ts`, `src/app/api/catalog/image/route.ts` | in progress |
| **wa-agent** | WA-01…WA-24 | `src/lib/whatsapp-flash-drops.ts`, `whatsapp-broadcast.ts`, `whatsapp-crm.ts`, `whatsapp-message-store.ts`, `chat-inventory.ts`, `whatsapp-order-ingestion.ts`, `chat-sales.ts`, `whatsapp-catalog.ts`, `whatsapp-event-sync.ts`, `whatsapp-binding.ts`, `whatsapp.ts`, `mobile-whatsapp.ts`, `src/app/whatsapp/page.tsx`, `src/components/whatsapp/**`, `src/app/checkout/whatsapp/page.tsx`, **new** `src/app/api/storefront/flash-drop/route.ts`, **new** migration `1793001100_flash_drops.js` | in progress |
| **fin-agent** | FIN-01, FIN-04, FIN-06…FIN-12, FIN-14…FIN-24 (skip FIN-13 = `analytics.ts`) | `src/lib/banking.ts`, `expenses.ts`, `gstr1-engine.ts`, `gstr1-report.ts`, `cheque-register.ts`, `cheque-engine.ts`, `cross-border-engine.ts`, `gst.ts`, `src/app/cheques/page.tsx`, `src/app/expenses/**`, `src/app/banking/transactions/page.tsx`, `src/app/reports/gst/page.tsx`, `src/app/reports/export/page.tsx`, `src/app/reports/page.tsx` | in progress |
| **ai-agent** | AI-SYS-01, AI-SYS-02, AI-SYS-06…AI-SYS-24 | `src/lib/backup.ts`, `activity.ts`, `settings.ts`, `eway-bill-settings.ts`, `src/app/backup/page.tsx`, `src/app/settings/page.tsx`, `src/components/settings/**`, `src/lib/ai/providers.ts`, `ai/events.ts`, `ai/http.ts`, `src/app/api/ai/chat/route.ts`, `src/hooks/use-ai-chat.ts`, `src/components/layout/MobileDrawer.tsx`, `src/components/layout/Header.tsx`, `src-tauri/src/lib.rs` | in progress |
| **analytics-agent (external)** | analytics deep-insights build | `src/lib/analytics.ts`, `src/lib/reports.ts`, `src/lib/analytics-v2/**`, `src/app/analytics/**`, `src/app/api/analytics/**`, `src/components/analytics/**`, `src/app/page.tsx`, `src/components/dashboard/KPICards.tsx`, `src/types/database.ts`, `src/lib/item-cost.ts`, analytics scripts, `docs/plans/**`, packing files | do not touch |

## Shared / contested files

These are being edited by the analytics build and must not be edited by audit workers:

- `src/lib/pos-sales.ts`, `src/lib/orders.ts`, `src/app/api/storefront/order/route.ts` — analytics Step 0.2 adds `unit_cost` snapshots here. **audit-fix owns them for this pass**; re-read before editing and keep changes additive.
- `src/lib/reports.ts`, `src/lib/analytics.ts`, `src/app/page.tsx`, `src/components/dashboard/KPICards.tsx`, `src/types/database.ts`, every `analytics-v2`/`analytics` path.

## Handoff notes

Append below with owner + timestamp. Do not rewrite the table above.

- **2026-11-02 — audit-fix:** first pass committed as `4191728`. Analytics build committed by its owner as `700ec73`; `reports.ts`/`analytics.ts` are no longer contested and the remaining FIN-07/08/14/21/23 items were closed there.
- **2026-11-02 — inv-agent:** INV-07…INV-25 complete (report: `docs/_agent_reports/inv-agent.md`); released its file scope.
- **2026-11-02 — fin-agent:** FIN-01/04/06/08/09/11/16–24 + POS-15/16/23 + ORD-24 complete; FIN-07/13 were released to audit-fix when the analytics commit landed (report: `docs/_agent_reports/fin-agent.md`).
- **2026-11-02 — ai-agent:** AI-SYS-01/02/06–17/19–24 complete, AI-SYS-18 partial (secret encryption needs a server endpoint) (report: `docs/_agent_reports/ai-agent.md`); released its file scope.
- **2026-11-02 — audit-fix:** second pass covers A-07/17/18/21, POS-08…POS-24, ORD-07…ORD-24, SF-14/16/18/19/20/23/24/25, CRM-06/09/10/11/13/14/15/19–22 and FIN-07/08/14/21/23.
- **2026-11-02 — wa-agent:** still in progress on WA-01…WA-24 + CRM-10 audience filter + optional CRM-18 custom recipients. Its files remain claimed.
