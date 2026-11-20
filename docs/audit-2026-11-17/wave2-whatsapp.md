# Wave 2 audit — WhatsApp, channels, storefront, ingest/webhooks

Date: 2026-11-17. Scope: the files named in the cluster brief. Method: every claim below was traced through the code (callers, sidecar contract, state writes). Existing reports were not used. Baseline assumed: tsc/eslint clean, 30 logic suites passing.

Severity counts: **1 Critical, 5 High, 7 Medium, 1 Low**.

---

### W-01 [CRITICAL] Server-side WhatsApp sends cannot authenticate to the sidecar; storefront OTP sign-in always fails — `src/lib/whatsapp.ts:46`

**What the code does**

Server rendering deliberately returns an empty sidecar secret:

```ts
function readSidecarSecret(): string {
    if (typeof window === "undefined") {
        // WA-9: server rendering has no sidecar session, and there is no
        // build-time token in this bundle any more. ...
        return "";
    }
```

The module's fetch wrapper then only adds the header when that value is non-empty:

```ts
const secret = isSidecarUrl(urlStr) ? readSidecarSecret() : "";
if (secret) {
    ...
    headers.set("Authorization", `Bearer ${secret}`);
}
```

The storefront's only sign-in path is a server route and uses the same client:

```ts
// src/app/api/storefront/auth/send-otp/route.ts:101
waDelivered = await sendMessage(tenantSession, waNumber, otpMessage);
...
if (!waDelivered && !allowDevOtp) {   // line 112
    await releaseOtpAttempt(phone10, boundAdminEmail);
    return NextResponse.json({ success: false, error: "We could not send the code on WhatsApp. ..." }, { status: 502 });
```

The sidecar rejects every `/api` call without the bearer token (`wppconnect-sidecar/server.js:225-239`, mounted at `:249`), and refuses to start with a token shorter than 16 chars (`:20-24`).

**Why wrong**

Expected: a server route sends the OTP through the tenant's connected WhatsApp session. Actual: the request leaves without `Authorization`, the sidecar answers 401, `sendMessageDetailed` returns `{ok:false}`, and `send-otp` answers 502. `allowDevOtp` is `NODE_ENV !== "production" && ALLOW_DEV_OTP === "true"` (`send-otp/route.ts:108`), so production has no fallback.

Concrete scenario: a new storefront customer enters a phone number, presses “Send code”, and receives “We could not send the code on WhatsApp” forever. `verify-otp` mints the customer token only after a code is verified, and `/api/storefront/order` refuses every submission without that token (`order/route.ts:316-322`), so new storefront checkout is dead even though the UI and gateway are configured.

The same unauthenticated path is used by every other server-side send (`sendPaidOrderInvoice` from the Razorpay webhook, `sendLoyaltyMilestoneAlert`, `sendShippingTracking` when called with a server client). The only token sources are the desktop shell's `window.__WPPCONNECT_SECRET__` and localStorage (`whatsapp.ts:53-71`); `layout.tsx:37-40` injects the dev value into the *page*, not into any server module, and no server code reads `process.env.WPPCONNECT_SECRET` as an auth header.

**Evidence**

- Route trace: `POST /api/storefront/auth/send-otp` → `sendMessage` (`whatsapp.ts:2140`) → `sendMessageDetailed` (`:2153`) → module `fetch` (`:97`) → `POST {sidecar}/api/luminila/send-message` with no auth header → sidecar `requireSidecarAuth` 401 → `if (!response.ok) return { ok: false, id: null }` (`:2175`) → route 502.
- The “last resort” caller token parameter documented in `resolveWppSecret` (`:34-44`) is never passed by any production call site; only `test-whatsapp-secret.ts` passes it.
- Grep for `WPPCONNECT_SECRET` in `src/`: only `layout.tsx:38` (dev script, client) and the window declaration in `whatsapp.ts`.

**Minimal fix**

In `readSidecarSecret`, return `process.env.WPPCONNECT_SECRET` (trimmed, length-checked) when `typeof window === "undefined"`, so the shell can pass the same per-launch token to the Next server.

**Confidence:** confirmed from code. Runtime escape hatch not in this repo: a local proxy in front of the sidecar that injects the header would invalidate the claim.

---

### W-02 [HIGH] “Invoice notification sent” marker is written even when the notification failed, suppressing every retry — `src/lib/razorpay-webhook-handler.ts:304`

**What the code does**

```ts
const freshNotes = await pb.collection('sales_orders').getOne<{ internal_notes?: string }>(orderId, { fields: 'internal_notes' });
if (!String(freshNotes.internal_notes || '').includes(NOTIFY_MARKER)) {
    await sendPaidOrderInvoice(orderId, db);          // returns { success:false } on failure
    await pb.collection('sales_orders').update(orderId, {
        internal_notes: [
            freshNotes.internal_notes,
            `[settlement ${new Date().toISOString()}] ${NOTIFY_MARKER}`,
        ].filter(Boolean).join('\n'),
    });
}
```

`sendPaidOrderInvoice` converts a 401/network failure into `{ success: false }` rather than throwing (`whatsapp-notifications.ts:39-81`; `sendMessageDetailed` returns `{ok:false}` at `whatsapp.ts:2175`).

**Why wrong**

Expected: the durable marker means “attempted successfully”; a failed send stays retryable. Actual: the marker is written unconditionally, so every later settlement pass (PAY-3 resumption, webhook redelivery, reconciliation) skips the notification. Combined with W-01, a paid web order is marked `invoice notification sent` while no WhatsApp message was ever delivered. This is exactly a status written after a failure with no retry.

