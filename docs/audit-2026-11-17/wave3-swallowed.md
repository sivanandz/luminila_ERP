# Wave 3 — Swallowed write failures (false success / half-applied writes)

Date: 2026-11-17
Scope: `src/lib` and `src/app/api` only. No pages/components read (callers cited from `findstr`). Prior wave reports were checked for overlap; findings already reported in waves 1–2 are not repeated here (notably `orders.ts:453-455` status swallow → wave2 O-05, `cycle-count.ts` audit swallow → wave1 S-07/S-14, `returns.ts` partial restock → wave1 S-04, `razorpay-webhook-handler.ts:304` notify marker → wave2 W-02).

Definition used: a WRITE (create/update/delete, stock level, money row, order/invoice status, ledger row) whose failure is swallowed or converted to a benign value, after which the caller continues and reports success, or leaves a half-applied state. Reads that degrade gracefully are excluded.

Counts: **0 Critical, 5 High, 8 Medium, 7 Low.**

---

### SW-01 [HIGH] Exchange completes and returns success with its tax invoice still `pending` — `src/lib/returns.ts:1353`

**What the code does**
```ts
await pb.collection('invoices').update(exchange.invoiceId, {
    status: 'paid',
    is_paid: true,
    paid_amount: exchange.grandTotal,
}).catch((err) => console.warn('Could not mark exchange invoice paid:', err));
```
The invoice is created at `:1335`, the balance payment row is created at `:1340-1349`, then the status update above is swallowed. The code continues to `credit_notes.update(..., { status: 'exchanged' })` (`:1376`) and returns the exchange result (`:1423-1433`).

**Why wrong**
Concrete sequence: replacement value ₹25,000, credit note ₹20,000, customer pays the ₹5,000 balance. `invoice_payments.create` succeeds; the invoice status update fails (timeout/validation) and is ignored; the credit note is marked `exchanged`. Result: an `invoice_payments` row exists for ₹5,000, but the exchange invoice still reads `pending`, `is_paid=false`, `paid_amount=0`. The invoices page and AR reports show ₹25,000 still due, the operator is invited to "Record Payment" again, and the customer can be dunned for money already collected. The credit note says the exchange is settled, so the two records contradict each other.

**Evidence**
- Search hit: `src\lib\returns.ts:1353` (`.catch((err) => console.warn('Could not mark exchange invoice paid:', err))`).
- Caller trace: `processExchange` is called by `src/app/returns/detail/page.tsx:266`; the function's normal return is the success payload at `:1423`, with no error flag for this failure.

**Minimal fix**
Remove the `.catch`; let the update throw so `rollbackExchange` restores the credit note and the caller reports failure. Or track `invoiceMarkedPaid` and include it in the rollback.

**Confidence:** confirmed from code.

---

### SW-02 [HIGH] Customer delete fails open when the purchase-history checks error — `src/lib/customers.ts:219`

**What the code does**
```ts
const [sales, orders, invoices] = await Promise.all([
    pb.collection('sales').getList(1, 1, { filter: `customer="${safeId}"` }).catch(() => null),
    pb.collection('sales_orders').getList(1, 1, { filter: `customer="${safeId}"` }).catch(() => null),
    pb.collection('invoices').getList(1, 1, { filter: `customer="${safeId}"` }).catch(() => null),
]);
if ((sales && sales.totalItems > 0) || (orders && orders.totalItems > 0) || (invoices && invoices.totalItems > 0)) {
    throw new Error('This customer has purchase or invoice history and cannot be deleted.');
}
await pb.collection('customers').delete(id);
```

**Why wrong**
A failed read is turned into `null`, and `null` is interpreted as "this table has no history" by the guard. Concrete sequence: a transient PocketBase error (timeout/500) on any of the three reads, while the customer has ten invoices. The guard passes, the customer is deleted, and the page reports success. PocketBase clears the non-required `customer` relations on those sales/orders/invoices, so the financial documents lose their customer linkage (name/phone snapshots remain on some rows, but the CRM trail and per-customer history are gone). This is exactly the control the guard exists to enforce.

