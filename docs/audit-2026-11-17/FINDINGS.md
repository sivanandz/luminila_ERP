# Full feature audit — 2026-11-17

**Status: REPORT ONLY. No application code has been changed.**

## Baseline before the audit

| Check | Result |
|---|---|
| `npx tsc --noEmit --incremental false` | clean |
| `npx eslint` | clean |
| `npm test` (30 suites) | all pass; 2 suites skipped (no PocketBase on :8090) |

The green baseline is why this audit is read-driven: nothing here is visible to the type checker, the linter, or the existing unit suites.

## Scope and method

Nine read-only auditors, each given a disjoint cluster of `src/` plus its tests, working to the debug-like-expert rules: read the file, trace every caller, prove the claim from code, report only defects (no style, no refactors, no imagined features). Existing audit reports in the repo were explicitly distrusted as possibly stale; every finding below is traced from current source.

Coverage: ~389 files across all 29 route clusters and ~110 lib engines — POS, invoices, GST/GSTR-1, pricing, stock ledger, returns/QC, packing, bundles, multi-location, cycle count, purchases, vendors, manufacturing, banking, cheques, gateways, reconciliation, tenancy/auth/API, WhatsApp + CRM + storefront, orders/challan/logistics, reports/analytics, backup/import/export, offline/device, shared UI shell, and a cross-cutting swallowed-failure sweep.

Per-cluster detail (including "checked and clean" lists and test gaps):
`wave1-money.md`, `wave1-stock.md`, `wave1-payments.md`, `wave2-tenancy.md`, `wave2-whatsapp.md`, `wave2-orders-reports.md`, `wave3-files.md`, `wave3-device.md`, `wave3-ui-shell.md`, `wave3-swallowed.md`.

## Totals

| Severity | Count |
|---|---|
| Critical | **7** |
| High | **52** |
| Medium | **70** |
| Low | **33** |
| **Total** | **162** |

Duplicates merged: W-06 = U-06 (catalog price ÷1000), M-04 + P-03 (notes raised in the Invoices module). Both counted once below.

## Verified by me directly (not just agent-reported)

Every Critical was re-read at the cited line before it was accepted, plus the key callers:

- **M-01** — `invoice-math.ts:241` (`explicitRate >= 0`) confirmed; `products.gst_rate` is never written by any product writer.
- **S-01** — `products.ts:483` (`product.is_active = true`) confirmed; `inventory/page.tsx:623,802-808` confirmed.
- **P-01** — `payment-reconciliation.ts:283` settles on `status === 'paid'` with no amount comparison; `amountMatchesRupees` exists only at `razorpay-webhook-handler.ts:502` (webhook path).
- **W-01** — `whatsapp.ts:46-52` returns `""` when `typeof window === "undefined"`; `layout.tsx:38` injects the token only in development.
- **O-01** — `orders.ts:598` `grandTotal = subtotal + totalTax + shippingCharges` while `:619,627` write the order discount to the header.
- **B-01 / B-02** — `excel-import.ts:798` creates unconditionally; `:126-221` ships 5 fully-populated sample rows that the parser does not filter.

---

# Critical (7)

### C-01 · Every POS/manual invoice can be billed at 0% GST · `src/lib/invoice-math.ts:241`
`resolveLineGstRate` treats an explicit `0` as a valid rate, so it beats the jewelry fallback. `products.gst_rate` is `NUMERIC DEFAULT 0`, no product writer ever sets it, and `sale_items` has no `gst_rate` column (PocketBase silently drops the write). Result: `splitInclusiveLine(gross, 0)` → `taxable = gross, tax = 0`. A ₹700 line is stored ₹700 + ₹0 instead of ₹679.61 + ₹10.19 + ₹10.20, and GSTR-1 files `rt: 0`.
**Fix:** treat a missing/zero product rate as "not configured" (fall through to the fallback) or write a real rate at product creation.

### C-02 · Editing a draft/archived product wipes its stock, and the tray audit re-adds it as surplus · `src/lib/products.ts:483`, `src/app/inventory/page.tsx:623,802-808`
The inventory list loads all products but the stock map only covers `is_active = true`, so a draft shows stock 0. Editing it and saving writes `parsedStock` absolutely (`liveVariantStock + (0 - liveVariantStock)`), destroying the real stock and logging a negative movement. The same zero feeds the tray audit, where real pieces count as surplus and get added again (5 → 10).
**Fix:** drop `product.is_active = true` from `getVariantStockSummary`.