Concrete scenario: `payment.captured` settles a storefront order; `sendPaidOrderInvoice` gets a 401 (no server token), returns false; the marker is appended; Razorpay redelivers, `fulfillmentMarkersPresent` returns true (invoice + sales mirror + aggregates marker exist) and settlement short-circuits; the customer never receives the paid-order receipt. `payment-reconciliation.ts:330` retries the same function but the settlement path itself is finished.

**Evidence**

- Route trace: webhook → `settleCapturedOrderInner` (`razorpay-webhook-handler.ts:115`) → step at `:304-318` → `sendPaidOrderInvoice` → `sendMessage` → sidecar 401.
- The marker constant is `'invoice notification sent'` (`:77`); nothing removes it on failure.
- No test covers the failed-send branch.

**Minimal fix**

```ts
const sent = await sendPaidOrderInvoice(orderId, db);
if (sent.success) { await pb.collection('sales_orders').update(... NOTIFY_MARKER ...); }
```

**Confidence:** confirmed from code.

---

### W-03 [HIGH] STOP replies never reach the opt-out registry; marketing keeps going to customers who opted out — `src/app/whatsapp/page.tsx:1383`

**What the code does**

The only automatic STOP handler runs when an operator opens a chat, and only examines the *last* inbound message of the loaded page:

```ts
// src/app/whatsapp/page.tsx:1383-1389
const lastInbound = [...parsed].reverse().find(m => !m.fromMe && m.body);
if (lastInbound && detectIntent(lastInbound.body) === 'OPT_OUT') {
    setWhatsAppOptOut(selectedChat, ctx.customer?.id || undefined).catch(() => {});
```

The live socket handler for a new inbound message only appends it to the open thread; it never inspects intent:

```ts
// src/app/whatsapp/page.tsx:1615-1650
const handleIncomingMessage = (payload: WppIncomingEvent) => {
    const msg = payload?.message;
    if (!msg || msg.fromMe) return;
    ...
    setSelectedChatMessages(prev => { ... });
```

The dispatcher trusts the registry it is supposed to populate:

```ts
// src/lib/whatsapp-broadcast.ts:485-492
if (await isWhatsAppOptedOut(entry.recipient_phone)) {
    await pb.collection('broadcast_messages').update(entry.id, { status: 'skipped', error: 'opted out before dispatch' })
```

`registerStopOptOut` exists (`whatsapp-broadcast.ts:533`) but grep shows no production caller. Every marketing message appends `_Reply STOP to opt out._` (`:377`, `whatsapp-broadcast.ts`).

**Why wrong**

Expected (module header, `whatsapp-broadcast.ts:10`): `"STOP" replies auto-register`. Actual: registration requires (a) an operator to open that specific chat, (b) the STOP to still be the last inbound message on the loaded page (a following “ok thanks” hides it), and (c) a reload/re-selection of the chat — a STOP arriving while the chat is open is not processed at all. No server-side inbound consumer exists (`getUnreadMessages`/`startPolling` are unused; grep confirms no other `setWhatsAppOptOut` caller).

Concrete scenario: customer replies STOP at 10:00. The broadcast queue has a scheduled message at 10:05. No operator opens the chat. `isWhatsAppOptedOut` finds no `whatsapp_opt_outs` row and `whatsapp_opt_out` is still false → the message is sent. The customer can be messaged indefinitely despite the explicit opt-out, and the consent ledger contains no revocation event.

**Evidence**

- Grep: only `src/app/whatsapp/page.tsx:1386` calls `setWhatsAppOptOut`; `registerStopOptOut` has zero callers outside its definition.
- `handleIncomingMessage` (`page.tsx:1615-1650`) has no `detectIntent`/`setWhatsAppOptOut` call.
- `processBroadcastQueue` (`whatsapp-broadcast.ts:433`) only consults `isWhatsAppOptedOut` (`whatsapp-crm.ts:1304`), which reads the registry/profile written by `setWhatsAppOptOut`.

**Minimal fix**

In `handleIncomingMessage`, for every inbound message: `if (detectIntent(msg.body || "") === "OPT_OUT") void registerStopOptOut(chat);` (and keep the chat-open fallback).

**Confidence:** confirmed from code.

---

### W-04 [HIGH] Flash-drop confirmation never re-checks the hold; an expired reservation and a second buyer can both settle — `src/app/api/storefront/flash-drop/route.ts:854`

**What the code does**

`reserve` creates a 10-minute hold and availability is `allocatedStock - live holds - completed holds` (`flash-drop/route.ts:498-542`, `:237-259`). `pay-intent` requires a live hold:

```ts
if (
    String(reservation.status) !== "active" ||
    new Date(parsePbDate(String(reservation.expires_at || "")) || 0).getTime() <= Date.now()
) {
    return ... "Your 10-minute hold has expired. Please reserve the item again."   // :631-639
}
```

But `order` (the confirmation/settlement action) never loads or validates the reservation:

```ts
// :878-958
const order = await client.collection("sales_orders").getOne(orderId) ...
if (!order || !belongsToTenant(...)) ... 404
if (String(order.capture_source || "") !== "whatsapp_flash_drop") ... 403
... // phone, PAID short-circuit, gateway_order_id, replay check, signature, fetchGatewayPayment(status/order/amount)
const settled = await settleCapturedOrder(order.id, { paymentId, tenantEmail: accountEmail, client });   // :1006
```

The reservation is only marked `completed` after settlement, best effort (`:1020-1033`). Settlement deliberately clamps on shortage:

```ts
// razorpay-webhook-handler.ts:198-207
const applied = await applyChannelStock(toStockDb(pb), lines, {
    ...
    oversell: 'clamp',
});
```

**Why wrong**