**Evidence**
- Search hit: `src\lib\customers.ts:220-222` (three `.catch(() => null)`).
- Caller trace: `deleteCustomer` is called by `src/app/customers/detail/page.tsx:292` after the confirmation dialog.

**Minimal fix**
Only a 404 may mean "no history"; any other error must throw:
```ts
.catch((err) => { if ((err as {status?:number}).status === 404) return null; throw err; })
```
then treat `null` as an unreadable check (block deletion) rather than "no history".

**Confidence:** confirmed from code.

---

### SW-03 [HIGH] Flash-drop pay-intent can create a second order line when the item read fails — `src/app/api/storefront/flash-drop/route.ts:776`

**What the code does**
```ts
const existingItems = await client.collection("sales_order_items").getList(1, 1, {
    filter: `order = "${sanitizeFilter(salesOrder.id)}"`,
}).catch(() => null);
if (!existingItems || existingItems.totalItems === 0) {
    await client.collection("sales_order_items").create({
        order: salesOrder.id,
        product: item.productId,
        variant: item.variantId,
        description: item.name,
        quantity: 1,
        unit_price: total,
        total,
        account_email: accountEmail,
    });
}
```
The freshly created order already received its line at `:743-752`. The gateway order is then created for `Number(salesOrder.total || total)` at `:792-802` — i.e. the one-unit total.

**Why wrong**
Concrete sequence: order created with one line; the `getList` immediately after fails transiently (transport error, not 404) and returns `null`; the repair branch treats that as "zero lines" and inserts a second line. The same happens on a retry if the first request created the header + line but crashed before the gateway step. The customer is charged the one-unit total, but the order now has two lines. `settleCapturedOrder` deducts stock for both and `generateInvoiceFromOrder` invoices both, so stock and output tax are doubled while the captured payment covers one unit. The route returns success with gateway parameters, so nothing surfaces the mismatch.

**Evidence**
- Search hit: `src\app\api\storefront\flash-drop\route.ts:778` (`.catch(() => null)`) followed by the create at `:780`.
- Line creation at `:743-752`; gateway amount at `:793`; settlement path at `:1006-1016`.

**Minimal fix**
Distinguish 404 from a transport failure as the codebase does elsewhere, and never repair on an unreadable count:
```ts
.catch((err) => { if ((err as {status?:number}).status === 404) return null; throw err; })
```
and on a real transport failure return 503 instead of inserting a line.

**Confidence:** confirmed from code (trigger requires a transient read error).

---

### SW-04 [HIGH] Gateway order id is saved with `catch(() => {})`, so a paid checkout cannot be confirmed — `src/app/api/storefront/order/route.ts:494` (also `:1041`, flash-drop `:823`)

**What the code does**
```ts
await client
    .collection("sales_orders")
    .update(existing.id, {
        gateway: "razorpay",
        gateway_order_id: gw.orderId,
        payment_method: body.paymentMethod,
    })
    .catch(() => {});
return NextResponse.json({ success: true, orderId: existing.id, ..., gateway: {...} });
```
The fresh prepare path does the same at `:1041-1048`. `confirmStorefrontPayment` then requires the persisted id:
```ts
const gatewayOrderId = String(order.gateway_order_id || "");
if (!gatewayOrderId) {
    return NextResponse.json({ success: false, error: "This order has no gateway payment to confirm." }, { status: 409 });
}
```
(`:212-218`)

**Why wrong**
Concrete sequence: Razorpay order created (money can now be charged); the local `sales_orders.update` fails and is ignored; the API returns `success: true` with the gateway parameters; the customer pays. The client then calls the confirm endpoint, which reads no `gateway_order_id` and returns 409 "This order has no gateway payment to confirm." The payment is captured but the storefront path cannot settle it. Only the asynchronous webhook can rescue the order; if the webhook is delayed, misconfigured, or the order has no webhook event, it remains `draft`/`PENDING` with money taken. The same swallow exists in the flash-drop pay-intent at `:823-833`, where the catch comment assumes every failure is a unique-race.

**Evidence**
- Search hit: `src\app\api\storefront\order\route.ts:501` and `:1048` (`.catch(() => {})`), plus `src\app\api\storefront\flash-drop\route.ts:830`.
- Confirm requirement: `src\app\api\storefront\order\route.ts:212-218`; flash-drop confirm at `flash-drop/route.ts:905-911`.