### C-03 · Payment-link reconciler settles a sales order for less than its total · `src/lib/payment-reconciliation.ts:283`
Any `paid` link settles the linked order via `settleCapturedOrder` — PAID, stock deducted, invoice raised — with no comparison to `sales_orders.total`. An editable ₹5,000 advance link on a ₹50,000 chat order marks the whole order paid; ₹45,000 is never collected. The webhook path does check (`amountMatchesRupees`).
**Fix:** require `link.amount >= order.total` before settling, or enforce the expected amount inside `settleCapturedOrder`.

### C-04 · Storefront OTP sign-in always fails: server-side WhatsApp sends cannot authenticate to the sidecar · `src/lib/whatsapp.ts:46`
`readSidecarSecret()` returns `""` on the server, so every server-side `sendMessage` goes out without `Authorization` and the sidecar answers 401. `send-otp` then returns 502 and production has no dev fallback. Since `verify-otp` is the only way to mint the customer token and `/api/storefront/order` refuses submissions without it, new storefront checkout is dead. Also affects paid-order invoice notifications and shipping notifications.
**Fix:** return `process.env.WPPCONNECT_SECRET` (trimmed, length-checked) on the server.

### C-05 · Storefront coupon discount is dropped when the invoice is generated · `src/lib/orders.ts:520,598`
Storefront orders put the coupon on the header only (`discount_total`) with no per-line `discount_amount`. `generateInvoiceFromOrder` builds lines from `unit_price` (post-discount total never subtracted) and computes `grandTotal = subtotal + tax + shipping` without the discount. A ₹1,250 paid checkout produces a ₹1,299 invoice with overstated taxable value and GST — on every couponed web order.
**Fix:** allocate the header discount across lines before mapping, as `invoice-math` already does for POS.

### C-06 · Bulk inventory import has no dedupe: re-upload duplicates products and double-counts stock · `src/lib/excel-import.ts:798`
Every valid row creates a product, a variant, and a restock movement with no lookup by SKU, no file hash, no import marker. Importing the same sheet twice gives two products with the same SKU and +N stock twice, reported as success.
**Fix:** look up by SKU (tenant-scoped) and update/refuse instead of creating.

### C-07 · The official import template ships 5 sample rows that import as real products and stock · `src/lib/excel-import.ts:126-221`
Five fully-populated rows (₹185,000/stock 3, ₹34,500/8, ₹95,000/5, ₹12,500/12, ₹128,000/4) are added to the template, the instructions never say to delete them, and the parser has no filter. Download → append → upload creates five phantom products, five stock movements, and two auto-SKUs.
**Fix:** emit the samples on a separate "Example" sheet the parser ignores, or tag and skip them.

---

# High (52)

## Money, tax and pricing

| ID | Finding | Location |
|---|---|---|
| H-01 | Catalog HSN 7117 maps to 18%, but every invoice path uses the 3% default; `getGSTRateForHSN` has no callers. ₹12,341.62 output tax understated per ₹1 lakh tax-inclusive. | `src/lib/gst.ts:316` |
| H-02 | Loyalty redemption is not re-capped when the bill changes. Sale commits, `redeemPoints` then throws on the `max_redemption_percent` cap, the catch downgrades it to a warning → points never debited, bill already saved. | `src/app/pos/page.tsx:1627` |
| H-03 | Notes raised in Invoices → New are stored as positive `INV/` sales invoices of type `credit_note`/`debit_note`. GSTR-1 loads only `regular` from `invoices` and reads real notes from `credit_notes`, so these neither reduce output tax nor appear in 9B, while the register counts them as revenue. (merges M-04 + P-03) | `src/app/invoices/create/page.tsx:620`, `src/lib/gstr1-report.ts:196` |

## Stock and returns