Expected: a drop unit is sold at most `allocatedStock` times; the hold is the allocation. Actual: once the Razorpay order exists, the buyer can pay any time (Razorpay orders do not expire). If the hold expires while the checkout is open, the unit is released and a second buyer can reserve and pay. Both payment confirmations then pass every check (`captured`, same gateway order, same amount) and both settle; the second (or late) one hits the stock minimum and `applyChannelStock` clamps to 0, so the order is still `PAID/confirmed` with no inventory movement. The drop has sold two units against one allocation and, if physical stock is one, two orders against one piece.

Concrete scenario: `allocatedStock = 1`. Buyer A reserves at 10:00 and gets a gateway order but leaves the tab open. At 10:11 the hold expires; buyer B reserves and pays at 10:12 (stock 1 → 0). At 10:15 A completes the already-created Razorpay order. Both confirmations pass; B's sale is stock-backed, A's is clamped, both orders are confirmed.

**Evidence**

- `handleOrderConfirmation` (`:854-1044`) contains no `flash_drop_reservations` read before `settleCapturedOrder`; the only read is after settlement at `:1023`.
- `settleCapturedOrder` chooses `oversell: 'clamp'` (`razorpay-webhook-handler.ts:206`), whose branch pushes a shortage and `continue`s without a movement when settled stock is 0 (`channel-stock.ts:429-437`).
- Also no re-check of `dropIsOpen` or `allocatedStock` at confirmation.

**Minimal fix**

Before settlement, resolve the order's reservation (`order.order_number` prefix `ORD-FD-`) and return 409 unless `status === "active"` and `expires_at > now` (or the reservation is already `completed` for this order).

**Confidence:** confirmed from code (payment can be late; no reservation gate).

---

### W-05 [HIGH] Idempotency replay returns a cancelled or line-less order as a successful duplicate — `src/lib/channel-orders.ts:380`

**What the code does**

The idempotency lookup has no status or completeness check:

```ts
const filter = client.filter('order_number = {:num} && account_email = {:tenant}', {
    num: orderNumber,
    tenant,
});
...
return record;   // :435
```

The storefront route returns that record as success before doing anything else:

```ts
// src/app/api/storefront/order/route.ts:440-462
const existing = await findExistingChannelOrder(client, txnId, boundAdminEmail, cleanPhoneDigits);
if (existing) {
    ...
    return NextResponse.json(
        { success: true, orderId: existing.id, txnId, syncedToDb: true, duplicate: true },
        { status: 200, headers: CORS_HEADERS }
    );   // :519-522
}
```

Yet the same route cancels the header when a later step fails:

```ts
// :972-980
} catch (stockErr) {
    await client.collection("sales_orders").update(salesOrder.id, { status: "cancelled" }).catch(() => {});
    if (stockErr instanceof InsufficientStockError) {
        return ... 409 "Insufficient stock"
    }
    throw stockErr;                       // → outer catch :1117 returns 503
}
```

The storefront client keeps the same `idempotencyKey` on failure and rotates it only after success (`storefront/src/app/checkout/page.tsx:275`, `:345`).

**Why wrong**

Expected: retrying a checkout returns the existing order only when it is a valid, complete order. Actual: after `assertStockAvailable` passes but another channel sells the unit, `applyChannelStock` throws `InsufficientStockError`, the order is marked `cancelled`, and the user sees the 409 (“One of the items just went out of stock…”). The natural retry (same key) finds the cancelled row, the stored cart hash matches, and the API answers 200 `success:true, duplicate:true` for a cancelled order. The customer is told the order exists; no new order, stock or payment trail is created. For a non-`InsufficientStock` error (PB 500 after the header/items writes) the route returns 503 the first time and 200 success on retry, for an order with items but no stock deduction, no sales mirror and no consent trail.

The same hole exists in the chat path: `chat-sales.existingOrderResult` (`chat-sales.ts:98-124`) uses the same lookup, and `createSaleFromChat` cancels the order in its compensation block (`:504-521`). A retry with the same `idempotencyKey` (the WhatsApp page reuses `CHAT-<chat>-<cart hash>`, `page.tsx:1909-1920`) reports the cancelled order as a duplicate success.

**Evidence**

- `findExistingChannelOrder` (`channel-orders.ts:380-436`) selects on `order_number + account_email` only; the returned `status` field is unused by both callers.
- The failure paths that leave a cancelled/partial row: storefront `:972-979` (stock/other error) and `:1117-1126` (outer catch 503); chat `chat-sales.ts:504-521`.
- The retry has a stable key by design: `storefront/src/app/checkout/page.tsx:88-92, 244, 340` (no rotation on failure).
- Existing tests (`test-channel-orders.ts`) do not exercise idempotency at all.

**Minimal fix**

Add `&& status != "cancelled"` to the `findExistingChannelOrder` filter (and, for the 503-after-items case, verify the order has the expected line count before returning `duplicate`; otherwise delete/repair the partial row).

**Confidence:** confirmed from code (deterministic once a stock failure/transient error occurs).

---

### W-06 [HIGH] Catalog editor divides already-normalised rupee prices by 1000, repricing any item ≥ ₹1,00,000 to 1/1000 on save — `src/components/whatsapp/WhatsAppCatalogEditorModal.tsx:85`

**What the code does**

```ts
function normalizePrice(val: unknown): number {
    ...
    // Meta Catalog micro-units (e.g. 1500000 = 1500 INR)
    if (num >= 100000 && num % 1000 === 0) {
        return num / 1000;
    }
    return num;
}
```

The sidecar has already divided `priceAmount1000` by 1000 before returning the catalog (`wppconnect-sidecar/server.js:2886-2899`): for a ₹1,50,000 item the API returns `price: 150000`. The modal then applies the division again at `:284` (`const waPrice = normalizePrice(item.price)`), seeds the edit form with it (`:337`, `price: selectedItem.price`), and writes it back on save:

```ts
// :386-400
const res = await editCatalogProduct(sessionId, selectedItem.id, {
    name: editForm.name,
    price: Number(editForm.price),        // 150, not 150000
    ...
});
if (syncInventoryPriceToPB && selectedItem.linkedProduct) {
    await setWhatsAppCatalogPrice(selectedItem.linkedProduct.id, Number(editForm.price));
}
```

The adopt-bulk path writes the same value into inventory (`:227`, `setWhatsAppCatalogPrice(..., item.price)`). The sidecar converts the submitted rupees to `priceAmount1000` with `Math.round(numericPrice * 1000)` (`server.js:3251-3256`), so `150` becomes a ₹150 catalog price.

**Why wrong**

Expected: the editor displays/edits the catalog's rupee price. Actual: every item priced at ≥ ₹1,00,000 in whole thousands is shown at 1/1000, flagged as a “price mismatch”, and re-saved at that wrong value. Editing only the product name in the modal silently reprices the WhatsApp catalog item to ₹150; ticking “also update PocketBase” writes `channel_prices.whatsapp = 150`, which `chat-sales` then uses as the authoritative WhatsApp price (`chat-sales.ts:164-173`), so concierge orders also undercharge.

Concrete scenario: a ₹1,50,000 necklace in the WhatsApp catalog. Operator opens the editor to fix its title, saves. WhatsApp now publishes the piece at ₹150; a customer orders via the catalog/concierge at ₹150; the PB channel price is also ₹150 if the checkbox was ticked.

**Evidence**

- Sidecar normalisation: `priceAmount1000 / 1000` (`server.js:2890, 2895`) produces rupees; `createProduct` compensates WPP's 10x convention with `1e4 * e.price` (`node_modules/@wppconnect/wa-js/.../wppconnect-wa.js`, module 11561), so `price` on the wire from the sidecar is rupees.
- The editor's own comment (“Meta Catalog micro-units”) describes a value the sidecar already converted.
- Same heuristic and write path in `whatsapp-event-sync.ts:969-972` (see W-07).

**Minimal fix**

Remove `normalizePrice` (use `Number(item.price)`) — the sidecar contract is already rupees — or gate it on a raw `priceAmount1000` field and a sidecar response that has not been normalised.

**Confidence:** confirmed from code for any catalog item ≥ ₹1,00,000 that is a multiple of ₹1,000.

---

### W-07 [MEDIUM] `catalog_master` reconcile adopts 1/1000 prices into PocketBase — `src/lib/whatsapp-event-sync.ts:969`

**What the code does**

```ts
function normalizeWaPrice(value: number): number {
    if (value >= 100000 && value % 1000 === 0) return value / 1000;
    return value;
}
...
// :1057-1069
if (!matchedLive || targetPrice === undefined) continue;
const livePrice = normalizeWaPrice(Number(matchedLive.price) || 0);
if (livePrice > 0 && Math.abs(livePrice - targetPrice) >= 1) {
    await setWhatsAppCatalogPrice(p.id, livePrice);
```

`matchedLive.price` comes from `getCatalogProducts` → sidecar `normalizeCatalogProduct`, already in rupees.

**Why wrong**

Expected: adopting a live catalog price into `channel_prices.whatsapp` preserves the price. Actual: in `catalog_master` mode every item ≥ ₹1,00,000 at a whole-thousand price is written to PB at 1/1000. Since `chat-sales` prices `whatsapp` orders from that channel price, the next concierge order sells at ₹150 for a ₹1,50,000 piece. In `inventory_master` mode the wrong comparison also marks these items as drifted and queues a push on every 6–10 minute reconcile; the worker's own `isAlreadyInSync` check (`:842-847`, which uses the raw sidecar price) then skips it, so the queue churns without converging (wasted mutation budget, not a price change).

**Evidence**

- Sidecar returns rupees (`server.js:2886-2899`); `executeProductCatalogSync` uses `Number(matchedLiveItem.price)` without the heuristic when pushing (`:834`), proving the field is rupees.
- `setWhatsAppCatalogPrice` writes `channel_prices.whatsapp` directly (`whatsapp-catalog.ts:303-311`).
- `chat-sales.ts:165-173` is the consumer of that channel price.

**Minimal fix**

Use `Number(matchedLive.price)` directly (delete `normalizeWaPrice`).

**Confidence:** confirmed from code.

---

### W-08 [MEDIUM] RFM double-counts every WhatsApp chat order (sales mirror + sales_order) — `src/lib/crm-rfm.ts:126`

**What the code does**

RFM sums two ledgers and the code deliberately excludes the storefront mirror only:

```ts
const sales = await pb.collection("sales").getFullList<Sale>({
    filter: `channel != "storefront" && status != "cancelled"${tenantClause()}`,
    ...
});
for (const s of sales) recordPurchase(s.customer, s.created, s.total);
...
const orders = await pb.collection("sales_orders").getFullList({
    filter: `status != "cancelled" && status != "draft"${tenantClause()}`,
    ...
});
for (const o of orders) recordPurchase(String(o.customer || ""), String(o.order_date || o.created || ""), Number(o.total) || 0);
```

But `createSaleFromChat` writes **both** rows for the same chat order:

```ts
// chat-sales.ts:402-418 — mirror
const sale = await pb.collection('sales').create({
    customer: customerId,
    ...
    total,
    status: 'pending',
    channel: 'whatsapp',
    channel_order_id: txnId,
    ...
});
// chat-sales.ts:314-344 — canonical order
salesOrder = await pb.collection('sales_orders').create({
    ...
    status: 'confirmed',
    total,
    capture_source: 'whatsapp',
```