**Minimal fix**
Do not swallow the update. If it fails, cancel the gateway order / do not return the checkout parameters, and return a retryable error. In flash-drop, only swallow the specific duplicate-id error; rethrow everything else.

**Confidence:** confirmed from code.

---

### SW-05 [HIGH] Paid settlement returns success when no GST invoice was created — `src/lib/razorpay-webhook-handler.ts:250`

**What the code does**
```ts
// Raise the GST invoice before notifying the customer (CO-16).
try {
    const invoiceResult = await generateInvoiceFromOrder(orderId, db);
    if (!invoiceResult?.success) {
        console.warn(`[settlement] Invoice generation did not succeed for ${orderId}`);
    }
} catch (invoiceErr) {
    console.warn(`[settlement] Invoice generation failed for ${orderId}:`, invoiceErr);
}
```
The function then returns `{ success: true, orderId }` at `:361` (unless the stock step failed).

**Why wrong**
Concrete sequence: Razorpay captures ₹20,000; the order is marked `PAID`/`confirmed` at `:171-177`; `generateInvoiceFromOrder` throws (PocketBase error, missing store settings, item problem) or returns `{ success: false }`; the failure is reduced to a console warning; settlement returns success, the webhook route returns HTTP 200 (`src/app/api/webhooks/razorpay/route.ts:26-36`), and Razorpay stops redelivering. The paid order has no GST invoice in the invoice register or GSTR-1. `fulfillmentMarkersPresent` (`:88-113`) would resume the step only if another event for the same order arrives; nothing schedules that. This is distinct from wave1 P-02 (invoice created but left unpaid) and from the known invoice-notify marker (W-02): here no invoice row exists at all.

**Evidence**
- Search hit: `src\lib\razorpay-webhook-handler.ts:251-258`.
- Success return: `:351-361`; webhook 200 mapping: `src\app\api\webhooks\razorpay\route.ts:26-36`.
- Invoice presence is part of `fulfillmentMarkersPresent` (`:95-98`), but that only matters on a redelivery.

**Minimal fix**
Treat a missing invoice as a settlement failure: return `{ success: false, error: ... }` (or set a review marker and fail) so the webhook returns non-2xx and Razorpay retries, exactly as the stock-failure path does.

**Confidence:** confirmed from code.

---

### SW-06 [MEDIUM] Storefront coupon counter and usage row failures are ignored — `src/app/api/storefront/order/route.ts:1097`

**What the code does**
```ts
if (appliedDiscountId) {
    await client.collection("discounts")
        .update(appliedDiscountId, { "used_count+": 1 })
        .catch((err: unknown) => console.warn("[order] coupon counter update failed:", err));
    await client.collection("discount_usage")
        .create({ ..., discount: appliedDiscountId, ... })
        .catch((err: unknown) => console.warn("[order] coupon usage row failed:", err));
}
pbSyncSuccess = true;
...
return NextResponse.json({ success: true, orderId: persistedOrderId, ... });
```
**Why wrong:** the order is confirmed with the coupon discount, but the usage counter/row may be missing. A usage-limited coupon can be redeemed beyond its limit; the per-customer limit has no row to count; coupon reporting understates redemptions. The customer keeps the discount, so the loss is real. Caller receives success.
**Evidence:** search hit `:1101` and `:1112`; success return `:1129-1137`.
**Minimal fix:** make both writes part of the order transaction; on failure cancel/roll back the order (or at minimum return a non-success warning and re-drive the counter).
**Confidence:** confirmed from code.

---

### SW-07 [MEDIUM] Backorder split reports success while stock-ledger reassignment fails — `src/lib/orders.ts:1205`