| ID | Finding | Location |
|---|---|---|
| H-04 | Returning a bundle restocks none of its components: the sale deducted components, the credit note's `wasStockDeducted` checks the bundle variant, finds nothing, and skips the restock — even Grade A. 3 units stay lost per returned set. | `src/lib/returns.ts:374-400`, `channel-stock.ts:212-233` |
| H-05 | Cancel-after-return restocks twice: the cancel restores every `sale` movement without seeing the return's `+1` (its reversal marker is keyed to the credit note, not the order). | `src/lib/orders.ts:914-919`, `channel-stock.ts:529-541` |
| H-06 | Credit-note approval half-applies: a failure on line 2 reverts the note to `pending` but does not undo line 1's restock; the retry restocks line 1 again. | `src/lib/returns.ts:549-637` |
| H-07 | Receiving a transfer double-adds destination stock when the manifest repeats a SKU: quantities collapse into a map (last write wins) but the map is applied once per manifest line (+3 +3 = +6). | `src/lib/multi-location.ts:649-690` |
| H-08 | Editing a single-variant product overwrites stock with the value captured when the dialog opened — a sale between open and save is silently undone, a restock silently erased. The variant matrix already does this correctly. | `src/app/inventory/page.tsx:996,800-818` |
| H-09 | Tray cycle count adjusts an arbitrary "primary" variant (first unsorted variant) and swallows per-item failures while returning `success: true` — shortages are never recorded and the toast says "audit completed". | `src/lib/cycle-count.ts:174-216,256-262` |
| H-10 | A product-level label on a multi-variant product resolves to the alphabetically first variant, so the packing ambiguity guard is unreachable and POS sells the wrong size. | `src/lib/products.ts:644-649`, `packing.ts:534-556` |

## Payments, settlement and filing

| ID | Finding | Location |
|---|---|---|
| H-11 | Gateway settlement leaves the generated invoice `pending` with ₹0 paid, so the receivable is double-counted and the invoice screen invites a second collection of money already captured. | `src/lib/razorpay-webhook-handler.ts:251` |
| H-12 | `payment.captured` can never match gateway-checkout payments: the handler reads `payment.notes.order_id`, but the id is written on the Razorpay **Order**. Captured money is acknowledged with HTTP 200 and dropped; Razorpay will not retry. | `src/lib/razorpay-webhook-handler.ts:430` (caller `razorpay-orders.ts:74`) |
| H-13 | Paid settlement returns success when no invoice was created at all (the failure is logged and swallowed), so the webhook returns 200 and Razorpay stops redelivering. | `src/lib/razorpay-webhook-handler.ts:250` |
| H-14 | "Invoice notification sent" marker is written even when the send failed, permanently suppressing retries — and with C-04 the send is failing. | `src/lib/razorpay-webhook-handler.ts:304` |
| H-15 | Exchange completes and returns success while the invoice update is swallowed, leaving a paid ₹25,000 exchange invoice `pending` with ₹0 paid. | `src/lib/returns.ts:1353` |

## Orders, dispatch, reports

| ID | Finding | Location |
|---|---|---|
| H-16 | Any non-cancelled order can be dispatched again — a `delivered` order regresses to `shipped`, a shipped order gets a second AWB, and one parcel marks a multi-parcel order delivered. | `src/lib/shipments.ts:149` |
| H-17 | Marking a leftover shipment delivered resurrects a cancelled order (no parent-state guard; cancellation never cancels shipment rows). | `src/lib/shipments.ts:235` |
| H-18 | A failed shipment read (`catch(() => [])`) lets a dispatched order be cancelled; only 404 should degrade. | `src/lib/orders.ts:889` |
| H-19 | Cancelling leaves a linked invoice alive unless the order status is exactly `invoiced` — a state the code itself can produce by swallowing the status update. | `src/lib/orders.ts:977` |
| H-20 | Profitability and turnover subtract line discounts twice for B2B orders (`discount_total` = sum of line discounts, already netted into net revenue). Headline margin understated by the discount total of every discounted order. | `src/lib/analytics-v2/discount-allocation.ts:40` |
| H-21 | POS sales recorded under the WhatsApp channel vanish from all analytics: the exclusion filter catches `channel_order_id != ""`, which POS always sets. | `src/lib/analytics-v2/load.ts:130` |
| H-22 | Report periods filter in UTC while dates are displayed/filed in local time: a POS invoice at 20:00Z on 30 Apr appears in the April report printed as 01/05, and GSTR-1 files it in May (or omits it). B2B invoices created 00:00–05:29 IST get the previous UTC day. | `src/lib/reports.ts:213` |

## Tenancy, secrets and auth boundaries