**Why wrong**

Expected: one purchase increments frequency/monetary once. Actual: one chat order adds `total` twice and increments frequency twice. A single ₹20,000 chat purchase yields `frequency=2, monetary=₹40,000`, which crosses the “loyal” rule (`frequency >= 2`, `crm-rfm.ts:192`) and the champion monetary rule (`>= 30000`, `:189`), changing campaign/VIP targeting. The lifecycle win-back flow consumes these fields (`crm-lifecycle-triggers.ts:216`).

Concrete scenario: customer buys one ₹20,000 necklace in a WhatsApp chat. RFM reports 2 orders / ₹40,000, classifies “Loyal Shopper” (or champion at ≥30k), and the VIP/loyalty segmentation and lifecycle triggers act on the inflated profile.

**Evidence**

- Mirror creation: `chat-sales.ts:399-419` (`channel: 'whatsapp'`, `status: 'pending'`, `customer`, `total`).
- Canonical order: `chat-sales.ts:314-344` (`status: 'confirmed'`).
- RFM filters: `crm-rfm.ts:127-135` and `:137-149`; only `storefront` mirrors are excluded, not `whatsapp`.
- No dedupe by `channel_order_id` or by order id.

**Minimal fix**

Exclude `channel = "whatsapp"` from the `sales` query too (`channel != "storefront" && channel != "whatsapp"`), or dedupe `sales_orders` against the mirror by `channel_order_id`.

**Confidence:** confirmed from code.

---

### W-09 [MEDIUM] WhatsApp concierge orders ignore `variant.price_adjustment` — `src/lib/chat-sales.ts:164`

**What the code does**

The pricing call omits the variant adjustment (the 4th argument defaults to 0):

```ts
const price = getChannelPriceFromList(
    {
        base_price: Number(product.base_price) || 0,
        cost_price: Number(product.cost_price) || 0,
        channel_prices: channelPrices,
    },
    'whatsapp',
    channelDefinitions
);
```

The variant is loaded later only for validation, and its `price_adjustment` is never read:

```ts
if (variantId) {
    const variant = await pb.collection('product_variants').getOne(variantId).catch(() => null);
    if (!variant || variant.product !== item.id) throw new VariantMismatchError(item.id, variantId);
    ...
} else {
    const variants = await pb.collection('product_variants').getFullList<{ id: string }>({ ... });
    ...
    variantId = variants[0].id;
}
```

The product card shown to the same customer does include it:

```ts
// whatsapp-crm.ts:1121-1129
const price = getChannelPrice({ ... }, 'whatsapp', Number(v.price_adjustment) || 0);
```

The storefront route explicitly fixed the same issue by passing `variantAdjustment` (`order/route.ts:600-623`).

**Why wrong**

Expected: a variant with a positive/negative price adjustment is sold at `channel price + adjustment`, as displayed in the product card. Actual: the order is priced at the bare channel price, so the WhatsApp order total is lower than the price the customer was shown; refunds/analytics also disagree with the card and with POS. Negative adjustments overcharge.

Concrete scenario: a ring variant “Size 18” has `price_adjustment = 500` and the card shows ₹2,500; `createSaleFromChat` creates the order at ₹2,000.

**Evidence**

- `getChannelPriceFromList` signature accepts the adjustment (`pricing-rules.ts:310-316`); `getChannelPrice` does too (`channel-pricing.ts:282-292`).
- `chat-sales.ts:178-207` never reads `price_adjustment`; `chat-sales.ts:209-215` stores the unadjusted price on `PricedLine`.
- Contrast: `whatsapp-crm.ts:1121-1129` and `order/route.ts:602-623`.

**Minimal fix**

Capture `Number(variant.price_adjustment) || 0` when resolving the variant and pass it as the fourth argument to `getChannelPriceFromList` (add it to `PricedLine`).

**Confidence:** confirmed from code.

---

### W-10 [MEDIUM] 7-day campaign attribution is anchored to campaign creation, not message dispatch, and counts never-sent messages — `src/lib/campaign-attribution.ts:240`

**What the code does**

```ts
const windowStart = new Date(orderDate.getTime() - ATTRIBUTION_WINDOW_DAYS * 86400000);
for (const c of campaigns) {
    const cmpDate = new Date(c.created_at || (c as { created?: string }).created || 0);
    if (cmpDate >= windowStart && cmpDate <= orderDate) {
        const hit = await pb.collection("broadcast_messages").getFirstListItem(
            `campaign="${sanitizeFilter(c.title)}" && recipient_phone~"${orderPhone.slice(-10)}"` +
            ` && account_email="${sanitizeFilter(getCurrentTenantEmail())}"`
        );
        if (hit) { await recordCampaignConversion(c.id, order.total); ... }
```

**Why wrong**

Expected: the order is attributed when a campaign message was sent to that phone within the 7 days before the order. Actual: the window is the campaign *row creation* date, and the message lookup has no `status`/`sent_at`/date predicate.

- A campaign created 30 days ago that sent to the customer yesterday cannot attribute today's order (false negative; the campaign window has moved on even though the message is recent).
- A message that is still `queued` (or `failed`) in `broadcast_messages` satisfies the lookup, so an order is attributed to a campaign the customer never received.
- Multiple campaigns inside the window resolve to the newest row only (iteration order `-created`), not to the message that actually reached the phone.

Concrete scenario: “Diwali” campaign created 2026-10-20, messages queued but still `queued` on 2026-11-17 due to the 150/day quota. An order placed today with no Delivered Diwali message is attributed to Diwali and increments `orders_converted/attributed_revenue` (`:280-314`).

**Evidence**