**What the code does**
```ts
const movements = order.status === 'confirmed'
    ? await pb.collection('stock_movements').getFullList({ filter: `reference_id="${...}"` }).catch(() => [])
    : [];
...
await pb.collection('stock_movements').update(mv.id, { reference_id: childOrder.id, ... }).catch(() => {});
...
await pb.collection('stock_movements').update(mv.id, { quantity: remainSigned }).catch(() => {});
await pb.collection('stock_movements').create({ ..., reference_id: childOrder.id, ... }).catch(() => {});
...
return { parentOrderId, backorderId, backorderNumber };
```
**Why wrong:** a failed ledger read is treated as "no movements" and skips reassignment entirely; a failed update/create is ignored and the split still returns success. Concrete: split 2 of 5 units to `-BO1`; the parent's `-5` sale movement remains, the child gets none. Cancelling or returning the backorder cannot restore its 2 units through `restoreChannelStockForReference`, and the ledger no longer matches the order lines. The UI reports the split succeeded.
**Evidence:** search hits `:1183`, `:1208`, `:1212`, `:1221`; success return `:1237-1241`; caller `src/app/orders/detail/page.tsx:267`.
**Minimal fix:** propagate the read error, and if any ledger write fails, run the existing cleanup block (`:1242-1251`) and rethrow instead of returning success.
**Confidence:** confirmed from code.

---

### SW-08 [MEDIUM] Permanent invoice delete ignores child and payment delete failures — `src/lib/invoice.ts:1195`

**What the code does**
```ts
for (const item of items) {
    await pb.collection('invoice_items').delete(item.id).catch(() => {});
}
for (const p of payments) {
    await pb.collection('invoice_payments').delete(p.id).catch(() => {});
}
await pb.collection('invoices').delete(id);
```
**Why wrong:** if a payment delete fails, the invoice header is still deleted and the function resolves. The orphan `invoice_payments` row is a money receipt with no invoice; payment/AR reports that read `invoice_payments` can still count it, and the invoice delete is irreversible from the UI. Same for orphan `invoice_items`. Caller reports success.
**Evidence:** search hits `:1196`, `:1202`; caller `src/app/invoices/page.tsx:188`.
**Minimal fix:** delete children without swallowing; if a child fails, abort before deleting the header and return the error.
**Confidence:** confirmed from code.

---

### SW-09 [MEDIUM] WhatsApp catalog sync returns success but never stores the catalog id — `src/lib/whatsapp-event-sync.ts:859`

**What the code does**
```ts
await pb.collection('products').update(product.id, {
    whatsapp_catalog_id: waCatalogId,
    whatsapp_last_synced: new Date().toISOString(),
}).catch(() => {});
...
return { success: true, productName: product.name };
```
The same pattern appears for the already-in-sync branch (`:859-863`), the edit-success branch (`:891-894`), and the create-success branch (`:939-942`).

**Why wrong:** the remote catalog create/edit succeeded, but the local product keeps `whatsapp_catalog_id = ''`. The browser's local identity map is saved first (`saveIdentityRecord`), so this device skips the product next time; the database and other devices do not know the remote id. Unlink (`whatsapp-catalog.ts:335`), delete and price-sync paths that read the column cannot target the item, and another browser can create a duplicate catalog entry for the same SKU. The function reports success.
**Evidence:** search hits `:862`, `:894`, `:942`; success returns `:864`, `:903`, `:951`.
**Minimal fix:** let the update throw and return `{ success: false }` (the remote edit already happened, so surface a "relink needed" error rather than success), or retry/queue the local write.
**Confidence:** confirmed from code.

---

### SW-10 [MEDIUM] Vendor WhatsApp product ingestion can report success with lost stock or no ledger row — `src/lib/whatsapp-crm.ts:938`

**What the code does**
```ts
await pb.collection('stock_movements').create({ ..., quantity: input.quantity, ... })
    .catch((err) => console.warn('[whatsapp-crm] stock movement log failed:', err));
...
if (hasVendorGRN) {
    try {
        await createGRN({ ... });
    } catch (err) {
        console.warn('[whatsapp-crm] draft GRN creation failed:', err);
        await pb.collection('product_variants').update(variant.id, {
            stock_level: Math.max(0, input.quantity),
        }).catch(() => {});
    }
}
return { productId: product.id, variantId: variant.id };
```
**Why wrong:** two paths:
- No vendor GRN: the variant is created with `stock_level = input.quantity` (`:918-935`), but if the movement create fails the stock has no ledger receipt and the function succeeds. Movement-based stock history/turnover sees nothing.
- Vendor GRN: if `createGRN` fails and the fallback stock update also fails (swallowed), the product/variant exist with zero stock and no GRN; the modal reports success. The received units are invisible until a manual stock fix.
**Evidence:** search hits `:946`, `:970`; success return `:974`; caller `src/components/whatsapp/VendorIngestionModal.tsx:289`.
**Minimal fix:** fail the ingestion if the movement/fallback write fails; for the GRN fallback, retry or return a partial result with an error instead of success.
**Confidence:** confirmed from code.

