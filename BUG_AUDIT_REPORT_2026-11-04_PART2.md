# Bugs & Issues Audit Report (Part 2) — Luminila Inventory Management

**Date:** 2026-11-04
**Project:** `luminila_inv_mgmt` (Next.js 16 + PocketBase + Tauri v2)
**Method:** Token-efficient, one feature at a time. Read-only audit agents, max 3 concurrent per wave, file:line-verified findings only.
**Coverage this report:** the 12 domain groups NOT covered by `BUG_AUDIT_REPORT_2026-11-04.md` (Part 1: Auth/RBAC, POS, Inventory = 45 findings)
**New findings:** 180 (Critical: 8, High: 69, Medium: 89, Low: 14)
**Combined total across both reports:** 225 findings (Critical: 12, High: 92, Medium: 105, Low: 16)

---

## 1. Executive Summary

The dominant defect class is unchanged from Part 1: **client-trusted data on money paths, missing tenant scoping (`account_email`), non-atomic writes, and silent-failure swallowing.** New, systemic issues surfaced in Part 2:

1. **Cross-tenant access is the #1 systemic risk.** Dozens of read/update/delete paths run under a superuser client with no `account_email` check (invoices trash/restore, returns approve/refund, PO reconcile, banking update, vendors/discounts CRUD, packing queries, manufacturing jobs blob). Reads are scoped in some modules; **writes are almost never verified.**
2. **Secrets in the browser bundle / localStorage.** Razorpay `keySecret`, `webhookSecret`, PhonePe `saltKey` are read from plaintext `localStorage` and re-serialized on every settings save/load (`settings.ts:197-199`, `razorpay.ts:35`). Any XSS = full payment-Gateway compromise. The sidecar bearer token also ships via `NEXT_PUBLIC_WPPCONNECT_SECRET` build-time fallback (`whatsapp.ts:12`).
3. **Overpayment / partial-settlement accounting is broken** (invoice `recordPayment` accepts any amount; payment-reconciliation marks invoice `paid` with `paid_amount = link.amount` overwrite, not increment).
4. **Anti-ban controls are fail-open**: broadcast daily quota returns 0 on error (`whatsapp-broadcast.ts:240`), WhatsApp opt-out check defaults to "not opted out" (`whatsapp-crm.ts:1154`), mutation quotas live in localStorage only.
5. **GSTR-1/GST compliance paths fabricate data** (synthetic HSN 7113 lines, fake `hash: 'hash'`, placeholder NIC e-way bill encryption, invoice date fallbacks to `01-01-2026`).
6. **Tenant isolation primitives exist but are not used**: `sanitizeFilter`, `accountScopeEmail()`, `tenantClause()` are bypassed in exactly the modules handling money (banking, purchase, returns, payments).

**Fix order:** (1) payment secret handling + webhook/settlement integrity, (2) cross-tenant write guards (returns/invoice/purchase/vendors/discounts), (3) tenant-scoped fail-closed helpers, (4) GST/GSTR-1 correctness, (5) atomicity/idempotency on settle/refund/stock paths.

---

## 2. Feature Audits

### 2.1 Invoices / GST / E-Way / Discounts (Accounting core)

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| INV-1 | src/lib/invoice.ts:1025-1043 | **Critical** | `trashInvoice`/`restoreInvoice`/`deleteInvoicePermanently` mutate by raw id, no `account_email` ownership check (contrast `getInvoice` :727); items/payments fetches unscoped (:1034,:1038). Superuser client ⇒ permanent cross-tenant deletion of invoice + items + payments. | Verify tenant ownership before any write/delete; scope child queries. |
| INV-2 | src/app/invoices/create/page.tsx:180-189,388-390,478 | High | `recalculateTotals` result discarded (`setTotals` only); line items persisted with `cgst/sgst/igst = 0`, `total_amount = taxable_amount`. Header shows CGST/SGST, lines show tax 0. | `setItems(calculated.items)`; submit recomputed rows. |
| INV-3 | src/lib/invoice.ts:160-179 | High | `recordPayment` creates the `invoice_payments` row (:160) BEFORE tenant/ownership check (:175-179) ⇒ orphan money ledger rows against other tenants' invoices, no rollback. | Ownership check first, then ledger insert. |
| INV-4 | src/lib/invoice.ts:150-196; detail page :180-195 | High | No upper bound on payment `amount`; `paid_amount = max(paid+amount, ledgerTotal)` (:186) can exceed `grand_total`, `is_paid` flips true on overpay; stale-ledger overwrite loses concurrent increments. | Reject amount > balance due; clamp + explicit over/under-payment record. |
| INV-5 | src/lib/invoice.ts:474-507 | High | `createInvoice` persists caller-supplied `grand_total/taxable_value/total_tax/cgst/sgst/igst` verbatim — no cross-check against item rows. ₹1 invoice for ₹50k of items is storable and flows into dues/GSTR-1/print. | Recompute from items; reject mismatch > ±0.05. |
| INV-6 | src/lib/eway-bill.ts:617-698 | High | `invoices.getOne`/`invoice_items` unscoped (:623); builds live NIC request with `toPincode: 0`, `toPlace: ''`, `transDistance: 0` (:665,:668) and calls the API anyway. Cross-tenant PII sent to NIC; invalid e-way data filed. | Tenant-scope both queries; throw unless pincode/place/distance supplied. |
| INV-7 | src/lib/invoice.ts:874-875 | Medium | `filters.invoiceType` interpolated unsanitized into PB filter (all siblings use `sanitizeFilter`) — filter injection bypassing tenant clause. | `sanitizeFilter(filters.invoiceType)`. |
| INV-8 | src/lib/gstr1-engine.ts:217-225 | Medium | `formatGstnDate` returns `'01-01-2026'` for missing dates — fabricated date filed in GSTN Tables 4/5/9B instead of failing. | Return/throw error; validate all doc dates before compiling. |
| INV-9 | src/lib/gstr1-engine.ts:299-310 | Medium | Invoices without item rows get synthetic HSN `7113`, guessed rate (`igst_amount ? 3.0 : 0`), back-solved taxable — invents HSN/qty/rate; corrupts Tables 4/7/12. | Fail compilation with named invoice error. |
| INV-10 | src/lib/gstr1-engine.ts:608 | Medium | Statutory payload ships literal `hash: 'hash'`; `gt`/`cur_gt` silently default 0. | Omit `hash` unless computable; never emit placeholder constants. |
| INV-11 | src/lib/sequence-generator.ts:161-189 | Medium | On allocator retry exhaustion returns `${prefix}-${Date.now()}` and proceeds to create the invoice — non-sequential, collision-prone, GST-non-compliant number filed as issued. | Abort invoice creation on exhaustion. |
| INV-12 | src/lib/sequence-generator.ts:229-254 + invoice.ts:525-528 | Medium | `createWithUniqueRetry` burns a fresh FY sequence value per retry — unlogged gaps in the GST invoice series. | Reuse the same value across retries; log skipped numbers as gaps. |
| INV-13 | src/lib/discounts.ts:292-294 | Medium | Per-customer usage-limit query failure swallowed (`catch {}`) and coupon still applied — fail-open on money path exactly when DB is erroring. | Fail closed: `valid:false` on query error. |
| INV-14 | src/lib/eway-bill.ts:262-267 | Medium | `encryptWithPublicKey` is Base64 labeled as NIC RSA encryption ("For now… placeholder"); ACCESSTOKEN (user/pass/app_key) transmitted decodable. | Implement RSA with NIC public key per spec, or refuse to call API. |
| INV-15 | src/lib/gst.ts:117 | Low | Unknown seller state vs known buyer ⇒ IGST (inconsistent with invoice-math.ts:147) — wrong tax head for mis-configured stores. | Require both codes; throw/config-default otherwise. |