| ID | Finding | Location |
|---|---|---|
| H-23 | Gateway secrets are returned to every staff browser by `getStoreSettings()` (only the localStorage copy is redacted); any tenant member can also read the `store_settings` row directly. POS holds the whole object in state. | `src/lib/settings.ts:126` |
| H-24 | `store_settings` has no role predicate: any tenant member (including a Viewer) can PATCH tax/GSTIN/state, bank details, or gateway secrets, or delete the row. The capability check is client-side only. | `src/app/settings/page.tsx:569`, migrations `1793001500:71-76` |
| H-25 | `createTenantClient` applies the registry plaintext policy to the env superuser password and throws in production, breaking every storefront route, OTP, catalog feed and AI fallback on a normal `.env` deployment. | `src/lib/pocketbase.ts:112` |
| H-26 | Storefront catalog accepts a request-supplied `account_email` and builds a superuser client for it (multi-account mode): an anonymous request returns another merchant's SKUs, prices and stock. | `src/lib/storefront-tenant.ts:34` |
| H-27 | WhatsApp STOP replies never reach the opt-out registry: the only handler runs when an operator opens the chat and the STOP is still the last inbound message; the live socket handler ignores intent and `registerStopOptOut` has no callers. Marketing keeps sending to opted-out customers. | `src/app/whatsapp/page.tsx:1383` |
| H-28 | Flash-drop confirmation never re-checks the 10-minute hold: an expired reservation and a second buyer can both settle; the late one is stock-clamped but still `PAID/confirmed`. | `src/app/api/storefront/flash-drop/route.ts:854` |
| H-29 | Idempotency replay returns a cancelled or line-less order as a successful duplicate: the lookup ignores status, and the failure paths cancel the order while the client keeps the same key. | `src/lib/channel-orders.ts:380` |
| H-30 | Catalog editor divides already-normalised rupee prices by 1000, so any item ≥ ₹1,00,000 that is a multiple of ₹1,000 is displayed and re-saved at 1/1000 — editing only the name reprices a ₹1,50,000 piece to ₹150 and can push that into `channel_prices.whatsapp`. (W-06 = U-06) | `src/components/whatsapp/WhatsAppCatalogEditorModal.tsx:85` |

## Data integrity, backup and import

| ID | Finding | Location |
|---|---|---|
| H-31 | Import is not atomic: a failed variant/stock write leaves an orphan product, and the retry duplicates it; a failed movement is swallowed while `successCount` still increments. | `src/lib/excel-import.ts:798-864` |
| H-32 | Price column resolves to "Cost Price" when no selling-price header exists (substring match), so every imported item sells at cost with zero margin and no error. Same pass lets `stock` claim "Low Stock Threshold". | `src/lib/excel-import.ts:519` |
| H-33 | Backup omits `categories` (and `store_settings`, `users`) for both export and restore — a fresh restore leaves every product with a dangling category, silently. | `src/lib/backup.ts:61` |
| H-34 | Restore half-applies (create failures just continue) and the only rollback snapshot is returned to the UI, which never renders, downloads or applies it. | `src/lib/backup.ts:281`, `backup/page.tsx:122` |
| H-35 | "Automatic snapshot" writes only a timestamp; "Restore last snapshot" reads a key that is never written and can never succeed, while the page advertises it as the recovery path. | `src/lib/backup.ts:458` |
| H-36 | The "full database snapshot" export omits `invoice_payments`, `sales`/`sale_items`, `stock_movements`, `vendors`, `purchase_orders`, `expenses` — receivable, cash and stock cannot be reconstructed from it. | `src/lib/database-snapshot.ts:23` |
| H-37 | Import auto-SKU (`SKU-<last 6 ms>-<100..999>`) has ~58% collision probability at 40 blank-SKU rows and bypasses the race-safe allocator that already exists. | `src/lib/excel-import.ts:791`, `sku-generator.ts:403` |
| H-38 | Category lookup is unscoped and new categories are created without `account_email` — cross-tenant reuse and invisible duplicates on every import. | `src/lib/excel-import.ts:701,779` |
| H-39 | CSV price parsing turns `"1,290"` into `1` (passes validation), `"1290abc"` into `1290`, and truncates `"12.5"` stock to 12. | `src/lib/csv.ts:140` |
| H-40 | Activity-log actor name is caller-supplied, not session-derived; the audit screen shows only that name, so any signed-in user can attribute an action to another employee. | `src/lib/activity.ts:147`, `activity/page.tsx:252` |
| H-41 | Offline mutations queued without a live session land in a `_default` tenant namespace and are never replayed after login — sales vanish with no record, no stock decrement, no dead letter. | `src/lib/offline-queue.ts:109` |
| H-42 | During a drain, a concurrent edit is merged into the queue and then deleted unseen (remove-by-id with no content check) — silent lost update on the round-trip window. | `src/lib/offline-queue.ts:220` |
| H-43 | Customer delete fails open when the purchase-history checks error (`catch(() => null)` reads as "no history"), deleting a customer with invoices/orders and reporting success. | `src/lib/customers.ts:219` |
| H-44 | Flash-drop pay-intent can create a second order line when the item read fails; settlement then deducts and invoices two lines while the customer paid for one. | `src/app/api/storefront/flash-drop/route.ts:776` |
| H-45 | Gateway order id saved with `catch(() => {})`; if that write fails the customer is charged and `confirmStorefrontPayment` then refuses with 409 because it cannot read `gateway_order_id`. | `src/app/api/storefront/order/route.ts:494` |