---

### SW-11 [MEDIUM] Sales-mirror writes are best-effort, so revenue rows go missing or duplicate — `src/lib/razorpay-webhook-handler.ts:276` and `src/app/api/storefront/order/route.ts:988`

**What the code does**
```ts
// settlement
const existingMirror = await pb.collection('sales')
    .getFirstListItem(`channel="storefront" && channel_order_id="${...}"`)
    .catch(() => null);
if (!existingMirror) {
    await pb.collection('sales').create({ ... });
}
} catch (mirrorErr) {
    console.warn(`[settlement] sales mirror write failed for ${orderId}:`, mirrorErr);
}
```
```ts
// COD checkout
await client.collection("sales")
    .create({ channel: "storefront", channel_order_id: txnId, ... })
    .catch((mirrorErr) => {
        console.warn("[Storefront Order] sales mirror write failed (order is durable):", mirrorErr);
    });
```
**Why wrong:** a transient read failure in settlement makes `existingMirror` null, so a second `sales` row is created for the same order (duplicate revenue in POS/analytics); a failed create leaves no row at all while settlement/COD returns success. COD has no webhook retry, so a failed COD mirror is permanently missing from `sales` and from reports that read it.
**Evidence:** search hits `razorpay-webhook-handler.ts:281`, `:298-300`; `storefront/order/route.ts:1010-1012`; success returns `:361` and `:1129`.
**Minimal fix:** only 404 may mean "no mirror"; duplicate the row on a real read failure must throw. Make the create failure fail the COD order (or queue it), and let settlement report failure so Razorpay retries.
**Confidence:** confirmed from code.

---

### SW-12 [MEDIUM] Payment-reconciliation idempotency guards fail open on read errors — `src/lib/payment-reconciliation.ts:102` and `:110`

**What the code does**
```ts
async function hasClearingEntry(linkRecordId: string): Promise<boolean> {
    const existing = await pb.collection('bank_transactions').getFirstListItem(...).catch(() => null);
    return !!existing;
}
async function hasInvoicePayment(invoiceId: string, reference: string): Promise<boolean> {
    if (!reference) return false;
    const existing = await pb.collection('invoice_payments').getFirstListItem(...).catch(() => null);
    return !!existing;
}
```
**Why wrong:** only a 404 should mean "not recorded yet". A transport/500 error is converted to `false`, so `recordClearingDeposit` creates another clearing `bank_transactions` row and `settleLinkedOrder` creates another `invoice_payments` row for the same reference. The duplicate clearing row dedupe at `:146-151` deletes extras but its cleanup failure is also swallowed; the duplicate invoice payment remains and is summed into `paid_amount` (`:220-230`), overstating collections in payment history/reconciliation.
**Evidence:** search hits `:105`, `:114`; uses at `:123` and `:203-215`; cleanup catch `:148`.
**Minimal fix:** catch only status 404 in both helpers; rethrow anything else.
**Confidence:** confirmed from code.

---

### SW-13 [MEDIUM] Loyalty balance moves before the ledger row, and the failure is converted to `null` — `src/lib/loyalty.ts:442` (earn), `:514` (redeem), `:588` (adjust)

**What the code does**
```ts
const updated = await db.collection('loyalty_accounts').update(account.id, {
    'current_balance+': pointsToEarn, ...
});
...
await db.collection('customers').update(customerId, { loyalty_points: newBalance }).catch(() => {});
await recordTransaction(...);   // throws on failure
...
} catch (error) {
    console.error('Error updating loyalty account:', error);
    return null;
}
```
`recordTransaction` deliberately throws: "A failure here must reach the caller" (`:380-383`). The catch then does the opposite and returns `null`.