### 2.2 Orders / Challan / Shipments

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| ORD-1 | src/lib/orders.ts:682-785 (cancelSalesOrder) | High | No `account_email` ownership check (unlike generateInvoiceFromOrder :329); POS `sales` mirror lookup (:756-759) filters by `channel_order_id` only; `payment_links` filter unsanitized (:747) — cross-tenant cancel/restore by id. | Tenant check after getOne; scope + sanitize both follow-up queries. |
| ORD-2 | src/lib/orders.ts:336-348 | High | Idempotency read `getFullList(...).catch(() => [])` — transient error = "no invoice exists"; two concurrent calls both pass → duplicate invoices. No unique constraint. | Rethrow lookup errors; unique index on `invoices.order` or lock; re-check after create. |
| ORD-3 | src/lib/orders.ts:146-161,179-189 (createOrder) | High | Header totals + `item.total` persisted verbatim from client; never recomputed — feeds invoice discount, COD settlement (shipments.ts:228), aggregates, loyalty. | Recompute server-side from items. |
| ORD-4 | src/lib/shipments.ts:200-257 (settleCodOrder) | High | PAID transition + ledger insert + aggregate-marker check all read-then-write, no lock ⇒ double `applyPurchaseAggregates`, double loyalty, duplicate `cod` ledger rows on concurrent settles; ledger insert failure swallowed (:237) after PAID set. | Atomic conditional update (`payment_status != "PAID"`); marker in same write; don't swallow ledger failure. |
| ORD-5 | src/lib/shipments.ts:40-51 (createShipment) | High | Legacy `createShipment`: no `account_email` stamp, no ownership check, no paid/COD precondition (contrast createShipmentForOrder :113-125) ⇒ dispatch unpaid orders, tenant-invisible rows. | Route through createShipmentForOrder or add same guards. |
| ORD-6 | src/lib/challan.ts:431-457 (updateChallanStatus) | High | `delivery_challans.update(id)` bare — no tenant check, no transition validation; any tenant can flip any challan; no stock/order side effects applied or reversed. | Ownership check + state machine (draft→issued→in_transit→delivered/returned/cancelled). |
| ORD-7 | src/lib/challan.ts:195-265 (createChallan) | High | Header created via createWithUniqueRetry, then items in plain loop ⇒ mid-loop failure leaves orphan challan with partial items. | One transaction, or compensate by deleting header on item failure. |
| ORD-8 | src/lib/orders.ts:212-231 | Medium | On `applyChannelStock` rejection, catch deletes items + header but never calls `restoreChannelStockForReference` — lines already deducted stay deducted (ledger drift). | Restore by `referenceId: order.id` in catch. |
| ORD-9 | src/lib/shipments.ts:127-140 | Medium | Shipment created, then order→`shipped` update throws ⇒ function fails but shipment persists; retry inserts duplicate AWB rows, no dedup. | Compensating delete or check-existing on retry. |
| ORD-10 | src/lib/shipments.ts:156-174 | Medium | No tenant scope, no transition check; order→`delivered` update swallowed via `.catch(()=>{})` ⇒ shipment delivered while order stays confirmed, blocking invoicing. | Scope + validate transitions; surface order-update failure. |
| ORD-11 | src/lib/challan.ts:468-494 (generateChallanFromOrder) | Medium | Order fetched without tenant check; items filter lacks `account_email`; interstate supply gets CGST+SGST anyway (`igst` hardcoded 0); `taxable_value = qty×price` ignores `discount_amount` ⇒ GST overstated. | Tenant-check; pick CGST/SGST vs IGST from state codes; tax on post-discount base. |
| ORD-12 | src/lib/orders.ts:643-650 (markSalesOrderShipped) | Medium | Sets `shipped` on any confirmed/invoiced order; no payment/COD precondition, no AWB/shipment link — bypasses the dispatch gate in `getDispatchableOrders`. | Enforce PAID/COD rule; require shipment. |
| ORD-13 | src/lib/channel-orders.ts:184-203 | Medium | `applyPurchaseReversal` read-then-write (vs atomic `'total_spent+'` in applyPurchaseAggregates); concurrent ops lose updates; floor-at-zero masks drift. | Atomic `total_spent-`/`total_orders-` modifiers or transaction. |
| ORD-14 | src/lib/channel-orders.ts:368-387, 85-91 | Medium | `findExistingChannelOrder` falls back to unscoped `order_number` when tenantEmail omitted (re-opens cross-tenant replay); `upsertChannelCustomer` treats lookup error as "not found" ⇒ duplicate customers. | Make tenantEmail mandatory; rethrow on lookup error. |
| ORD-15 | src/lib/orders.ts:545-547; order-milestones.ts:158 | Low | `accountScopeEmail()===''` ⇒ filter `id != ""` (every tenant's orders). Milestones write `activity_logs` without `account_email`. | Return [] on empty tenant; stamp tenant on logs. |

### 2.3 Returns / Credit Notes

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| RET-1 | src/lib/returns.ts:385,533,649,672 | **Critical** | `approveCreditNote`/`processRefund`/`cancelCreditNote`/`createReturnFromInvoice` — bare-id `getOne`, no `account_email` check; inventory side effects (:407,:449,:460,:497,:1113) unscoped. Cross-tenant approve/refund/cancel of money + stock. | Tenant filter/ownership on every fetch & write; throw on mismatch. |
| RET-2 | src/lib/returns.ts:541-556 | High | Double-refund race: read status, check `=== 'approved'`, then update — no atomic claim. Two concurrent calls both refund (approve path claims-first :403; refund doesn't). | Claim `status:'refunded'` first + re-read verify / single-flight lock. |
| RET-3 | src/lib/returns.ts:567-585 | High | Partial refund reverses FULL original sale: `sale.total` passed to `applyPurchaseReversal` — whole `total_spent`/`total_orders` subtracted for a 1-unit return. | Pass refund (credit-note total); derive order decrement. |
| RET-4 | src/lib/returns.ts:586-598 | High | Loyalty clawback takes ENTIRE earn points of original sale regardless of refund fraction. | Prorate by `cn.grand_total / originalAmount`. |
| RET-5 | src/lib/returns.ts:561-610,638-645 | High | Cash-refund failure rolls note back to `approved` (:641) but loyalty/spend reversals (:584-610) are NOT undone — retry double-reverses. | Reverse loyalty/discount only after drawer success, or compensate in rollback. |
| RET-6 | src/lib/returns.ts:692-698 | High | Over-return guard fails open: prior-items query `.catch(() => [])` ⇒ re-return/re-credit same line on DB error. | Throw on query failure (block the return). |
| RET-7 | src/lib/returns.ts:441-525 | High | Restock failure only `console.warn` (:505-507); unexpected throw caught at :523, logged, status stays `approved` — caller toasts success, items never restocked/quarantined. | Propagate failure & revert to `pending`, or retryable error state. |
| RET-8 | src/lib/returns.ts:1137-1162 | High | Exchange without `original_invoice_id`: stock deducted, note `exchanged`, NO tax invoice for replacement goods — replacement leaves with zero output GST. | Require/create exchange invoice whenever stock deducted. |
| RET-9 | src/lib/returns.ts:355-361 | High | `wasStockDeducted` invoice fetch `.catch(() => null)` ⇒ unreadable invoice = "not a storefront order" ⇒ legitimate restock silently skipped. | Fail safe (throw/retry), never skip silently. |
| RET-10 | src/lib/returns-qc-engine.ts:83-105,163-170 + returns.ts:421-437,547 | Medium | QC treats `unitPrice` as tax-inclusive but receives pre-tax base; QC `netRefundCreditAmount` (restocking fee/deductions) computed then discarded — full `cn.grand_total` refunded. | Pass tax-inclusive price; subtract `totalDeductions` before refund. |
| RET-11 | src/lib/returns.ts:275-325 | Medium | `createCreditNote` non-atomic: note created, items inserted one-by-one ⇒ orphan note with missing lines. | Batch/rollback (delete note on item failure). |
| RET-12 | src/lib/returns.ts:1189-1202 | Medium | Exchange `balanceDue<0` payout: `recordCashRefund` failure only `console.warn` — drawer never records payout; note stays `exchanged` (no rollback like processRefund). | Roll back `exchanged`→`approved` or create alert record + surface error. |
| RET-13 | src/lib/returns.ts:407,674,695 | Medium | Unsanitized interpolated ids in filters (`credit_note="${id}"` etc.) — rest of file uses `sanitizeFilter`. | Wrap in `sanitizeFilter`. |
| RET-14 | src/lib/returns.ts:885,1035 | Medium | Exchange GST invoice hardcodes `GST_RATES.JEWELRY` for ALL replacement lines regardless of each item's own `gst_rate`. | Use per-line rates. |
| RET-15 | src/lib/returns.ts:845-866; detail page :214-218; create page :278 vs :347 | Low | Duplicate `ExchangeResult` interface (merging); exchange "add" accumulates qty without aggregate stock re-check; create page line shows pre-tax base while summary shows tax-inclusive — mismatched bases. | Dedupe; re-check stock; consistent base. |

### 2.4 Purchase / GRN / Valuation

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| PUR-1 | src/lib/purchase.ts:309-312 | **Critical** | PO subtotal = Σ `item.total_price` (already GST-inclusive) + GST added again (total = subtotal + gstAmount + …) ⇒ stored grand total inflated by full GST. UI calculator is correct — display ≠ saved record. | subtotal = Σ qty×unit_price, rounded 2dp. |
| PUR-2 | src/lib/purchase.ts:766-784 | High | GRN applies `stock_level+` (:766) BEFORE movement create (:771); `appliedStock.push` only after (:780) ⇒ movement failure skips rollback ⇒ permanently inflated stock, no ledger entry. | Push appliedStock immediately; reverse in catch. |
| PUR-3 | src/lib/purchase.ts:649-664, 697-749 | High | GRN header created before PO-item validation; reservation loop throws with no rollback of GRN row or earlier reservations ⇒ orphan GRN + leaked `quantity_received+`. | Reserve/validate all lines first, create GRN last; full rollback. |
| PUR-4 | src/lib/purchase.ts:345-410 | High | PO header created (:345/365), items inserted one-by-one, no rollback ⇒ partial/header-only PO on failure. | Roll back header + inserted items on failure. |
| PUR-5 | src/lib/purchase.ts:1333-1352, 1430 | High | `reconcilePOWithInwardBatch` / `approvePODiscrepancy` mutate cost/notes/status/approval by bare id, no tenant check ⇒ cross-tenant inward-cost inflation / approval flip. | Verify tenant after getOne; add `account_email` filter. |
| PUR-6 | src/lib/purchase.ts:1097,1115,1171 | High | `getProductPurchaseHistory` — product_variants/grn_items/purchase_order_items queries, no tenant clause ⇒ cross-tenant purchase history/stock exposure. | Tenant filter on all three. |
| PUR-7 | src/lib/excel-import.ts:715-724 | High | Bulk-import PO pre-resolution lookup has no tenant filter ⇒ a row tagged to another tenant's PO gets overhead absorbed + `reconcilePOWithInwardBatch` mutation. | Scope by `account_email`; verify before use. |
| PUR-8 | src/lib/purchase.ts:840-842, 857-859 | Medium | Post-GRN PO-status recompute fetches items without tenant clause, `console.error` on failure ⇒ PO stuck `sent`/`partial` after full receipt, silently. | Add tenantClause; throw/surface. |
| PUR-9 | src/lib/purchase.ts:634-640 | Medium | `updatePOStatus`/`cancelPurchaseOrder` by bare id, no ownership check ⇒ cancel another tenant's PO. | getOne + tenant check before update. |
| PUR-10 | src/lib/excel-import.ts:768-771; purchase.ts:991 | Medium | Category auto-create omits `account_email`; purchase.ts category filter `name = "${catName}"` unsanitized ⇒ filter injection / cross-tenant match. | `sanitizeFilter`; stamp tenant. |
| PUR-11 | src/lib/purchase.ts:682 | Medium | `validItems` keeps only qty_received > 0 ⇒ rejection-only lines silently dropped from GRN. | Include rejected lines. |
| PUR-12 | src/lib/purchase.ts:735-742; detail :313-319 | Medium | Over-receipt silently capped to `remaining`; UI still toasts "Receipt confirmed" ⇒ operator never learns quantity was discarded. | Surface the cap (throw/warning) to caller. |
| PUR-13 | src/lib/purchase.ts:628-631, 937-940, 1277-1280, 1219-1227 | Medium | Fetch wrappers swallow all errors ⇒ `[]`; UI renders "no data" indistinguishable from empty state. | Throw or `{data,error}` + caller toast. |
| PUR-14 | src/lib/purchase.ts:536 | Low | `filters.status` interpolated unsanitized (filter injection / malformed-filter DoS). | `sanitizeFilter`. |
| PUR-15 | src/lib/purchase.ts:1465, 1477 | Low | Raw float money: taxable/subtotal unrounded; qty×price sums accumulate paise dust into stored totals. | Round to 2dp. |

### 2.5 Banking / Cheques / Expenses / Multi-location

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| BNK-1 | src/lib/cheque-register.ts:187-200 | **Critical** | `advanceCheque` posts bank ledger entry BEFORE register write; write failure ⇒ no rollback, retry double-posts delta (clear/reopen/bounce). No idempotency key. | One enqueue'd unit + compensation, or idempotent bank tx via reference_number. |
| BNK-2 | src/lib/banking.ts:215-219; concurrency.ts:7-34 | High | Overdraft guard reads balance then atomic `current_balance-` later; `enqueueTask` is per-process in-memory ⇒ two tabs/instances both pass; balance can go negative. | DB-layer non-negative rule / conditional update; don't trust client read-then-write. |
| BNK-3 | src/lib/expenses.ts:220-231, 285-289 | High | Amount never validated/rounded: `parseFloat("abc")`→NaN, negative stored as-is ⇒ corrupts stats reduce (:474-483) and byCategory %. | Validate finite, >0, round 2dp; reject. |
| BNK-4 | src/lib/multi-location.ts:478-491 | High | `createStockTransfer` deducts source stock first, transfer PB create in `catch {}` swallowed ⇒ inventory gone, no transfer record; partial multi-item deduction can't roll back. | Persist transfer first / saga reversal; surface failure. |
| BNK-5 | src/lib/multi-location.ts:513-518 | High | `receiveStockTransfer` guards only `status==="received"` ⇒ `cancelled` transfer can be received, minting destination stock. `receivedQty` unvalidated (can exceed dispatched). | Require status dispatched/in_transit; clamp to dispatched, ≥0. |
| BNK-6 | src/lib/expenses.ts:227-239 | High | bank_transfer/cheque expenses never create bank ledger entry or decrement balance ⇒ books diverge; bank balance overstated. | For bank-affecting modes, call createBankTransaction, link related_entity_id. |
| BNK-7 | src/lib/cheque-register.ts:90-95, 106-123 | High | `settingsFilter()` drops account_email when scope empty; `writeCheques` update()s first matching row ⇒ read/overwrite another tenant's register. | Always include tenant predicate; refuse when scope empty (like banking.ts tenantFilter). |
| BNK-8 | src/lib/banking.ts:141-155 | High | `updateBankAccount` writes arbitrary `current_balance`/`opening_balance` directly — bypasses overdraft + double-entry entirely, no audit row. | Strip balances from generic update; ledger-only changes. |
| BNK-9 | src/lib/cheque-register.ts:184-197; cheque-engine.ts:240-250 | Medium | Bounce computes `partyReceivableDelta` (amount+penalty reinstated) but only `bankBalanceDelta` is posted — receivable never reinstated anywhere. | Persist receivable reinstatement or remove the dead field. |
| BNK-10 | src/lib/multi-location.ts:349-351 | Medium | `adjustLocationStock` clamps `Math.max(0, …)` ⇒ silent partial deduction; shortfall vanishes from ledger; caller not told. | Allow negative or throw; return shortfall. |
| BNK-11 | src/lib/multi-location.ts:133-135, 384-386 | Medium | Raw `account_email = "${userEmail}"` unsanitized; empty scope matches shared/legacy rows cross-tenant. | `sanitizeFilter`; refuse empty scope. |
| BNK-12 | src/lib/multi-location.ts:210-218, 489-491, 544-551 | Medium | All PB writes in bare `catch {}` then mirrored to localStorage and reported as success — UI shows saved location/transfer never persisted. | Surface persistence errors; don't cache/report success on failure. |
| BNK-13 | src/lib/banking.ts:226-236, 343 | Medium | Amounts never rounded to 2dp — float drift in balance atomic increments and stats sums. | Round paise on input and write. |
| BNK-14 | src/lib/banking.ts:277 | Low | Compensating delete after failed transfer reversal `.catch(()=>{})` — orphan credit row for money already reversed; reversal itself only console.error'd. | Log + retry/flag orphan for reconciliation. |
| BNK-15 | src/lib/expenses.ts:385,180-183; banking.ts:105-107,195-198 | Low | Silent-failure pattern: fetch wrappers return [] on error ⇒ operator sees "no data" instead of outage; category seed swallows auth/rule errors. | Distinguish error from empty; throw/toast on money screens. |

### 2.6 Customers / Loyalty / CRM lifecycle

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| CUS-1 | src/lib/loyalty.ts:348,379,388 | **Critical** | `redeemPoints` uses module-global `pb` (account read/update, `recordTransaction`) — no per-tenant `db` param unlike `earnPoints` ⇒ redemption writes to the wrong tenant's DB in multi-tenant paths. | Add `db: PocketBase = pb` everywhere. |
| CUS-2 | src/lib/customers.ts:282 | High | `addLoyaltyPoints` read-modify-write `(customer.loyalty_points\|\|0) + points` — lost updates; errors only `console.error` (silent point loss). | Atomic `current_balance+`-style modifier / enqueueTask; rethrow. |
| CUS-3 | src/lib/consent-ledger.ts:40 | High | `tenantEmail()` uses raw authStore email — ignores `account_email` (staff) & single-account override ⇒ consent events stamped with personal email; consent gate then defaults null = allowed. | Derive like `accountScopeEmail()`. |
| CUS-4 | src/lib/consent-ledger.ts:126 | High | `getConsentState` catch ⇒ all-null; callers (crm-lifecycle-triggers.ts:231) block only on `=== false` ⇒ ledger read error silently authorizes marketing (DPDP fail-open). | Fail closed: error ⇒ `marketing:false`/throw. |
| CUS-5 | src/lib/loyalty.ts:389,321 | High | Balance mutated atomically, then `recordTransaction` swallows failure (returns null :290-291) ⇒ points granted with NO audit row; undetected drift. | Throw/rollback sagas, or outbox with retry + alert. |
| CUS-6 | src/lib/customers.ts:167,178,487,500 | High | `updateCustomer`/`deleteCustomer`/`getCustomerSummary`/`updateCustomerJewelryProfile` — no `account_email` verification; under superuser client ⇒ IDOR on any id. | Re-fetch tenant-scoped, bail on mismatch (like `getCustomer`). |
| CUS-7 | src/lib/crm-lifecycle-triggers.ts:231,263 | High | Fail-open chain: consent `null` + ledger errors both pass marketing gate ⇒ lifecycle WhatsApp flows dispatch without provable consent. | Treat null/error as not-consented. |
| CUS-8 | src/lib/customer-lookup.ts:219; customers.ts:141 | Medium | `createCustomerFromChat`/`createCustomer` check-then-create, no unique constraint ⇒ duplicate customers per phone under concurrency. | Unique index on `(account_email, phone)`; on conflict return existing. |
| CUS-9 | src/lib/loyalty.ts:209 | Medium | `getOrCreateLoyaltyAccount` read-then-create race (not enqueued like earn/redeem) ⇒ duplicate accounts + double signup bonus. | `enqueueTask` + re-check inside task. |
| CUS-10 | src/lib/loyalty.ts:419,434 | Medium | `adjustPoints` not serialized; negative-balance guard compensation `'current_balance+'` with swallowed `.catch(()=>{})` ⇒ negative balance, unlogged. | Inside `enqueueTask('loyalty_'+id)`; compensation failure loud. |
| CUS-11 | src/lib/loyalty.ts:125 | Medium | `getLoyaltySettings` catch ⇒ `DEFAULT_LOYALTY_SETTINGS` (50 signup, 100 min, 0.1 pts/₹) silently applied on DB error. | Throw/null; callers abort accrual/redemption. |
| CUS-12 | src/lib/crm-lifecycle-triggers.ts:287,363,178,342 | Medium | `r.phone.slice(-10)` and `campaignTag` interpolated unsanitized; `dispatchCustomRecipientsMessages` skips `ensureFlowTenant()` — filter injection / cross-tenant config. | `sanitizeFilter`; call `ensureFlowTenant()`. |
| CUS-13 | src/lib/crm-lifecycle-triggers.ts:138 | Medium | `updateLifecycleConfig` mutates module-global `cachedFlowConfigs` without `ensureFlowTenant()` ⇒ after tenant switch, previous tenant's templates persisted under current tenant's key. | `ensureFlowTenant()` at entry. |
| CUS-14 | src/lib/consent-ledger.ts:70 | Medium | `recordConsentEvent` swallows all errors ⇒ consent decision + `opt_in_marketing` sync silently lost; order proceeds with no ledger evidence. | Return/throw or queue retry + alert. |
| CUS-15 | src/lib/customer-token.ts:85; customers.ts:126,97 | Low | Token `exp` optional, no type check (never expires); seconds vs ms confusion; customers with empty `account_email` returned to any tenant; `filters.type` unsanitized. | Require finite ms `exp`; same-tenant clause; `sanitizeFilter`. |

### 2.7 Reports / Analytics / GSTR-1 exports

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| RPT-1 | src/lib/analytics.ts:119,132 | High | `todayISO = today.toISOString()` string-compared vs PB space-format dates (" " < "T") ⇒ todayRevenue/todayOrders always 0. | `inWindow`/parse; `pbBound(todayISO)`. |
| RPT-2 | src/lib/reports.ts:310-313; reports/gst page | High | GSTR-1 fetch failure ⇒ `{b2b:[],b2c:[],summary:{}}`; page renders ₹0.00 totals with no error banner — filing numbers silently misstated. | Surface error state; never render zeros as valid. |
| RPT-3 | src/lib/analytics-v2/load.ts:137-138 | High | `sales`/`sales_orders` `.catch(() => [])` ⇒ entire canonical tx set empty on failure; every revenue KPI (dashboard, trend, AOV) silently ₹0. | Throw or degraded flag; never fabricate empty success. |
| RPT-4 | src/lib/analytics-v2/load.ts:257 | Medium | `fetchByChunks` `.catch(() => [])` drops whole item chunks ⇒ COGS/margin/units understated, no log. | Propagate or log + count dropped lines. |
| RPT-5 | src/lib/reports.ts:359-362 | Medium | Landed-cost chunk fetch `.catch(() => [])` ⇒ valuation falls back to purchase price silently (understated inventory value). | Log + surface valuation degradation. |
| RPT-6 | src/lib/analytics-v2/sales-metrics.ts:377 | Medium | `buildKpis(current, previous)` called without margin/units ⇒ `kpis.units`/`kpis.margin` always 0/— on analytics view. | Pass real ComparedMetrics or omit KPIs. |
| RPT-7 | src/lib/analytics.ts:297 | Medium | `buildChannelTable(txs, [])` ⇒ previous revenue 0, deltaPct +100 everywhere. | Load previous window or hide delta. |
| RPT-8 | src/lib/reports.ts:458-472 | Medium | `fetchInvoiceItemsForInvoices` chunks filter only `invoice="id"` — **no `account_email`** (breaks dual-layer tenant rule). | Add sanitized tenant clause. |
| RPT-9 | src/lib/gstr1-report.ts:205,255 | Medium | Credit-note filing period keyed off `note.created`, not document date ⇒ notes filed into wrong month/FY. | File by issue date; fallback created. |
| RPT-10 | src/lib/reports.ts:629,633,662 | Medium | Missing POS ⇒ `'' !== '29'` ⇒ isInterState true; B2C>₹2.5L filed as B2CL with `pos:''` (GSTN rejects); B2B accepted on `length >= 15` (invalid ctin) vs checksum used elsewhere (:287). | Require non-empty pos; classify by checksum. |
| RPT-11 | src/lib/reports.ts:292-295 | Medium | B2C-Large requires `seller_state_code`; absent ⇒ isInterState=false ⇒ ALL inter-state unregistered >₹2.5L labelled B2C Small (Table 7). Filing misstatement. | Fall back to store POS / place_of_supply. |
| RPT-12 | src/lib/reports.ts:528-531 | Medium | `getHSNSummary` catch ⇒ `[]`; `generateGSTR1JSON` emits empty `hsn.data` with no warning — fileable JSON missing HSN summary. | Propagate/flag; block or warn on export. |
| RPT-13 | src/lib/analytics-v2/turnover.ts:368-370 | Medium | Sold-out-in-window item (stock=0): `turnover` avg-value collapses to 0 ⇒ null; GMROI guarded on `stockValue > 0` ⇒ null. Best sellers show "—". | Price start inventory by start units × cost; guard avg>0. |
| RPT-14 | src/lib/analytics.ts:159-167 | Medium | Low-stock fetch filters `stock_level>0` (0-unit variants excluded) + `.catch(() => [])` ⇒ understated low-stock count both ways. | No lower bound; surface fetch errors. |
| RPT-15 | src/lib/analytics.ts:421 | Low | `getRevenueSummary('today')` maps to 7d preset; "Today" KPI shows 7-day revenue. | 1d window or rename KPI. |

### 2.8 WhatsApp CRM / Broadcast / Event Sync

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| WA-1 | src/lib/payment-reconciliation.ts:98-103,123-148 | **Critical** | `recordClearingDeposit` check-then-create + unlocked read-modify-write of `current_balance` ⇒ concurrent reconcilers double-count Razorpay clearing deposits / lose balance updates. | Atomic PB transaction or `current_balance+`; unique index on (related_entity_type, related_entity_id); single-flight. |
| WA-2 | src/lib/payment-reconciliation.ts:184-202,283-293 | High | Invoice settle: `.catch(() => {})` on invoice update + `invoice_payments.create`; link marked `paid` anyway (:289) ⇒ settlement silently lost, never retried. | Propagate errors (`settlementFailed=true`); retry next pass; alert. |
| WA-3 | src/lib/payment-reconciliation.ts:98-103,106-112,115-120 | High | Idempotency guards use `.catch(() => null)` ⇒ transient PB error = "no entry" ⇒ duplicate bank_tx / invoice_payment / loyalty on next pass. | Distinguish 404 from transport error; abort link on error. |
| WA-4 | src/lib/whatsapp-crm.ts:1138-1155 | High | `isWhatsAppOptedOut` returns `false` on ANY error — consent check fails OPEN at dispatch time (`processBroadcastQueue`). | Fail closed (treat error as opted-out) or skip send + log. |
| WA-5 | src/lib/whatsapp-crm.ts:1090-1136 | High | `setWhatsAppOptOut`: customer flag update `.catch(() => {})` (:1110) + outer catch (:1133) swallow all ⇒ STOP request silently lost; user keeps receiving marketing. | Registry row first/independently; return success status; surface failure. |
| WA-6 | src/lib/whatsapp-broadcast.ts:231-242, 378-435 | High | `sentTodayCount()` returns 0 on error ⇒ 150/day anti-ban quota silently disabled; no atomic claim of `queued` rows ⇒ concurrent drains double-send; quota breach. | Fail closed on count error; atomic `queued→sending` flip before send. |
| WA-7 | src/lib/whatsapp-broadcast.ts:260-310 | High | `resolveCustomRecipients` re-checks opt_out but OMITS the `opt_in_marketing === false` ledger check (present :185-188) ⇒ non-consented customers messaged; falls back to caller-supplied `requested.phone` (:286). | Same consent checks as segment path; never use caller phone when tenant row has none. |
| WA-8 | src/lib/whatsapp-event-sync.ts:113-115,158-179,418-435 | High | Anti-ban mutation quotas + queue live in localStorage only — trivially bypassed (clear storage / second tab / second device); no shared lock; storage-less env ⇒ 0 wait. | Server-side (PB) counters/per-tenant lock; missing storage = rate-limited. |
| WA-9 | src/lib/whatsapp.ts:12,43-46,65 | High | Build-time fallback `NEXT_PUBLIC_WPPCONNECT_SECRET` compiled into public client bundle ⇒ sidecar bearer token extractable from shipped JS/maps. | Remove build-time fallback; runtime-only injection. |
| WA-10 | src/lib/payment-reconciliation.ts:184-188 | Medium | `paid_amount: link.amount` OVERWRITES (not increments), forces `status:'paid'` regardless of partial coverage ⇒ under-recorded partials, premature paid. | Increment; set paid only when cumulative ≥ total. |
| WA-11 | src/lib/whatsapp-broadcast.ts:651-666 | Medium | No cross-segment dedupe — customer in `all_active` + `vip_tiers` gets duplicate campaign copies. | Dedupe by customer id/phone before queueCampaign. |
| WA-12 | src/lib/whatsapp-event-sync.ts:190-206 | Medium | `restorePersistedQueue` resets `attempts: 0` ⇒ permanently failing products retried forever across reloads, defeating the 4-attempt drop. | Preserve persisted attempts; drop ≥4; surface in telemetry. |
| WA-13 | src/lib/whatsapp-crm.ts:1174-1227 | Medium | POS cart bridge: BroadcastChannel + storage event both fire in receiving tabs, no nonce/dedupe ⇒ items added to POS cart twice. | Unique `messageId` + short-lived dedupe set, or single transport. |
| WA-14 | src/lib/whatsapp-crm.ts:122-128,130-139; payment-reconciliation.ts:25-28 | Medium | Tenant scoping fail-open: `withTenantFilter` returns raw filter when tenant empty (:125); `recordBelongsToTenant` returns `true` for missing `account_email`; `tenantClause()` returns `''`. | Fail closed: match-nothing filter/`false`; log loudly. |
| WA-15 | src/lib/whatsapp-crm.ts:306-317,372-378,882-924 | Medium | Raw-id writes, no ownership check: `setChatContactType`, `markChatRead`, `addToExistingInventory` (`'stock_level+'` on arbitrary variantId) — crafted id mutates another tenant's rows/stock. `sendProductCard` does check (:1004). | Re-fetch tenant-scoped before every id-based update. |

### 2.9 Payments / Razorpay / PhonePe / Webhooks

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| PAY-1 | src/lib/razorpay.ts:35, 52-55 | **Critical** | `keySecret`/`webhookSecret` read from plaintext browser localStorage; `getRazorpayConfig()` returns full config incl. secrets to any importer. XSS ⇒ full gateway compromise (refunds/payouts). PhonePe `saltKey` same pattern (phonepe.ts:31-48). | Secrets server-only; client gets keyId only. |
| PAY-2 | src/lib/razorpay.ts:307-311 | High | `notes: { order_id, source, ...(params.notes\|\|{}) }` — client notes spread AFTER defaults ⇒ caller overwrites `order_id`/`account_email`; webhook settles attacker-chosen order/tenant. | Spread client notes FIRST, then force order_id/account_email. |
| PAY-3 | src/lib/razorpay-webhook-handler.ts:112-118, 318-321, 83-85 | High | Order marked `payment_status:'PAID'` FIRST, then stock/invoice/mirror/loyalty run; redelivery short-circuits at PAID check ⇒ crash = fulfillment steps never complete, silently. | PAID last, or resumable/idempotent steps; verify before early-return. |
| PAY-4 | src/lib/razorpay-webhook-handler.ts:123-156 | High | Stock deduction try/catch only `console.warn`s (:152-156); `existingMovements` check on swallowed `.catch(() => [])` (:126-128) ⇒ order PAID/confirmed with zero inventory debit, no alert. | Fail/flag for review on stock-write failure; never treat ledger-read failure as "no deduction needed". |
| PAY-5 | src/lib/webhook-dedupe.ts:16-22; razorpay-webhook-handler.ts:307 | High | Unresolved tenant ⇒ `settingsFilter` degrades to bare `key="razorpay_webhook_events"` ⇒ matches ANY tenant's processed-events row (cross-tenant dedupe clobber/replay); load `.catch(() => [])` fails open; empty `account_email` row created. | Fail closed; always scope by account_email; propagate load errors. |
| PAY-6 | src/lib/payment-reconciliation.ts:98-103,127,191 | High | `hasClearingEntry`/`hasInvoicePayment` check-then-create, no lock; reconciler runs on multiple surfaces ⇒ duplicate bank deposits + invoice payments. | Unique constraint; insert-and-catch-conflict. |
| PAY-7 | src/lib/razorpay-webhook-handler.ts:326-333 | High | `if (currency && currency !== 'INR')` — missing/empty currency accepted; comment claims amount+currency proven, only amount is. | Reject absent/non-INR currency. |
| PAY-8 | src/lib/payment-reconciliation.ts:184-201 | Medium | Invoice update + `invoice_payments.create` `.catch(() => {})`; link marked `paid` (:289) ⇒ invoice unpaid, payment row lost, never retried. | Let these throw (settlementFailed=true) or explicit error state; retry next pass. |
| PAY-9 | src/lib/payment-reconciliation.ts:132-148 | Medium | `bank_transactions.create` then non-transactional `current_balance = currentBal + link.amount` read-modify-write ⇒ lost updates; crash between create and update ⇒ balance permanently wrong (retry guard returns early :127). | Atomic increment or recompute from transactions. |
| PAY-10 | src/lib/phonepe.ts:31-48,40 | Medium | PhonePe `saltKey` from plaintext localStorage into module config — same exposure class as PAY-1. | Server-only salt. |
| PAY-11 | src/lib/webhook-dedupe.ts:30-34,42-47; razorpay-webhook-handler.ts:290-293 | Medium | Event key `event:entityId`; `payment_link.paid` without payment entity keys the LINK id ⇒ later capture on same link dropped as duplicate; load→remember→save non-atomic; FIFO eviction at 200 re-opens replay. | Key on payment id (fetch if absent); atomic append; unique index. |
| PAY-12 | src/lib/rate-limit.ts:82-90 | Medium | `clientKeyFromHeaders` trusts FIRST `x-forwarded-for` (client-controlled) ⇒ XFF rotation dodges OTP/scrape limits; missing headers collapse to shared "unknown" bucket. | Rightmost trusted proxy IP; separate unknown bucket. |
| PAY-13 | src/lib/razorpay.ts:87-89,79; phonepe.ts:366-368; razorpay-orders.ts:63; webhook-handler.ts:345-356 | Medium | `Math.round(rupees * 100)` IEEE-754 — 1.005*100 = 100.4999… → 100 paise (under-charge/false mismatch on boundaries). | Integer paise or decimal helper (`toFixed(2)` then parse). |
| PAY-14 | src/lib/payment-links.ts:1-6 | Medium | `createPaymentLinkLedger` module-level `pb`, never forces `account_email` ⇒ unscoped ledger rows. | Per-tenant client + stamped account_email. |
| PAY-15 | src/lib/razorpay-webhook-handler.ts:286,94,126 | Low | Unguarded `JSON.parse` (500 vs 400 on malformed-but-signed body); lines 94/126 interpolate orderId unsanitized (`order = "…"`). | try/catch→400; `sanitizeFilter`. |

### 2.10 Sync / Omnichannel / Tenant DB (Storefront)

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| SYN-1 | src/lib/tenant-db-manager.ts:212-230,292-333,439 | **Critical** | TOCTOU port race: `allocateTenantPort` checks `isPortOccupied` then spawns; concurrent tenant B binds A's port; `ensureTenantPocketBaseRunning` sees A's `/api/health` 200 ⇒ B's registry points at A's DB — cross-tenant DB access. | Verify dataDir-bound identity post-spawn, or atomic `listen(0)` port allocation. |
| SYN-2 | src/lib/channel-stock.ts:406-441 | High | `restoreChannelStockForReference` — movements queries (:409,:414) and `product_variants` update (:429) **no `account_email` scope** ⇒ caller on tenant B's order restocks tenant A's variants. | Required tenant arg; verify variant tenant. |
| SYN-3 | src/lib/storefront.ts:63-68 | High | Email absent ⇒ unscoped `key="storefront_content"` `getFirstListItem` ⇒ arbitrary tenant's CMS/brand binds the public storefront. | Require account_email; else DEFAULT_BINDING. |
| SYN-4 | src/lib/catalog-sync.ts:87-108,124-128 | High | WA catalog fetch failure ⇒ `waProducts=[]`, `if (!waP)` ⇒ `createProductInWhatsApp` for the ENTIRE catalog — mass duplicates/spam on sidecar outage. | Abort on fetch failure; diff only against a successfully fetched catalog. |
| SYN-5 | src/lib/storefront-tenant.ts:37-45 | High | Unauthenticated storefront falls back to `activeTenantEmail` (process-global, last admin to log in) ⇒ public storefront silently switches tenants. | Never use registry active tenant for public routes. |
| SYN-6 | src/lib/tenant-db-manager.ts:498,538,554-556,597 | High | `shouldActivate` defaults TRUE despite opt-in comment ⇒ concurrent logins flip `registry.activeTenantEmail`; `getServerTenantPocketBaseConfig` falls back to it ⇒ hands another tenant's URL + superuser creds to the request. | Default activate=false; require explicit preferredEmail or fail. |
| SYN-7 | src/lib/channel-pricing.ts:58,65-67,79-98,161-166 | High | Module-global `currentChannels` mutated by load/save; in multi-tenant server, tenant A's config leaks into tenant B's `getChannelPrice`. | Key channel state per tenant, or pass tenant explicitly. |
| SYN-8 | src/lib/channel-stock.ts:295-306,373-377 | Medium | Compensation swallows everything: ledger deletes `.catch(()=>{})`, restocks `.catch(()=>{})` ⇒ stock stays decremented, no ledger, caller sees only original error. | Collect/report compensation failures; write reconciliation movement. |
| SYN-9 | src/lib/channel-stock.ts:423-441 | Medium | Restore not atomic despite "idempotent" claim: `stock_level+` commits (:429), marker row created after (:431) ⇒ crash between = stock restocked, no marker; retry double-restocks. | Create marker first / unique constraint; or transaction. |
| SYN-10 | src/lib/channel-stock.ts:353,409-411 | Medium | Ledger rows only for `kind==='variant'`; legacy `product`-kind decrements never produce movements ⇒ cancelled legacy-product orders never restocked. | Ledger row for product-kind lines too, or handle separately in restore. |
| SYN-11 | src/lib/channel-stock.ts:334-348 | Medium | Clamp path: re-read then non-atomic `stock_level: 0` write ⇒ concurrent sales in between are erased — lost update on authoritative stock. | Atomic conditional/min-guarded decrement. |
| SYN-12 | src/lib/tenant-db-manager.ts:155-162,455 | Medium | Non-atomic `writeFileSync(registry.json)`, errors swallowed ⇒ crash mid-write corrupts registry; provisioning returns success with orphaned tenant. | temp file + renameSync; throw on failure. |
| SYN-13 | src/lib/tenant-db-manager.ts:369-372,155-162 | Medium | `TENANT_REGISTRY_KEY` unset ⇒ tenant superuser passwords PLAINTEXT in registry.json, default perms. | Require key (refuse persist) or always encrypt; mode 0o600. |
| SYN-14 | src/lib/catalog-sync.ts:106-108,150-157 | Medium | WA fetch error recorded but final log row still `status:'success'` ⇒ dashboards show a sync that never reached WhatsApp. | `status:'partial'/'failed'` when errors non-empty. |
| SYN-15 | src/lib/channel-pricing.ts:158-193 | Medium | `saveConfiguredChannels` commits local state before PB persist; on PB failure only `console.warn` ⇒ callers/listeners told save succeeded; other sessions diverge. | Persist first or roll back/throw. |

### 2.11 AI Assistant / API auth / OTP

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| AI-1 | src/lib/ai/net-guard.ts:11-33 | High | SSRF blocklist matches literal dotted IPv4/exact hosts only: decimal/hex IPv4, IPv4-mapped IPv6 (`::ffff:127.0.0.1` passes), trailing-dot `localhost.`, and public DNS resolving to 169.254.169.254 all bypass. | Resolve + range-check all IPs incl. mapped v4; strip trailing dot; canonicalize numeric IPv4; re-check after redirects. |
| AI-2 | src/lib/api-auth.ts:176-178 | High | Capability filter tolerates `account_email = ""` role rows for any tenant ⇒ legacy/malicious blank-tenant role link grants capabilities here. | Drop the `= ""` disjunct; backfill via migration. |
| AI-3 | src/lib/ai/tools/erp-write.ts:158-167 | Medium | `add_order_note` read-modify-write of `internal_notes` non-atomic ⇒ concurrent turns lose audit notes. | Atomic append / re-read+retry under conversation lock. |
| AI-4 | src/lib/otp-store.ts:202-218 | Medium | Verify attempt counter check-then-increment, no transaction ⇒ parallel verifies all read `attempts=N`, all pass; >5 guesses vs 6-digit code. | Atomic increment + post-increment limit re-check. |
| AI-5 | src/lib/otp-store.ts:95-146 | Medium | Cooldown/daily-limit read-then-write race ⇒ concurrent `generateAndSaveOtp` bypass MAX_DAILY_REQUESTS and 30s resend cooldown. | Atomic counters / per-phone mutex. |
| AI-6 | src/lib/ai/tools/erp-write.ts:93-122 | Medium | `create_customer` list→find→create non-atomic ⇒ duplicates on concurrent approved calls; no unique index. | Unique constraint on tenant-normalized phone; handle conflict. |
| AI-7 | src/lib/ai/tools/erp-write.ts:97 | Medium | `listRecords(...).catch(() => [])` ⇒ DB outage indistinguishable from "no customer" ⇒ duplicates created during outage. | Propagate real errors; only tolerate not-found. |
| AI-8 | src/lib/rate-limit.ts:84-89 | Medium | `clientKeyFromHeaders` trusts first XFF (client-controlled) ⇒ per-IP limits (incl. OTP) defeated by rotation; missing headers share one "unknown" bucket. | Last trusted proxy hop / trusted-proxy list. |
| AI-9 | src/lib/ai/sessions.ts:144-165 | Medium | `updateConversation` — NO account_email/created_by predicate, via superuser client ⇒ any caller-supplied conversationId mutates another tenant's conversation. | Fetch-verify scope (like archiveConversation). |
| AI-10 | src/lib/rate-limit.ts:38-44,66-83 | Medium | `check()` never prunes; pruned nowhere ⇒ unbounded Map growth per distinct key (XFF spoofing) on internet-facing routes. | Sampled prune in `check()` / size cap. |
| AI-11 | src/lib/ai/sessions.ts:225-253 (appendEvent); sessions.ts:144 | Medium | `appendEvent` writes events with caller-supplied conversationId without verifying conversation belongs to `input.accountEmail` ⇒ cross-tenant event injection (superuser-owned AI collections). | Verify conversation tenant before create. |
| AI-12 | src/lib/host-guard.ts:83-95 | Low | `classifyHost` defaults `trustLoopback !== false` ⇒ forgotten option + tunnel-rewritten Host ⇒ public visitor treated as admin (A-15 class). | Default trustLoopback=false. |
| AI-13 | src/lib/api-auth.ts:128-135 | Low | `constantTimeEqual` early-returns on length mismatch — leaks secret length via timing. | Compare SHA-256 of both inputs. |
| AI-14 | src/lib/ai/tools/erp-write.ts:70-72 | Low | `logAiMutation` failure only `console.warn` — mandatory AI audit trail (AI-SYS-11) silently vanishes while ERP write persists. | Surface in tool result/approval; queue/retry; metrics. |
| AI-15 | src/lib/ai/tools/pb-util.ts:112-114,132-134 | Low | `findRecordById`/`findFirstRecord` catch ALL ⇒ PB outage indistinguishable from absence; "No sales order found" during outage. | Swallow 404 only; rethrow rest. |

### 2.12 Settings / Backup / Manufacturing / Vendors / Discounts / Misc

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| SET-1 | src/lib/manufacturing-jobs.ts:24-29,170-187 | High | Tenant fail-open: falsy/`'default'` tenant ⇒ bare `key="manufacturing_jobs"`, one global store_settings blob shared by all tenants — jobs read/clobbered cross-tenant. | Fail closed (like settings.ts:202/backup.ts:112); require account_email on create. |
| SET-2 | src/lib/packing.ts:305-308,329-335,380-387 | High | `tenantFilter()` returns `''` ⇒ `fetchPackingSessions` unscoped read of all tenants' sessions (customer name/phone PII); hand-rolled `replace(/"/g)` under-escapes. | Fail closed; `sanitizeFilter`. |
| SET-3 | src/lib/discounts.ts:9-12,138,166,286,405,431,461 | High | Fail-open `tenantClause()` ⇒ unscoped `getDiscounts`/`getDiscountByCode`; POS `validateDiscount()` can price/redeem another tenant's coupon (money path). | Fail closed everywhere. |
| SET-4 | src/lib/settings.ts:197-199,171-173,236 | High | `razorpayKeySecret`/`razorpayWebhookSecret`/`phonepeSaltKey`/`shopifyToken` serialized into browser localStorage on save AND on every PB load; also plaintext in `store_settings.value`. XSS ⇒ live payment keys. | Never write secrets to localStorage/sync blob; encrypted tenant-secrets path only. |
| SET-5 | src/lib/backup.ts:262-322 (296-315) | High | Restore non-atomic: row-by-row create/update across 31 tables, no transaction/rollback; `.catch(() => null)` (:301) mis-routes update failures into create path; no pre-restore snapshot. | Transaction/batch or snapshot-and-rollback; distinguish 404 from transient errors. |
| SET-6 | src/lib/vendors.ts:9-12 (all readers) | Medium | Fail-open `tenantClause()` ⇒ cross-tenant vendor reads; `getVendorStats` sums purchase_orders across ALL tenants (financials leak). | Fail closed on unresolved tenant. |
| SET-7 | src/lib/vendors.ts:118-135,164-184 | Medium | `updateVendor`/`deleteVendor`/`updateVendorProduct`/`removeVendorProduct` by bare id — IDOR (superuser client per header note). | Re-fetch scoped, verify `account_email` first. |
| SET-8 | src/lib/discounts.ts:234,239,242-244 | Medium | `updateDiscount`/`deleteDiscount`/`toggleDiscountActive` bare id, no ownership check ⇒ cross-tenant coupon tampering. (`getDiscount` :154-156 does check.) | Same ownership check as getDiscount. |
| SET-9 | src/lib/manufacturing-engine.ts:236-239,241-249 | Medium | NaN bypasses `<= 0` / `< 0` / weight guards (NaN comparisons false) ⇒ NaN-cost orders pass validation; downstream `Number(x) \|\| 0` hides it ⇒ ₹0-cost or inconsistent stock deduction. | `!Number.isFinite(x)` rejection for every numeric guard. |
| SET-10 | src/lib/discounts.ts:292-295 | Medium | Per-customer coupon limit fail-open on `discount_usage` query error (`catch {}`) ⇒ hard cap silently unlimited. | Fail closed. |
| SET-11 | src/lib/discounts.ts:430-440 | Medium | `reverseDiscountUsage` — delete then decrement `used_count` in a loop, no per-row handling ⇒ partial failure burns coupons, never decrements. | Per-row try/catch + rollback; report failures. |
| SET-12 | src/lib/packing.ts:474-477,521-524 | Medium | `sales_order_items` reads unscoped — `getFullList` + `filter: variant="…"` scan every tenant (order ids exposed; counts merge across tenants). | `account_email` clause; fail closed. |
| SET-13 | src/lib/manufacturing-jobs.ts:170-187,216 | Medium | Jobs persisted as non-atomic read-modify-write JSON blob in ONE store_settings row ⇒ concurrent tabs lose jobs; `nextJobNumber` duplicates; `.slice(0,500)` silently drops history. | Real collection with atomic ops / transactional batch; report truncation. |
| SET-14 | src/lib/activity.ts:158-171,181-183 | Low | Fail-open audit write: unresolved tenant ⇒ `activity_logs` row with `account_email:''` (orphan); inner enqueue catch discards silently. | Skip/refuse create or local diagnostic; warn in catch. |
| SET-15 | src/lib/google-drive-sync.ts | Low | **File does not exist in the repo** — audit target missing; scope needs confirming (neighboring sync modules likely intended). | Confirm path or update scope/docs. |

---

## 3. Cross-Cutting Themes (Part 2)

| Theme | Where | Risk |
|---|---|---|
| Cross-tenant writes under superuser client | INV-1/3/6, RET-1, ORD-1/6, PUR-5/9, BNK-8, CUS-6, SYN-2/6, PAY-5, AI-9, SET-6/7/8, WA-15 | IDOR, money/stock manipulation, data leaks |
| Fail-open tenant helpers | discounts.ts:9, vendors.ts:9, manufacturing-jobs, packing.ts, whatsapp-crm withTenantFilter, channel readers, storefront :63 | Unscoped queries; arbitrary-tenant data |
| Secrets in browser/localStorage | settings.ts:197-199, razorpay.ts:35, phonepe.ts:40, whatsapp.ts:12, settings.ts:236 | XSS ⇒ gateway key theft |
| Non-atomic money/stock writes | WA-1/2, PAY-3/6/9, ORD-4/9, RET-2/5/7, BNK-1/4/12, SYN-9/11, PUR-2 | Double-spend, lost updates, phantom stock |
| Silent failure swallowing on money paths | INV-13, RET-6/7/9, PUR-13, BNK-15, CUS-14, RPT-2/3/4/5/12, PAY-4/8, SYN-15, SET-11 | Wrong numbers presented as valid |
| Fabricated compliance data | INV-8/9/10/11/12/14, RPT-10/11/12, ORD-11, RET-14 | GST/GSTR-1 filing rejection, false liability |
| Idempotency/retry gaps | WA-1/3/6/12, PAY-6/11, CUS-9, ORD-2, sequence-generator | Duplicate sales, payments, customers, doc numbers |
| Check-then-act races | AI-4/5/6, CUS-8/9/10, WA-6, BNK-2, PUR-3 | Quota bypass, duplicate rows, negative balances |

---

## 4. Combined Fix Priority (Part 1 + Part 2)

**P0 — Immediate (Critical, both reports):**
- [ ] A1 (Part 1) Remove `?force=true` setup bypass
- [ ] P1/P2/P3 (Part 1) POS server recompute, oversell abort, offline-queue dedupe
- [ ] I1 (Part 1) Negative-stock guard
- [ ] INV-1 / RET-1 / PUR-1 / BNK-1 / CUS-1 / WA-1 / PAY-1 / SYN-1 — tenant-scope writes; PO double-GST total; cheque double-post; loyalty cross-tenant redeem; clearing double-deposit; payment-secret theft; tenant-DB port race
- [ ] SET-4 — strip secrets from localStorage/settings cache/sync blob

**P1 — Next sprint:**
- [ ] INV-2..6 (invoice tax lines, payment ledger order, overpay, verbatim totals, e-way NIC call)
- [ ] RET-2..9 (refund race/full-amount reversal/loyalty clawback/rollback/over-return/restock)
- [ ] PUR-2..7 (GRN stock push order, GRN/PO rollback, PO tenant checks, history scope)
- [ ] PAY-2..7, WA-2..9 (webhook order, settlement retry, refund integrity, anti-ban fail-closed, opt-out, catalog-sync abort)
- [ ] SYN-2..7 (channel-stock tenant scope, storefront binding, activate=false, module-global pricing)
- [ ] CUS-2..7 (points atomicity, consent fail-closed, IDOR customers)
- [ ] RPT-1/2/3 (today-KPI, GSTR-1 fetch zeros, empty canonical set)

**P2 — Backlog:** everything rated Medium/Low in both reports (see section 4 of Part 1 and tables above) — primarily silent-failure surfacing, filter sanitization, rounding to paise, GST classification correctness, config/atomicity nits.

---

## 5. Audit Stats & Scope

| Report | Domains | Findings | C | H | M | L |
|---|---|---|---|---|---|---|
| Part 1 (`BUG_AUDIT_REPORT_2026-11-04.md`) | Auth/RBAC, POS, Inventory | 45 | 4 | 23 | 16 | 2 |
| Part 2 (this file) | Invoices/GST, Orders/Challan, Returns, Purchase/GRN, Banking/Cheques/Expenses/Multi-loc, Customers/Loyalty/CRM, Reports/Analytics/GSTR-1, WhatsApp/Recon, Payments/Webhooks, Sync/Tenant-DB, AI/OTP/API-auth, Settings/Backup/Misc | 180 | 8 | 69 | 89 | 14 |
| **Combined** | **15 of ~17** | **225** | **12** | **92** | **105** | **16** |

**Not audited:** WPPConnect sidecar internals (`wppconnect-sidecar/server.js`, Puppeteer layer), Rust Tauri core (`src-tauri`), runtime behavior, PocketBase API rules/migrations, and `src/lib/google-drive-sync.ts` (missing — see SET-15). Remaining thin coverage: `src/app/` page components beyond spot-checks, `src/components/`, sync connectors under `src/lib/sync/` (does not exist), `src/lib/niththigal-content.ts`, `src/lib/imitation-jewelry-engine.ts`, `src/lib/jewelry-engine.ts`, `src/lib/cross-border-engine.ts`.

**Limitations:** Static audit only; PocketBase rules, migrations and live runtime were not executed. Severity reflects exploit/data-loss potential as read, not verified in a deployed instance. Line numbers reflect the tree at audit time (2026-11-04).

## 6. Verify After Fixing

```bash
npm run typecheck
npm test   # test-invoice-math, test-returns-policy, test-offline-queue, test-tenant-auth, test-customer-token, test-pos-quantity
```

Manual checks: refund a partial return (points/spend must prorate); pay less than an invoice balance via reconciler (must stay `partial`); kill the WA sidecar mid-sync (no mass create calls); open two tabs on `/banking` and exceed the balance (second debit must fail); `/reports/gst` with PB down (error banner, not ₹0.00).

---

# Part 3 — Continuation Audit (Waves 4–7): previously unaudited surface

**Added:** 2026-11-04 (same session). Waves append as agents finish. Method unchanged.
**New findings so far:** 45 (Wave 4 = 15 each × 3)

## 7. Wave 4 Findings (AI remainder · WhatsApp commerce remainder · Core infra)

### 7.1 AI Assistant remainder (agent-loop, providers, SSE, erp-read)

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| AI-16 | src/lib/ai-client.ts:42; providers.ts:219-224 | High | Tenant scope from browser `x-tenant-email` header, applied verbatim as PB filter — any server trusting it lets one tenant read/replace another's provider rows (incl. api keys). | Derive accountEmail server-side from verified session; never from a header. |
| AI-17 | src/lib/ai/openai-compatible.ts:163-171,387; :532,546 | High | `assertHttpUrl` checked only on initial URL; fetch follows redirects ⇒ public provider URL can 302 to `169.254.169.254`/RFC-1918 — SSRF guard defeated. | `redirect: 'manual'` or revalidate every hop; pin protocol+host. |
| AI-18 | src/lib/ai/providers.ts:404-414 | Medium | `markProviderTested` updates `ai_providers` by id alone — no tenant clause ⇒ cross-tenant flip of `last_test_ok`/`updated`. | Filter by `{id, account_email}` or fetch-verify first. |
| AI-19 | src/lib/ai/harness.ts:21-29,61-64 | Medium | Analyst profile `allowedTools: '*'`; `profileAllowsTool` ignores `allowWrites` — write-exclusion depends entirely on out-of-file registry gate; prompt-injected model reaches write policy if that unseen caller misbehaves. | `profileAllowsTool` returns false for kind=write when `!allowWrites`; assert in-loop. |
| AI-20 | src/lib/ai/providers.ts:45-52; openai-compatible.ts:188-190 | Medium | Schema accepts `http://` provider base URLs; transport sends `Authorization: Bearer <key>` in cleartext. | Require https for non-loopback hosts. |
| AI-21 | src/lib/ai/agent-loop.ts:414-422; chat-stream.ts:109-112; events.ts:327-336 | Medium | Raw internal `error.message` (may embed collection names/filter strings/record data) emitted via SSE and persisted in `turn/end`, rendered into transcript. | Map to safe codes client-side; log server-side; redact before persisting. |
| AI-22 | src/lib/ai/agent-loop.ts:393-402 | Low | On approval-await, loop breaks; other already-selected executable calls neither executed nor denied nor policy-checked — linger as unresolved pending approvals never shown. | Deny/park remaining calls with explicit `approval/request` before break. |
| AI-23 | src/lib/ai/erp-read.ts:101-103,161 | Low | `currencySummary('')` — hardcoded literal ⇒ store overview always reports INR. | Pass real store currency or drop field. |
| AI-24 | src/lib/ai/erp-read.ts:574-577 | Low | `get_record_details` spreads full record minus collectionId/Name — internal/cost/supplier fields leak into model context + event log. | Explicit allow-list projection for model consumption. |
| AI-25 | src/lib/ai/agent-loop.ts:290-305 | Low | Consent-audit (`approval/decision`) appended only for write calls; read calls auto-execute with no decision record. | Log a decision row for every resumed pending call. |
| AI-26 | src/lib/ai/sse.ts:331-338; openai-compatible.ts:505-517 | Low | Non-streaming provider error discarded by transport, rethrown as generic 'response could not be read' — quota/model errors undiagnosable (streaming path redacts correctly). | Throw AiProviderError with redacted bodySnippet. |
| AI-27 | src/lib/ai/providers.ts:367-375,390-414 | Low | Default-flip/promotion/`markProviderTested` failures `.catch(() => null)` ⇒ multiple/zero defaults or stale test status, no signal. | Await+surface; default-invariant in one transaction. |
| AI-28 | src/lib/ai/sse.ts:123-128 | Low | `encodeSseEvent` writes `event: ${event}` unsanitized — future user-influenced event names enable SSE injection. | Restrict to `/^[a-z0-9_-]+$/i` or allow-list. |
| AI-29 | src/lib/ai-client.ts:169-181 | Low | Server SSE events cast `as AiStreamEvent` with no validation — broken/malicious server can forge `done` (truncates UI) or fake `approval_request`. | Validate frame.event against known names; minimal data check. |
| AI-30 | src/lib/ai/providers.ts:97-101 | Low | AI provider keys decryptable with `TENANT_REGISTRY_KEY` when `AI_SECRET_KEY` unset — cross-purpose shared key widens blast radius of registry-key compromise. | Require dedicated `AI_SECRET_KEY`; drop fallback. |

### 7.2 WhatsApp commerce remainder (catalog, flash-drops, order-ingestion, notifications, binding)

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| WA-16 | src/lib/whatsapp-catalog.ts:76-78,88 | High | No tenant session ⇒ bare `is_active = true` fallback — unscoped getFullList dumps every tenant's products/stock. Fail-open. | Return []/throw when `!tenantEmail`. |
| WA-17 | src/lib/whatsapp-catalog.ts:290-297 | High | `getWhatsAppCatalogInventory(tenantEmail?)` param optional; omitted ⇒ unscoped getFullList of all products/variants across tenants. | Require tenantEmail or default to `getCurrentTenantEmail()`; refuse unscoped list. |
| WA-18 | src/lib/whatsapp-flash-drops.ts:199-204 | High | `belongsToTenant` true for rows with empty `account_email` regardless of mode — contradicts own comment; gates getFlashDrop/update/complete ⇒ cross-tenant drop/reservation access. | Honor `isSingleAccountMode()`; deny unowned rows otherwise. |
| WA-19 | src/lib/whatsapp-notifications.ts:105,201 | High | `isWhatsAppOptedOut(phone)` called WITHOUT the `db` arg used elsewhere (:51,:155); review-request fn has no `db` param ⇒ consent check hits wrong/unauthenticated client ⇒ opt-out bypass. | Pass `db` through; add `db` param. |
| WA-20 | src/lib/whatsapp-order-ingestion.ts:107 | Medium | idempotencyKey = `CATALOG-`+sanitized message.id; missing id ⇒ constant `"CATALOG-"`; ids differing only by stripped chars collide ⇒ wrong order returned as duplicate. | Hash full id (SHA-256); bail when missing. |
| WA-21 | src/lib/whatsapp-notifications.ts:42,96,194,150 | Medium | `sales_orders.getOne`/`customers.getOne` unscoped — relies on PB rules; under server/superuser client, cross-tenant orders/customers read & notified. | Tenant filter or verify `order.account_email`. |
| WA-22 | src/lib/whatsapp-flash-drops.ts:538-543 | Medium | `completeFlashDropReservation` no status guard — expired/cancelled hold flippable to `completed`; read→update non-atomic (TOCTOU). | Update with `status="active"` filter; re-verify in same txn. |
| WA-23 | src/lib/whatsapp-catalog.ts:304-311 | Medium | `setWhatsAppCatalogPrice` non-atomic read-modify-write of `channel_prices` JSON; no tenant check on productId. | Atomic JSON merge + verify product tenant. |
| WA-24 | src/lib/whatsapp-binding.ts:52,113,167 | Medium | `userEmail` interpolated raw into PB filter; `sanitizeFilter` imported but unused at these sites ⇒ filter injection/parse breakage. | Wrap with `sanitizeFilter`. |
| WA-25 | src/lib/whatsapp-binding.ts:106-139,160-182 | Medium | localStorage written BEFORE PB persist; PB failure only console.error — returns new binding anyway (success-shaped); client/server diverge. | Persist PB first; skip localStorage on error; surface failure. |
| WA-26 | src/lib/whatsapp-flash-drops.ts:640-674 | Medium | Broadcast to arbitrary `targetJids` with NO opt-out/consent check; checkout URL embeds raw `account_email` query param — tenant email leaks into chat logs/history/analytics. | Consent-check per JID; pass drop token/slug, resolve server-side. |
| WA-27 | src/lib/whatsapp-catalog.ts:164,322,335 | Low | Write failures swallowed: `.catch(() => {})` on catalog_id update/markSynced/unlink — sync state silently lost. | Return/throw status; count as failed in batch result. |
| WA-28 | src/lib/whatsapp-catalog.ts:119-122 | Low | Any fetch error ⇒ `[]` — empty catalog indistinguishable from "no publishable products"; sync proceeds against nothing. | Throw or Result type; abort sync on error. |
| WA-29 | src/lib/whatsapp-notifications.ts:169 | Low | `formatINR(balance)` prints raw loyalty points as ₹ — unit mismatch overstates customer value. | Divide by points-per-₹ or label as points. |
| WA-30 | src/lib/whatsapp-flash-drops.ts:558-560 | Low | `Math.round((originalPrice-dropPrice)/originalPrice*100)` — dropPrice > originalPrice ⇒ negative "Save -N%"; no lower clamp. | `Math.max(0,…)`; reject dropPrice > originalPrice on input. |

### 7.3 Core infra (pocketbase singleton, snapshots, CSV, deployment-mode, host-guard)

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| INF-1 | src/lib/pocketbase.ts:214-231 | **Critical** | `ensureServerAuth` mutates module-level shared client (`pb.baseUrl = targetUrl; pb.authStore.clear()` + re-auth). Concurrent tenant requests interleave ⇒ A's queries hit tenant B's DB with B's credentials. | Always `createTenantClient()`; retire shared-client mutation. |
| INF-2 | src/lib/pocketbase.ts:71-78 | High | `resolveTenantRuntime`: missing email ⇒ `registry.activeTenantEmail` fallback; unknown tenant ⇒ `fallbackUrl` + env superuser creds — superuser access to primary DB for any email string. | Never cross-scope fallback; error on missing tenant; drop activeTenantEmail fallback. |
| INF-3 | src/lib/pocketbase.ts:216-252,249-257 | High | Fall-through leaves `pb.baseUrl` as stale tenant URL; then authenticates env superuser creds against that tenant DB (wrong-tenant superuser). | Always restore primary URL + clear authStore on fall-through. |
| INF-4 | src/lib/pocketbase.ts:85-94 | High | `authenticateTenantClient` swallows all auth failure (`_superusers`→`users`→`.catch(()=>{})`; `!email` silent return) ⇒ unauthenticated client, no signal. | Throw on auth failure; fail closed. |
| INF-5 | src/lib/pocketbase.ts:352-355,423-427,273-301 | High | `pbUrl` from `/api/system/tenant-db` used via `setPocketBaseUrl` with NO origin/scheme allowlist — hostile response/LAN MITM re-points client; passwords + superuser tokens sent to attacker origin. | Validate pbUrl (https or loopback/LAN-http only); reject off-origin in prod. |
| INF-6 | src/lib/database-snapshot.ts:42-49 | High | Every collection read `.catch(() => [])` — auth/permission/network failure = "empty DB"; partial/zero-row backup silently trusted. | Propagate; mark snapshot incomplete; never swallow. |
| INF-7 | src/lib/pocketbase.ts:171-185 | Medium | `beforeSend` injects `account_email` only when ABSENT — client can POST forged `account_email` verbatim; no defense-in-depth for PATCH reassignment. | Always overwrite with verified `accountScopeEmail()`. |
| INF-8 | src/lib/database-snapshot.ts:12,51-56 | Medium | Secret redaction keyed on name regex only — secrets under benign keys export in cleartext. | Redact by value pattern too / allow-list keys. |
| INF-9 | src/lib/host-guard.ts:99-107,16-17,25-27 | Medium | Storefront prefix check, no path normalization: `/tracking/../api/…` or encoded `..` passes if proxy doesn't normalize ⇒ ERP API routes exposed on public host. | Normalize/decode before policy; reject raw `..`/backslashes. |
| INF-10 | src/lib/pocketbase-url.ts:37-38 | Medium | `PB_CUSTOM_URL` honored before any protocol/host checks, even on https pages — injected `http://attacker` re-points all API traffic off-origin. | On https pages, ignore overrides not on deployment origin. |
| INF-11 | src/lib/pocketbase.ts:589-595 | Medium | `getCurrentTenantEmail()` returns literal `"default"` when unauthenticated ⇒ shared `key_default` storage namespace across accounts on shared browsers. | Return ""/throw; hash email only when present. |
| INF-12 | src/lib/deployment-mode.ts:39-43 | Medium | Asymmetric mode resolution (client `NEXT_PUBLIC_TENANT_MODE=multi` vs server `TENANT_MODE`) ⇒ split-brain: records stamped with identity server rules reject/mis-scope; tenant isolation silently broken. | One source; refuse on client/server mismatch. |
| INF-13 | src/lib/csv.ts:38,31 | Medium | Header split by plain `.split(",")` — quoted commas misalign all columns; embedded newlines shatter rows ⇒ wrong SKU/price/stock imported. | Parse header with `parseCSVLine`; quote-aware line splitting. |
| INF-14 | src/lib/pocketbase.ts:190-204 | Medium | `ensureAuth` saves parsed.token, returns true without re-checking `authStore.isValid` — expired/garbage localStorage token = "active session". | Re-check isValid; clear store on failure. |
| INF-15 | src/lib/csv.ts:176-185 | Low | Formula-injection guard is `^`-anchored — leading space/control before `=+@-` not neutralized. | Trim leading whitespace/controls before trigger check. |

## 8. Wave 5 Findings (Business-logic libs · Campaigns/engines misc)

### 8.1 Remaining business libs (chat-sales, sku-gen, attributes, categories, inventory-feed, item-cost, discrepancies, quick-*)

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| BIZ-1 | src/lib/discrepancies.ts:75,86 | **Critical** | `markStockDiscrepancy` fetches `product_variants.getOne` with NO tenant check, then deducts `stock_level-` — any signed-in tenant can zero another tenant's variant stock. | Tenant filter/ownership verify before deducting. |
| BIZ-2 | src/lib/categories.ts:96,106; attributes.ts:90,100 | High | `update/deleteCategory`/`update/deleteAttribute` by raw id, no tenant check — cross-tenant modify/delete. | Scope by `account_email` or getOne+check (like getCategory :67-71). |
| BIZ-3 | src/lib/chat-sales.ts:222-233 | High | Customer profile `getOne(input.customerId)` zero tenant verification — another tenant's address/GSTIN/company read into this order; foreign id linked to order. | Verify `profile.account_email === tenantEmail`. |
| BIZ-4 | src/lib/chat-sales.ts:102-118,490-492 | High | `existingOrderResult`/`findChatSaleByRef` no `account_email` clause; `order_number = ORD-WA-<key>` caller-controlled key — tenant A retry returns tenant B's orderId/total/paymentUrl. | Add sanitized tenant clause to both filters. |
| BIZ-5 | src/lib/discrepancies.ts:76-87 | High | Availability checked then non-atomic decrement — concurrent flags both pass, stock negative. | Atomic conditional decrement / transaction. |
| BIZ-6 | src/lib/discrepancies.ts:85-106 | High | Stock decremented (step 2) BEFORE `stock_discrepancies` record (step 3); create throws ⇒ stock gone, no quarantine, no comp. | Create record first or try/catch restore `stock_level+`. |
| BIZ-7 | src/lib/attributes.ts:168-178 | High | `deleteProductAttributeValues` raw `productId` interpolation (`product="${productId}"` injection), drops tenant clause, catch only logs — callers see success while values persist. | `sanitizeFilter` + `tenantClause()`; rethrow/return error. |
| BIZ-8 | src/lib/sku-generator.ts:381-407 | Medium | read-max-then-insert, no lock — concurrent creates get duplicate SKUs; lookup failure silently returns `fallbackSeq` (:405) guaranteeing collisions. | Unique SKU index + retry; fail loudly, no fallback. |
| BIZ-9 | src/lib/chat-sales.ts:409-424 | Medium | `sale_items` inserts `.catch(() => {})` after parent `sales` mirror succeeded ⇒ mirror sale with missing lines, silent. | Collect failures, surface/log with sale id, or compensate (delete mirror). |
| BIZ-10 | src/lib/item-cost.ts:68,85,94,106 | Medium | `tenantEmail` interpolated into 4 filters unsanitized; products fetch with NO productId filter (full table per cost lookup). | `sanitizeFilter`; filter by requested productIds. |
| BIZ-11 | src/lib/sku-generator.ts:426-429,469-472; quick-add-memory.ts:220-222,273-275 | Medium | Raw `tenantEmail` interpolated in `store_settings` filters unsanitized. | `sanitizeFilter(tenantEmail)`. |
| BIZ-12 | src/lib/server-pricing.ts:25 | Low | Fallback filter interpolates raw `email` unsanitized in server-side pricing path. | Sanitize or always require parameterized `client.filter`. |
| BIZ-13 | src/lib/inventory-feed.ts:23-47 | Medium | Realtime subscriptions have NO tenant filter — every tenant gets all products/variants/GRN/PO/discrepancy events; `unsubscribe('*')` per collection tears down other components' subscriptions. | Tenant-scoped subscription filter; per-callback unsubscribe handles. |
| BIZ-14 | src/lib/discrepancies.ts:181-227 | Medium | Partial resolve not serialized (own comment admits): two concurrent partials both read quantity=N, both write remainingQty, both `stock_level+` — double-credit sellable stock. | Conditional atomic `quantity >= restored`; abort/retry on mismatch. |
| BIZ-15 | src/lib/quick-product.ts:228-247 | Medium | createDraftProduct: product then variants, no compensation — mid-loop failure leaves orphan partial draft; movement log warn-only. | try/catch delete created product/variants; movement failure fatal or queued retry. |

### 8.2 Campaigns / engines / integrations misc (meta-catalog, image-matcher, gstin, jewelry, cross-border)

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| ENG-1 | src/lib/image-matcher.ts:103-105 | High | Empty `accountScopeEmail()` ⇒ `tenantClause=''` — ALL tenants' products/image hashes fetched for matching. | Require tenant; throw/return [] when absent. |
| ENG-2 | src/lib/meta-catalog-batch.ts:45-49 | High | `x-forwarded-host/proto` reflected unvalidated into `image_link`/`link` to Meta — spoofed Host poisons every catalog entry (only localhost excluded). | Whitelist forwarded host vs env/request host. |
| ENG-3 | src/lib/meta-catalog-batch.ts:154,127 | High | `image_link` embeds `account_email=${encodeURIComponent(email)}` — tenant PII sent to Meta, visible to anyone with the URL; default `''` yields `account_email=` silently. | Opaque product/tenant ID; make tenantEmail required. |
| ENG-4 | src/lib/eway-bill-settings.ts:122-131,46 | High | `testEwayBillConnection` uses `getEwayBillConfig(true)` ⇒ server-decrypted clientSecret/password pulled INTO the browser just to test auth — plaintext secrets cross the wire unnecessarily. | Server-side test endpoint on stored secrets; never `reveal` for a test. |
| ENG-5 | src/lib/cross-border-engine.ts:200-205,146-147 | High | LUT export invoices generated with placeholder statutory data: `arnNumber: 'LUT-UNASSIGNED'`, default `portCode: 'INBLR4'`, "APPLIED" declaration — non-compliant legal document, no error. | Throw when `isLutExport && !lutArnNumber`; never default port code. |
| ENG-6 | src/lib/campaign-attribution.ts:258-265 | High | `recordCampaignConversion` read-modify-write on orders_converted/attributed_revenue, no atomicity — concurrent attributed orders lose increments; revenue totals diverge; no isFinite check. | PB atomic increment/server hook; validate `Number.isFinite`. |
| ENG-7 | src/lib/jewelry-engine.ts:167 | Medium | Per-gram making charges computed on `grossWeight` (stone weight included) while metal value uses net+wastage — customer billed making on stone grams. | Base per_gram making on net/effective weight. |
| ENG-8 | src/lib/cross-border-engine.ts:157-158,166 | Medium | `unitForeign = round(inr/rate)` then `lineForeign = qty*unitForeign`; subtotal accumulates — double rounding; statutory invoice's two currencies don't reconcile. | Round only final line/totals; assert `foreign ≈ inr/rate`. |
| ENG-9 | src/lib/imitation-jewelry-engine.ts:169-181 | Medium | Wholesale tiers unvalidated: `discountPercent > 100` ⇒ negative unitPrice; `Math.max(1, NaN)` ⇒ NaN totals; last array entry wins over best tier. | Validate/clamp tiers (0-100, min≤max, sorted); NaN guard. |
| ENG-10 | src/lib/campaign-attribution.ts:105,109-111,160-162 | Medium | PB errors swallowed (`catch {}`) ⇒ silent fallback to localStorage/`cmp_*` rows; PB-down ⇒ deleted campaigns shown, new ones never sync. | Fall back only on 404; surface other errors. |
| ENG-11 | src/lib/campaign-attribution.ts:266-268 | Medium | PB update failure swallowed, no log — local count incremented, server never updated; permanent analytics drift. | Log/queue retry; report degraded state. |
| ENG-12 | src/lib/omnichannel-buffer-engine.ts:126-128,141-173 | Medium | CartReservationManager in process memory only — restart loses all holds; multi-instance counts zero cross-instance reservations, overselling guarantee defeated. | Shared store (PB/Redis) with same TTL semantics. |
| ENG-13 | src/lib/campaign-attribution.ts:240 | Medium | `catch {}` conflates "no match" with network/permission/filter errors — attribution silently skipped on outages. | Catch only 404; log/throw others. |
| ENG-14 | src/lib/gstin.ts:12 | Low | GSTIN regex allows `[1-9A-Z]` at pos 14 — spec mandates literal `Z`; wrong-Z GSTIN with consistent mod-36 check passes `isValidGstin`. | Literal `Z`; range-check state code 01-38. |
| ENG-15 | src/lib/campaigns.ts:49-52 | Low | Any find/create failure ⇒ warn + `null` — orders silently unattributed, no caller signal; getFirstListItem→create race duplicates campaigns. | Typed failure/throw; upsert/unique-index handling. |

## 9. Wave 5b Findings (analytics-v2 remainder)

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| AN2-1 | snapshots.ts:124-126 | High | `oldRows` fetch `.catch(() => [])` ⇒ existingByKey empty ⇒ all rows create(); unique index rejects ⇒ writes fail silently, span half-written, `written` undercounted, no error to caller. | Abort/throw on error; keep prior snapshot intact. |
| AN2-2 | profitability.ts:201,209-211 | High | Expense-overlay catch keeps default `{total:0, operatingResult: margin}` ⇒ operating result silently overstated (expenses invisible), only console.warn. | `operatingResult: null`/flag or rethrow. |
| AN2-3 | snapshots.ts:157-159 | High | Per-row delete failures swallowed ⇒ stale day×category rows survive rebuild, summed by `getSnapshotSeries` — revenue double-counted/inflated, zero signal. | Count/collect failures; surface or fail rebuild. |
| AN2-4 | snapshots.ts:125 | Medium | Tenant interpolated unsanitized (`account_email="${tenant}"`) vs sanitizeFilter used at :42 ⇒ malformed/injected filter for quote-emails. | `sanitizeFilter(tenant)`. |
| AN2-5 | snapshots.ts:125 | Medium | Bounds from `startISO.slice(0,10)` (UTC date) vs local `dayKey` ⇒ stale-row cleanup can miss first local day ⇒ duplicates on create. | Derive bounds from `win.current.days[0]`/last. |
| AN2-6 | range.ts:63-73,99-110,126-130 | Medium | `cursor + 86_400_000` across DST lands 23:00/01:00 ⇒ duplicate/skipped `dayKey`; preset starts same off-by-one. | Local-day arithmetic `new Date(y,m,d+1)`. |
| AN2-7 | profitability.ts:162-168 | Medium | Previous-month overlay aligned by index — different-length windows misalign; wrong month's margin attributed. | Align by month offset / drop when not corresponding. |
| AN2-8 | insights.ts:111-118 | Medium | `overallDelta` ÷ abs(previous); near-zero/negative previous explodes (−2→−30 ⇒ −1400%) ⇒ 'high'-severity card with ₹28 impact. | Gate on absolute ₹ floor + signed previous. |
| AN2-9 | category-metrics.ts:78-81 | Medium | `price = gross/qty` ≤0 (refunds) falls through `\|\| bands[last]` into '₹2L+' band — refunds counted as luxury sales. | Clamp negatives to first band / returns bucket; no last-band fallback. |
| AN2-10 | snapshots.ts:63-67 | Medium | Any read error ⇒ `[]` ⇒ callers see "no snapshots", silently fall back to live — outage/migration-missing indistinguishable from empty; staleness invisible. | Distinguish empty vs error; throw or `{rows,error}`. |
| AN2-11 | snapshots.ts:100-119 | Low | Days with transactions but zero line rows emit no `agg` entry ⇒ ordersByDay never written ⇒ snapshot orders undercounted vs live. | Emit per-day orders-only row (''/'__orders__'). |
| AN2-12 | insights.ts:55-57 | Low | Overstock card emitted when `overstock.length > 0` even if `overstockValue === 0` ⇒ "₹0 parked" — violates no-fake-insights rule. | Require `overstockValue > 0`. |
| AN2-13 | insights.ts:107-110 | Low | Revenue share denominator Σtrend = 0 ⇒ `row.revenue / 0` ⇒ Infinity/NaN; `NaN < 0.15` false ⇒ spurious margin-drop card passes gate. | Guard denominator >0; skip on NaN. |
| AN2-14 | range.ts:157-161 | Low | `deltaPct(previous===0)` returns flat 100 for any current>0 — ceiling misleading; sign inverts for negative previous. | Return null sentinel or clamp; sign by |prev|. |
| AN2-15 | insights.ts:96 | Low | D4 impactINR sums full-period revenue of reorder-soon items — grossly overstates at-risk value (not lost revenue). | Velocity × price × weeks-out, or drop impactINR. |
| AN2-16 | range.ts:64-72 | Low | 400-entry guard silently truncates `days[]` for >400d custom ranges while ISO span is full — trailing days silently dropped. | Throw/log on over-cap span. |

## 10. Wave 6 Findings (page layer — money pages)

| # | File:Line | Severity | Issue & evidence | Fix |
|---|-----------|----------|------------------|-----|
| PG-1 | src/app/pos/page.tsx:1140,1193-1194 | High | `isProcessingRef` set only AFTER two awaits (stock assert + loyalty validation) ⇒ double-click/F12 race: both reach createPOSSale; `redeemPoints`/`earnPoints` run twice ⇒ double loyalty redemption/credit. | Set `isProcessingRef.current = true` synchronously at entry; reset in finally. |
| PG-2 | src/app/pos/page.tsx:790-798,1262,1369 | High | `clearCart()` resets cart/discount/points but NOT selectedCustomer(Id) ⇒ walk-in sale after a customer sale accrues loyalty to the previous customer. | Also `setSelectedCustomer(null)` in clearCart (parkCart already does :1011-1012). |
| PG-3 | src/app/pos/page.tsx:790-798,2152-2176 | Medium | clearCart leaves `cashTendered` ⇒ next cash sale pre-filled; change computed from stale tender ⇒ wrong change shown/recorded. | `setCashTendered("")` in clearCart. |
| PG-4 | src/app/pos/page.tsx:2257,867-875,1262 | Medium | Receipt `gstIncluded` from live `cart`; clearCart empties it before receipt renders ⇒ "GST included" prints ₹0. | Snapshot gstIncluded into lastTransaction at sale time. |
| PG-5 | src/app/pos/page.tsx:1300-1305 | Medium | PhonePe path: only stale client-side cart-stock check; cash path uses server assert ⇒ oversell caught late/never if createPOSSale doesn't reject. | Re-run `assertStockAvailable` in handlePhonePeSuccess. |
| PG-6 | src/app/invoices/create/page.tsx:382-384,832-846 | Medium | `discount_percent` no 0-100 clamp; `unit_price` no floor ⇒ discount 150 ⇒ negative taxable ⇒ negative totals/GST. | Clamp discount [0,100], price ≥0. |
| PG-7 | src/app/invoices/detail/page.tsx:180-184 | Medium | Payment validates only `amount > 0`; no cap vs balance_due/confirm ⇒ overpay. | Reject/confirm > balance_due. |
| PG-8 | src/app/purchase/create/page.tsx:938 | Medium | `parseInt(...) \|\| 1` keeps negatives ⇒ negative line/PO totals (min=1 not enforced). | `Math.max(1, parseInt(...) \|\| 1)`. |
| PG-9 | src/app/purchase/create/page.tsx:363,1010 | Low | Discount uncapped ⇒ discount > base ⇒ negative PO total. | Clamp discountAmount ≤ subtotal/budget. |
| PG-10 | src/app/returns/create/page.tsx:92-99 | Medium | `max_qty` seeded from invoice line qty, ignoring prior credit notes ⇒ UI over-commit; misleading refund total. | Subtract already-returned qty per line. |
| PG-11 | src/app/returns/detail/page.tsx:135-149 | Medium | `loadCreditNote` no try/catch/finally ⇒ rejection leaves `loading=true` forever; unhandled rejection; actions on stale/no data. | try/catch + `finally setLoading(false)` + toast. |
| PG-12 | src/app/returns/detail/page.tsx:214-218 | Medium | `handleAddExchangeItem`: new lines stock-checked, incrementing existing line re-checks nothing ⇒ replacement qty can exceed stock. | Validate `existing.quantity + selectedVariantQty <= v.stock`. |
| PG-13 | src/app/purchase/detail/page.tsx:265-276 | Low | `setShowCancelConfirm(false)` runs even when cancel throws ⇒ failure looks like success. | Move into try block. |
| PG-14 | src/app/banking/page.tsx:74-89,272-281 | Low | Account create: account_number optional, IFSC unchecked, `parseFloat` negatives ⇒ junk accounts/negative opening balance. | Require acct no + IFSC regex; clamp ≥0. |
| PG-15 | src/app/invoices/create/page.tsx:368-394 | Low | `updateItem` mutates shallow copy in place ⇒ previous state object mutated; breaks memo assumptions/stale renders. | New object per item. |

## 11. Wave 7 (pending): remaining pages · components · sidecar/Tauri

*Will be filled on completion.*

---
*Report generated 2026-11-04. Method: one feature per agent, max 3 concurrent, file:line-verified only. Part 1 remains the reference for Auth/POS/Inventory.*