- Campaign date vs order date at `:246-247`; `broadcast_messages` query at `:250-253` filters only campaign title/phone/tenant.
- `queueCampaign` stores `status: 'queued'` and only later writes `sent_at` when the drain sends (`whatsapp-broadcast.ts:381-390`, `:504-508`).
- `ATTRIBUTION_WINDOW_DAYS = 7` (`:9`) is documented as “recipient phone dispatch within 7-day rolling window” (`:210-212`) — the implementation does not use dispatch time.

**Minimal fix**

Query `broadcast_messages` for `status="sent" && sent_at >= windowStart && sent_at <= orderDate` (tenant-scoped) and attribute on that hit; stop using the campaign creation date as the window.

**Confidence:** confirmed from code (behaviour); the aggregate effect depends on campaign usage.

---

### W-11 [MEDIUM] Shipping and COD fees are accepted from the client; a tampered checkout pays ₹0 shipping — `src/app/api/storefront/order/route.ts:744`

**What the code does**

```ts
const shippingCharges = Math.max(
    0,
    Math.min(5000, Math.round((Number(body.shippingCharges) || 0) * 100) / 100)
);
...
const calculatedTotal = Math.max(0, calculatedSubtotal - verifiedDiscount + shippingCharges);
```

Everything else is recomputed server-side (prices, discount, tax); shipping is only range-clamped. The storefront computes it client-side:

```ts
// storefront/src/app/checkout/page.tsx:151-154
const shippingFee = cartSubtotal >= 799 ? 0 : 99;
const codFee = paymentMethod === "cod" ? 99 : 0;
const finalTotal = Math.max(0, cartSubtotal - discountAmount + shippingFee + codFee);
...
shippingCharges: shippingFee + codFee,   // :336
```

**Why wrong**

Expected: the server owns the money it charges; a tampered client cannot waive a fee. Actual: `shippingCharges: 0` (or `-5000`, clamped to 0) is accepted for a ₹500 COD order, so the COD fee and the below-₹799 shipping fee disappear from both the order total and the Razorpay amount. The maximum clamp also lets a client inflate the charge by ₹5,000, but that only hurts the buyer; the waiver is the real leak.

Concrete scenario: a ₹300 cart with COD. UI would charge ₹300 + ₹99 shipping + ₹99 COD. A modified request body with `shippingCharges: 0` creates the order at ₹300 and charges ₹300.

**Evidence**

- Server accepts `body.shippingCharges` directly (`order/route.ts:744-747`) and adds it to the total (`:751`); no store-settings read for shipping/COD rules exists in this route.
- Client is the only source of `shippingFee`/`codFee` (`storefront/src/app/checkout/page.tsx:151-154, 336`).
- The same route correctly ignores `body.total`, `body.discountAmount` and re-prices items, so shipping is the outlier.

**Minimal fix**

Compute shipping/COD server-side from the same store settings the storefront uses (or drop the client field and derive it from subtotal/payment method), accepting only a server-derived value.

**Confidence:** confirmed from code.

---

### W-12 [MEDIUM] Broadcast queue claim is a non-atomic read-compare-update; two drains can send the same message — `src/lib/whatsapp-broadcast.ts:408`

**What the code does**

`claimQueuedMessage` reads the row twice and then updates it:

```ts
const before = await pb.collection('broadcast_messages').getOne(entryId, { fields: 'status,updated' });
if (String(before.status) !== 'queued') return false;
const after = await pb.collection('broadcast_messages').getOne(entryId, { fields: 'status,updated' });
if (String(after.status) !== 'queued' || after.updated !== before.updated) return false;
await pb.collection('broadcast_messages').update(entryId, { status: 'sending' });
return true;
```

`isProcessingQueue` is a module-level boolean (`:84, :440`), so it only serialises drains in one JS context.

**Why wrong**

Expected: one queued row is sent once. Actual: two contexts (two browser tabs of the WhatsApp hub, the Tauri webview plus a browser, or two Node workers) run the same sequence. Both can observe `queued` with the same `updated` stamp, both then update to `sending` and both call `whatsappManager.sendMessage`, duplicating a marketing message and double-consuming the daily quota (the second send also writes `sent` over the first). The read-compare window is not closed by the update because PocketBase has no conditional update here and the code does not re-read after claiming.

Concrete scenario: the operator leaves the WhatsApp hub open in two tabs; both intervals fire `processBroadcastQueue` at the same due time; the same customer receives the campaign twice.

**Evidence**

- No unique/lock marker is written at claim time; `updated` is only compared before the write.
- `isProcessingQueue` is per module instance (`:84`) and `processBroadcastQueue` returns early only against that instance (`:440`).
- `claimQueuedMessage` is called for every due row at `:496`.

**Minimal fix**

After the `status: 'sending'` update, re-read and require a per-drain claim token (e.g. write `sending_by: drainId` and proceed only if it matches), or use a unique partial index/transaction in PocketBase.

**Confidence:** likely (correct code path; requires two concurrent drains).

---

### W-13 [MEDIUM] Storefront content is saved under the editor's personal email, so the public site never reads the change — `src/app/api/storefront/content/route.ts:420`

**What the code does**

```ts
const safeAdminBinding = {
    ...(current.adminBinding || {}),
    ...(body.adminBinding || {}),
    boundAdminEmail: staffEmail,
};
...
await pb.collection("store_settings").update(existingRecord.id, {
    value: merged,
    account_email: staffEmail,
    category: "storefront_content",
});
// or create with account_email: staffEmail
```

`staffEmail` is the authenticated editor's login (`:366`). The page also seeds the binding with the current user:

```ts
// storefront-control/page.tsx:849-853
adminBinding: {
    ...DEFAULT_STATE.adminBinding,
    ...(content.adminBinding || {}),
    boundAdminEmail: user?.email || content.adminBinding?.boundAdminEmail || "admin@luminila.com",
},
```

Public reads resolve the tenant from the allow-list/single account and read the row under *that* email (`GET`, `:293-306`; single mode `getStorefrontBinding` always returns `SINGLE_ACCOUNT_EMAIL`, `storefront.ts:82-97`).

**Why wrong**

Expected: a staff member with `settings:update` edits the tenant's storefront content. Actual: the write is scoped to their personal `account_email` and rewrites `adminBinding.boundAdminEmail` to themselves. If the editor is not the tenant owner (normal for a manager account), the public GET keeps reading the owner's row and serves the old content; the control page's own GET (authenticated, target = staff email) shows the new content, so the operator believes the site was updated. In multi-account mode the same mismatch can make `resolveStorefrontTenant`/`getStorefrontBinding` follow the staff email instead of the store owner.

Concrete scenario: owner `niththigal@gmail.com` seeded the storefront. Manager `priya@shop.com` has settings:update, changes the hero image and saves; the API writes a new row for `priya@shop.com` with `boundAdminEmail: priya@shop.com`; the public homepage still shows the old hero.

**Evidence**

- Write scope is `staffEmail` (`content/route.ts:423, 449-460`); the public read scope is the resolved public tenant (`:300-306`, `getStorefrontBinding`).
- The page explicitly sends `boundAdminEmail: user?.email` (`storefront-control/page.tsx:852`).
- `hasCapability(..., "settings", "update")` (`content/route.ts:398`) permits non-owner staff, so this path is reachable.

**Minimal fix**

Use the session's tenant owner for both writes and the binding: `const tenant = session.accountEmail` (as `hasCapability` already computes at `:393`) instead of `staffEmail`, and stop overwriting `boundAdminEmail` with the editor.

**Confidence:** confirmed from code (requires a staff editor whose email differs from the tenant owner).

---

### W-14 [LOW] `syncCatalog()` calls the sidecar without the bearer token, so the manual catalog sync always aborts — `src/lib/catalog-sync.ts:92`

**What the code does**

```ts
const res = await fetch(`${SIDECAR_URL}/catalog/products`);
if (!res.ok) throw new Error('Sidecar unreachable');
```

This module imports the URL helper and manager from `@/lib/whatsapp` but uses the global `fetch`; the auth-injecting wrapper in `whatsapp.ts` is a module-local `const fetch` and is not exported. The sidecar requires `Authorization: Bearer`/`x-api-key` on every `/api` route (`server.js:225-249`).

**Why wrong**

Expected: the sync log records the diff and pushes products. Actual: every request is 401, `catalogFetched` stays false, and `syncCatalog` throws `WhatsApp catalog could not be fetched; sync aborted` (`:114-116`) before diffing, then writes a `failed` log row. The feature cannot work in any deployment.

**Evidence**

- No `Authorization` header at `:92`, `:207-211`, `:226-230`, `:236-239`.
- The wrapper that sets the header is local to `whatsapp.ts` (`:96-113`) and is not imported here.
- Sidecar auth middleware is unconditional for `/api` (`:249`).

**Minimal fix**

Export a sidecar-authenticated fetch (or a `getSidecarAuthHeaders()` helper) from `whatsapp.ts` and use it for the four calls in `catalog-sync.ts`.

**Confidence:** confirmed from code.

---

## Checked and clean

Every file below was read in full (or, where stated, its relevant sections were read end-to-end). No other defect from the cluster's definition was found in them.

### Files fully read

- `src/lib/whatsapp.ts`
- `src/lib/whatsapp-broadcast.ts`
- `src/lib/whatsapp-catalog.ts`
- `src/lib/whatsapp-crm.ts`
- `src/lib/whatsapp-notifications.ts`
- `src/lib/whatsapp-binding.ts`
- `src/lib/whatsapp-event-sync.ts`
- `src/lib/whatsapp-flash-drops.ts`
- `src/lib/whatsapp-message-store.ts`
- `src/lib/whatsapp-order-ingestion.ts`
- `src/lib/whatsapp-order-links.ts`
- `src/lib/chat-sales.ts`
- `src/lib/campaigns.ts`
- `src/lib/campaign-attribution.ts`
- `src/lib/crm-rfm.ts`
- `src/lib/crm-lifecycle-triggers.ts`
- `src/lib/consent-ledger.ts`
- `src/lib/channel-orders.ts`
- `src/lib/channel-stock.ts`
- `src/lib/catalog-sync.ts`
- `src/lib/meta-catalog-batch.ts`
- `src/lib/order-milestones.ts`
- `src/lib/razorpay.ts`
- `src/lib/razorpay-orders.ts`
- `src/lib/razorpay-webhook-handler.ts`
- `src/lib/webhook-dedupe.ts`
- `src/lib/customer-token.ts`
- `src/lib/deployment-mode.ts`
- `src/lib/storefront.ts`
- `src/lib/storefront-tenant.ts`
- `src/lib/customer-lookup.ts` (phone helpers used by the cluster)
- `src/app/api/storefront/order/route.ts`
- `src/app/api/storefront/catalog/route.ts`
- `src/app/api/storefront/content/route.ts`
- `src/app/api/storefront/flash-drop/route.ts`
- `src/app/api/storefront/auth/send-otp/route.ts`
- `src/app/api/storefront/auth/verify-otp/route.ts`
- `src/app/api/storefront/auth/delete-customer/route.ts`
- `src/app/api/webhooks/razorpay/route.ts`
- `src/app/api/catalog/batch/route.ts`
- `src/app/api/catalog/feed/route.ts`
- `src/app/api/catalog/image/route.ts`
- `src/app/api/pos/payment/route.ts`
- `src/app/layout.tsx` (sidecar-token injection part)
- `src/app/checkout/whatsapp/page.tsx`
- `storefront/src/lib/api.ts`
- `src/scripts/test-channel-orders.ts`
- `src/scripts/test-gateway-signature.ts`
- `src/scripts/test-webhook-dedupe.ts`
- `src/scripts/test-whatsapp-secret.ts`
- `src/scripts/test-whatsapp-fixes.ts`
- `wppconnect-sidecar/server.js` — auth/CORS/rate-limit middleware, route table, session lifecycle, inbound listeners, catalog/product create/edit/delete/normalize, media, order endpoints (`1-600`, `715-1350`, `1400-1550`, `2040-2200`, `2875-2940`, `3140-3345`, `3520-3583`); the remaining group/label/profile CRUD branches repeat the same `sessionData.client` guard and were not the target of this cluster.