**Why wrong:** concrete sequence: settlement marks a paid order, `loyalty_accounts.current_balance` is incremented, then `loyalty_transactions.create` fails (validation/transport). The catch returns `null`; the settlement code at `razorpay-webhook-handler.ts:344-348` ignores the return and reports success. The balance has moved without an audit row — the exact drift the ledger exists to prevent. Because `fulfillmentMarkersPresent` does not check loyalty, a redelivery/reconciliation can call `earnPoints` again and award the points a second time. The customer-profile mirror failures at `:444`, `:517`, `:591` are also swallowed, so `customers.loyalty_points` (returned to the storefront at `verify-otp/route.ts:178`) can stay stale.
**Evidence:** search hits `:444`, `:517`, `:591`; catch/return `:459-462`, `:532-535`, `:606-609`; caller ignores null at `razorpay-webhook-handler.ts:346`.
**Minimal fix:** rethrow after a partial write (or compensate the balance update), and only swallow the denormalized customer mirror. Record a loyalty marker in settlement if retries must be idempotent.
**Confidence:** confirmed from code (double-award requires the failed ledger write plus a redelivery).

---

### SW-14 [LOW] Mid-pack damage discrepancy write failure is ignored — `src/lib/packing.ts:815`

**What the code does**
```ts
await pb.collection('stock_discrepancies').create({ ..., discrepancy_type: 'damaged', quantity: 1, ... })
    .catch((err) => console.warn('Discrepancy write warning:', err));
...
await saveSessionProgress(updatedSession);
return { action: 'short_ship_required', availableStock: 0, updatedSession };
```
**Why wrong:** the packer short-ships an order, but the discrepancy ledger has no row for the damaged unit. The session's `shortage_items` still records it (`:828-842`), so the packer sees it, but the discrepancy dashboard/stats do not; ops cannot reconcile the damaged unit from the standard screen. The function reports the short-ship action.
**Evidence:** search hit `:826`; return `:844-848`.
**Minimal fix:** include the discrepancy create in the failure path (throw before saving the session) or return a warning flag with the result.
**Confidence:** confirmed from code.

---

### SW-15 [LOW] Catalog unlink resolves even when the link was not cleared — `src/lib/whatsapp-catalog.ts:335`

**What the code does**
```ts
export async function unlinkWhatsAppCatalogItem(productId: string): Promise<void> {
    await pb.collection('products').update(productId, { whatsapp_catalog_id: "" }).catch(() => {});
}
```
**Why wrong:** the caller (`WhatsAppCatalogEditorModal.tsx:502`, `:527`) awaits a `void` promise and removes the item from the UI; the product row can still carry the old `whatsapp_catalog_id`, so a later sync/unlink/delete targets the wrong remote item or a stale link is re-adopted.
**Evidence:** search hit `:335`; callers from `findstr`.
**Minimal fix:** remove the `.catch` and surface the error to the modal.
**Confidence:** confirmed from code.

---

### SW-16 [LOW] Opening-float audit row is best-effort — `src/lib/register.ts:120`

**What the code does**
```ts
if (openingBalance > 0) {
    await pb.collection('cash_drawer_operations').create({ ..., operation_type: 'add', amount: openingBalance, reason: "Opening Float", ... })
        .catch((err) => console.warn('Failed to record initial drawer operation:', err));
}
return record as unknown as CashRegisterShift;
```
**Why wrong:** the shift row (with `opening_balance`) is written and the shift opens, but the drawer audit trail has no opening-float row. `expected_balance` still includes the float, so reconciliation is correct; the audit/exception trail is incomplete. This is a documented audit-only side effect, hence Low.
**Evidence:** search hit `:129`; return `:132`.
**Minimal fix:** write the audit row before returning, or return a warning that the shift opened without an audit entry.
**Confidence:** confirmed from code.

---

### SW-17 [LOW] Channel customer backfill failure is swallowed — `src/lib/channel-orders.ts:129`