## UI shell: unrecoverable or double-applied actions

| ID | Finding | Location |
|---|---|---|
| H-46 | Quick-add saves the same product twice on key auto-repeat (Enter handler has no `saving` guard, `createDraftProduct` does not dedupe, no unique SKU index) → duplicate products, variants and stock movements. | `src/components/inventory/QuickAddProductDialog.tsx:561` |
| H-47 | PhonePe "Try Again" never polls the new payment (`completedRef` is not reset), so the modal sits on "Complete payment" forever and the sale is never recorded as paid. | `src/components/pos/PhonePePayment.tsx:61,141` |
| H-48 | "Accept & Receive Stock" has no in-flight guard; two clicks both see `dispatched` and both credit the destination. | `src/components/inventory/StockTransferModal.tsx:205` |
| H-49 | Quarantining a scanned product can deduct a different product's variant: `setVariantId` is never cleared when the scan resolves no variant. | `src/components/inventory/DiscrepancyModal.tsx:93` |
| H-50 | Product broadcast pre-selects every channel/community and sends on one unguarded click with no permission check — while the sibling composer explicitly forbids exactly this. | `src/components/whatsapp/ProductBroadcastModal.tsx:134` |

---

# Medium (70) and Low (33)

Full detail, evidence and minimal fixes are in the per-wave files. Index by area:

| Area | Medium | Low | Representative items |
|---|---|---|---|
| Money / tax | 6 | 3 | inter-state POS receipt prints CGST/SGST halves (M-05); coupon usage recorded with wrong amount (M-06); CN approved after its creation month never filed (M-07); export invoice hardcodes 3% IGST (M-08); loyalty earns 1/100 of the labelled rate (M-09); POS seller state defaults to `'27'` (M-10) |
| Stock / returns | 6 | 1 | scanner +/− changes stock with no movement (S-09); chat-created product has no ledger receipt (S-10); defect quarantine written with a positive qty inverts the ledger (S-11); damage flags the stockiest variant (S-12); non-atomic CN "claim" (S-13); cycle-count applies before the audit row (S-14) |
| Payments | 7 | 2 | webhook rejects the app's own marked-up links (P-05); karigar accepts finished+scrap > issued (P-06); blanket-PO overhead re-applied per batch (P-07); cheque cannot clear below balance (P-08); COD reports success unverified (P-09); expense double-click (P-10); UTC invoice date (P-11) |
| Tenancy | 5 | 3 | `/customers` has no permission gate (T-05); rate-limit key trusts forwarded headers (T-06); multi-account login cannot resolve a DB (T-07); tenant-db GET wakes a DB before auth (T-08); e-way settings always 500s (T-09) |
| WhatsApp / CRM | 7 | 1 | `catalog_master` adopts 1/1000 prices (W-07); RFM double-counts chat orders (W-08); concierge ignores `price_adjustment` (W-09); campaign attribution anchored to creation (W-10); client-supplied shipping/COD (W-11); non-atomic broadcast claim (W-12); content saved under the editor's email (W-13) |
| Orders / reports | 10 | 4 | concurrent confirm deducts twice (O-09); dashboard margin includes GST+shipping (O-10); sparse-month trend shifts previous series (O-11); challan header disagrees with lines (O-13); every split numbered `-BO1` (O-14); header discount duplicates line discount on print (O-15); returns never reduce revenue (O-16); landed cost includes unreceived qty (O-17); challan writes `"default"` relation (O-22) |
| Backup / import | 9 | 4 | numeric coercion (B-13); partial rows dropped silently (B-14); `.xls` advertised but unsupported (B-15); export omits HSN/tax and valuation (B-16); restore accepts any version (B-17); failed audit writes queued in localStorage, forgeable (B-20); child-SKU length 21 vs 22 (B-22); sequence wraps >99999 (B-23) |
| Offline / device | 4 | 5 | `isFlushing` never reset on throw (D-03); wedge listener turns typing into a barcode (D-04); backend failure renders an error-free zero dashboard (D-05); storefront defaults publish promises with no contact channel (D-06) |
| UI shell | 8 | 3 | PB-sync checkbox leaks to next item (U-07); "shipped" sent before the guard (U-08); failed fetch renders "All Clear" (U-09); bulk % retry compounds (U-10); bulk Move to Draft unconfirmed (U-11); PhonePe timeout unclosable (U-12); UTC dates (U-13,U-15); tracking URL not switched per courier (U-14) |
| Swallowed writes | 8 | 7 | coupon counter writes ignored (SW-06); backorder ledger reassignment (SW-07); invoice delete ignores children (SW-08); catalog id never stored (SW-09); vendor ingestion loses stock (SW-10); sales mirror missing/duplicated (SW-11); reconciliation guards fail open (SW-12); loyalty moves before ledger (SW-13) |