### Additionally reviewed (not every line)

- `src/app/whatsapp/page.tsx` — inbound socket handlers, STOP path, chat persistence, order creation, catalog ingestion, broadcast drain interval (the 5,000-line UI remainder is presentation state).
- `src/app/storefront-control/page.tsx` — fetch/save/binding flow and live preview/theme handlers.
- `src/app/tracking/st-courier/page.tsx` — public AWB page (no data dependency on the cluster).
- `storefront/src/app/checkout/page.tsx` — submit/order/gateway/confirm flows (UI remainder sampled).
- `storefront/src/lib/pocketbase.ts` — customer token storage and order submission.
- `storefront/src/components/CustomerAuthModal.tsx` — OTP send/verify requests.
- `src/app/api/storefront/flash-drop` helper `src/lib/whatsapp-flash-drops.ts` was read in full; the public route was also read in full.

### Behaviours that are already tested (and passed)

- `canonicalPhone`/`phoneSuffix` and the tax-inclusive GST split invariant, including discount-before-tax and multi-rate carts (`test-channel-orders.ts`).
- Razorpay checkout signature: valid tuple accepted; tampered/different-order/missing signature rejected (`test-gateway-signature.ts`).
- Webhook dedupe key shape, duplicate detection, bounded append/eviction and exact rupee↔paise amount matching (`test-webhook-dedupe.ts`).
- Sidecar token resolution precedence, minimum length, whitespace trimming, and absence of a default (`test-whatsapp-secret.ts`).
- Vendor-offer parsing (per-gram vs fixed price) and `WhatsAppManager` session fallback (`test-whatsapp-fixes.ts`).
- `test-channel-stock.ts` (not in the four named scripts but present) covers the atomic decrement/rollback/restore contract of `channel-stock.ts`.

### Clean behaviours verified in code

- **Razorpay webhook is signed and fail-closed.** `webhooks/razorpay/route.ts` requires `x-razorpay-signature`; `processRazorpayWebhookEvent` refuses when `RAZORPAY_WEBHOOK_SECRET` is unset, compares HMAC-SHA256 over the raw body with `timingSafeEqual`, and additionally requires INR and an exact captured amount for `payment.captured`/`payment_link.paid` (`razorpay-webhook-handler.ts:371-512`). Malformed signed JSON is a 400, not a 500.
- **Settlement maps a payment to exactly one order.** The storefront confirm and flash-drop confirm both fetch the payment from the gateway and require `status === "captured"`, the local `gateway_order_id`, and an amount within 1 paisa; both reject a `gateway_payment_id` already used by another order, and the PAID write is serialized per order id in-process.
- **Storefront order tenancy/credential.** The tenant and verified phone come only from the signed customer token (`resolveOrderTenant` rejects a body-selected tenant); product rows are checked against the tenant; the order number is server-generated when the client key is absent.
- **Sidecar HTTP surface is authenticated.** All `/api/*` routes sit behind `requireSidecarAuth` using a timing-safe compare of `Authorization: Bearer`/`x-api-key`; query-string tokens are explicitly rejected; socket handshakes require the same token; the server binds to `127.0.0.1`, enforces an origin allow-list, per-IP request/handshake rate limits, a session-name regex, and refuses to start with a short/default secret. `/health` is unauthenticated but exposes only uptime/session counts. No sidecar endpoint leaks the secret or token files.
- **Consent ledger writes are append-only by rule and fail closed on read errors.** Marketing audiences are opt-in (`opt_in_marketing != false`) and both dispatch paths re-check the opt-out registry. The one real bypass is W-03 (the registry is never fed by STOP).
- **Channel stock is a single implementation** with atomic `stock_level-`, compensation on partial failure, tenant-scoped ledger rows, and movement-marker-based idempotent restore. Storefront COD, chat orders, POS and settlement all use it (the flash-drop allocation contract is the exception described in W-04).
- **Phone helpers agree on matching.** `phoneSuffix`/`canonicalPhone`, `normalizePhone`/`phoneFromChatId`, `normalizeE164`, and the route-level `phoneLast10` all compare the last ten digits and store a `+91` canonical form; the cross-channel lookups (`findExistingChannelOrder`, `upsertChannelCustomer`, opt-out registry) use suffix matching, so no wrong-customer match was found in this cluster.

### Test gaps visible from the suites

- No test drives `POST /api/webhooks/razorpay` end-to-end (only the pure dedupe/amount helpers), so the tenant-scoped settlement path and the notification marker are untested.
- No test covers STOP auto-registration, storefront idempotency replay, flash-drop hold expiry vs confirmation, RFM ledger sources, catalog price normalisation, or broadcast claim concurrency — the areas of W-03 through W-08 and W-12.