**What the code does**
```ts
if (Object.keys(updates).length > 0) {
    await client.collection('customers').update(existing.id, updates).catch(() => {});
}
return { id: existing.id, existed: true };
```
**Why wrong:** address, city/state, GSTIN, company name, billing address, and `opt_in_marketing` are merged into an existing customer; a failed write is silent and the order proceeds. The invoice still uses the order's own buyer/GSTIN fields, so tax is not affected, but the CRM profile and marketing-consent flag remain stale (consent is compliance-relevant).
**Evidence:** search hit `:130`; return `:132`.
**Minimal fix:** log and report a warning; for `opt_in_marketing`, never swallow (retry or fail the consent path).
**Confidence:** confirmed from code.

---

### SW-18 [LOW] PO-item variant backfill failure is only logged — `src/lib/purchase.ts:917`

**What the code does**
```ts
try {
    const poItem = await pb.collection('purchase_order_items').getOne(item.po_item_id);
    if (item.variant_id && !poItem.variant) {
        await pb.collection('purchase_order_items').update(item.po_item_id, { variant: item.variant_id });
    }
} catch (err) {
    console.error('Error updating PO item:', item.po_item_id, err);
}
```
**Why wrong:** the GRN receipt succeeds and the quantity reservation/stock update is already applied, but the PO line remains unlinked to the variant. Future receipts or reconciliation by variant cannot match the line, and the returned GRN has no warning for this specific failure (it returns success at `:977`).
**Evidence:** search hit `:921-923`; success return `:977-988`.
**Minimal fix:** add this failure to the returned `warnings` array (the function already has one) or rethrow before completing the GRN.
**Confidence:** confirmed from code.

---

### SW-19 [LOW] Webhook dedupe marker save is swallowed after settlement — `src/lib/razorpay-webhook-handler.ts:523`

**What the code does**
```ts
await saveProcessedEvents(rememberEvent(processedEvents, eventKey), db).catch((err) => {
    console.warn('[webhook] Could not record the processed event:', err);
});
return { success: true, orderId, event };
```
**Why wrong:** settlement succeeds but the processed-event key is not persisted. A Razorpay redelivery reprocesses the event. Settlement is mostly idempotent (`payment_status=PAID` + fulfillment markers), so impact is low, but any step whose marker is missing (notably loyalty) can run again.
**Evidence:** search hit `:523-525`; success return `:527`.
**Minimal fix:** return a retryable failure when the dedupe write fails (the settlement is already durable; a retry will short-circuit on PAID).
**Confidence:** confirmed from code.

---

### SW-20 [LOW] Batch consent outcomes are discarded by the checkout path — `src/lib/consent-ledger.ts:99`

**What the code does**
```ts
export async function recordConsentEvents(db: typeof pb, inputs: ConsentEventInput[]): Promise<void> {
    for (const input of inputs) {
        await recordConsentEvent(db, input);
    }
}
```
`recordConsentEvent` returns `false` when the ledger write fails (`:65-84`), but the batch wrapper returns `void` and the storefront checkout awaits it without inspecting anything (`src/app/api/storefront/order/route.ts:940-959`).

**Why wrong:** the order is placed and reported successful with no auditable transactional/marketing consent row if the consent write fails. This is documented as best-effort, hence Low, but the single-event API was explicitly designed to report the outcome.
**Evidence:** search hit `consent-ledger.ts:103-105`; caller `storefront/order/route.ts:940`.
**Minimal fix:** return `boolean[]`/`boolean` from the batch wrapper and attach a warning (or fail closed for marketing) when any write failed.
**Confidence:** confirmed from code.

---

## Clean — searches run and hits judged benign

Searches actually run (Windows CMD):

1. `findstr /s /n /c:".catch(() => {})" src\lib\*.ts src\app\api\*.ts`
2. `findstr /s /n /c:".catch(() => null)" src\lib\*.ts src\app\api\*.ts`
3. `findstr /s /n /c:"catch {" src\lib\*.ts src\app\api\*.ts`
4. `findstr /s /n /c:"catch (e) {" src\lib\*.ts src\app\api\*.ts`
5. `findstr /s /n /c:".catch((" src\lib\*.ts` (filtered to handlers that take an error)
6. `findstr /s /n /c:"catch" src\app\api\*.ts`

Benign categories (representative hits, not exhaustive):