---

# Root causes (fix these once, many findings disappear)

1. **Multi-step writes with no atomicity or compensation.** H-06, H-31, H-34, H-44, SW-07, SW-08, SW-13, S-04, S-13, S-14. PocketBase has no transactions here, so every multi-row operation needs an explicit apply-then-compensate or a resumable marker.
2. **`.catch(() => {})` on writes.** H-13/H-14/H-15/H-19/H-43/H-45 + SW-01..SW-13. Writes that can fail must throw or set a retryable marker; only reads may degrade.
3. **Capability checks that exist only in React.** H-23, H-24, H-26, T-05. The write goes straight to PocketBase with the user's token, so the screen is not a boundary.
4. **UTC vs local time applied inconsistently.** H-22, M-07, P-11, M-12, O-19, U-13, U-15. Pick one convention (local calendar days for business dates) and route every bound/format through one helper.
5. **Filters that silently narrow what the UI thinks is true.** C-02 (`is_active`), H-21 (channel exclusion), H-10 (arbitrary "primary" variant), H-33 (missing backup tables), H-36 (missing snapshot tables). A filter that hides data must be visible at the call site.
6. **Heuristics without a unit or a marker.** H-30 (price ÷1000), H-32 (substring header match), H-37 (timestamp+random SKU). Prefer a declared unit/marker over magnitude or keyword guessing.

# Suggested fix order

1. **Money correctness first:** C-01, C-05, C-03, H-22, H-20, H-21, H-01, H-03. These produce wrong tax filings and wrong margins on normal operation.
2. **Stock integrity:** C-02, H-04..H-10, S-01/S-06 (same file), H-07/H-48.
3. **Money in flight:** C-04, H-11..H-15, H-45, H-28, H-29.
4. **Boundaries:** H-23, H-24, H-25, H-26, H-27.
5. **Data safety:** C-06, C-07, H-31..H-42.
6. Then the Medium band by area, then Low.

# Notes and caveats

- `T-04`, `T-07`, `T-08`, `T-10`, `T-12` are **multi-account-mode only** and inert under the shipped single-account config.
- `P-04` (webhook order-id source) is marked *likely*: whether Razorpay copies Order notes onto the Payment entity should be confirmed against a live event.
- `W-12` (broadcast double-send) needs two concurrent drains; `O-03`/`O-04`/`O-05` need a transient failure or legacy row to trigger.
- Two suites are skipped in the baseline because PocketBase is not running on :8090; live-DB behaviour was probed separately on a throw-away instance where noted in the wave files.
- No code has been changed. Review the list and tell me which IDs to fix.