- **Rollback/compensation writes whose failure is swallowed but the original error is rethrown** — `src/lib/invoice.ts:709,711`; `purchase.ts:457-459,783-796,838-840`; `orders.ts:238-240,273-275,353,392,1248-1250`; `challan.ts:296-298`; `expenses.ts:289`; `pos-sales.ts:431-467`; `banking.ts:302-320`; `returns.ts:1256-1290`; `shipments.ts:182-185,242-247`; `chat-sales.ts:453,514`; `payment-reconciliation.ts:148`. These run only after a failure and the caller is told the operation failed; a rollback failure can leave partial data, but it is not a false success. The audit's `returns.ts:1277`/`invoice.ts:1196` cases that *do* return success are reported above (SW-08), not here.
- **Graceful reads** — `settings.ts:165-315` (known secrets finding; main row write still throws), `customers.ts:140-150,460-474,565-575`, `products.ts:155-161,266-276,410-436,588-606,676-688,771-790`, `discounts.ts:156-196`, `loyalty.ts:232-275,332-350`, `register.ts:545-575,607-624`, `shipping`/`challan`/`orders` customer lookups, `payment-reconciliation.ts:64-115` (reported above only where the false value drives a duplicate write), `channel-stock.ts:195-245`, `channel-pricing.ts:122-171`. Returning `[]`/`null` only changes display data or a fallback, not a money/stock write.
- **JSON/localStorage/storage parsing** — `invoice.ts:332,374,385,392`; `pocketbase.ts:281`; `products.ts:788`; `register.ts:571-574`; `multi-location.ts:469-476`; `whatsapp-*.ts` parse helpers. No business write is skipped.
- **Promise-chain guards / subscriptions / timers** — `sequence-generator.ts:40,52`; `concurrency.ts:21,25`; `inventory-feed.ts:23-47`; `whatsapp-event-sync.ts:1186,1213`; `sound-effects.ts:18`. Not writes.
- **Explicitly documented best-effort side effects** — notification sends (`shipments.ts:189-191`; `order-milestones.ts:156-174`; `whatsapp*.ts` send paths; `razorpay-webhook-handler.ts:304-321` is the known W-02 marker), analytics/aggregates (`channel-orders.ts:162-178,197-231`; `razorpay-webhook-handler.ts:329-342`; `orders.ts:280-292`), flash-drop expiry (`whatsapp-flash-drops.ts:206-232`; `storefront/flash-drop/route.ts:213-235`), parked carts (`register.ts:579-601`), gallery angles (`products.ts:794-833`), quick-add memory (`quick-add-memory.ts:234-263`). These are Low at most and are not counted above except where they touch a stock or money row.
- **Setup/test-only cleanup** — `setup.ts:312`; `scripts/*`; `tenant-db-manager.ts:172`; `backup.ts:465,524`. Not production write paths.
- **Reads that were deliberately made fail-closed** — `products.ts:311-338` (stock availability pre-check throws), `channel-stock.ts:292-310` (availability), `returns.ts:855-865` (prior-return history), `razorpay-webhook-handler.ts:88-113` (fulfillment markers), `webhook-dedupe.ts:71-93` (only 404 is "empty"), `channel-orders.ts:380-436` (only 404 is "new order"). These are the correct pattern and were excluded as models for the fixes above.
- **No-hit files** — `src/app/api/**` contained no swallowed *write* outside `storefront/order`, `storefront/flash-drop`, and the settings/eway lazy encryption migration (`settings/eway/route.ts:111`, at-rest encryption only, not a business write).

**Dedupe note.** Not re-reported because already covered: `orders.ts:453-455` status swallow (wave2 O-05), `cycle-count.ts` audit completion on failed adjustments (wave1 S-07/S-14), `returns.ts` partial restock (wave1 S-04), `razorpay-webhook-handler.ts:304` notify marker (wave2 W-02), `payment-reconciliation.ts` amount check (known), `settings.ts` secrets (known), `channel-orders.ts` idempotency returning cancelled orders (wave2 W-05). `SW-05` is the invoice *creation* failure (no invoice row), distinct from wave1 P-02 (invoice created but left unpaid).
