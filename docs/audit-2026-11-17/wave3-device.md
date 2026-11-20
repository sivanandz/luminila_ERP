# Wave 3 — Device & Storefront Surfaces

Scope: `src/lib/offline-queue.ts`, `mobile-printer.ts`, `mobile-scanner.ts`, `mobile-whatsapp.ts`, `sound-effects.ts`,
`niththigal-content.ts`, `src/app/page.tsx`, `src/components/dashboard/*`.
Files read beyond the list (to prove claims): `src/lib/analytics.ts`, `src/lib/analytics-v2/load.ts`, `src/lib/pocketbase.ts` (relevant ranges).
Report only; no app code was changed.

Severity counts: **Critical 0 · High 2 · Medium 4 · Low 5**.

---

### D-01 [High] Offline mutations queued without a live session land in a `_default` tenant namespace and are never replayed — src/lib/offline-queue.ts:109

**What the code does**

```ts
// offline-queue.ts:109
const accountEmail = getCurrentTenantEmail();
...
// offline-queue.ts:32
return getTenantStorageKey(STORAGE_KEY_BASE);
```

```ts
// pocketbase.ts:705-710
export function getCurrentTenantEmail(): string {
    if (isSingleAccountMode()) return SINGLE_ACCOUNT_EMAIL;
    ensureAuth();
    const model = pb.authStore.model as { email?: string; account_email?: string } | null;
    return String(model?.account_email || model?.email || "").trim().toLowerCase() || "default";
}
// pocketbase.ts:716-719
export function getTenantStorageKey(baseKey: string): string {
    const email = getCurrentTenantEmail();
    return `${baseKey}_${email}`;
}
```

`ensureAuth()` **clears** a session it considers expired (`pocketbase.ts:274-277`: `pb.authStore.clear(); return false;`),
so `getCurrentTenantEmail()` falls through to the literal string `"default"`. `enqueue()` then writes to
`luminila_offline_mutations_default` and stores `accountEmail: "default"`.

**Why it is wrong (concrete scenario)**

1. Showroom tablet runs the POS offline. Session is absent (first launch of the Tauri/Android shell, storage cleared,
   tenant reset, or an expired token — `authStore.isValid === false` either way).
2. Operator completes offline sales. Every sale is queued under storage key `..._default`, not under
   `..._owner@store.com`.
3. The operator signs in. `getQueue()` now reads `..._owner@store.com` and **never sees the `_default` queue again**,
   for the whole life of the browser profile.
4. `flush()`'s tenant guard cannot help: the guard compares `mutation.accountEmail` against `currentTenant` **on a queue
   that was already filtered by tenant**, so it can only ever see the `_default` entries while `"default"` is still the
   current tenant.

The sales disappear silently: no record, no revenue in the dashboard, no stock decrement, no dead letter (dead letters are
tenant-scoped by the same key, so they are also invisible), and no log line. The invoice the customer walked away with
exists only on paper.

**Evidence**

- `offline-queue.ts:109, 132-148` stamps `accountEmail` from `getCurrentTenantEmail()`; `:31-33,35-37` derive both storage
  keys from it.
- `pocketbase.ts:710` is the only fallback: `"" || "default"`.
- `pocketbase.ts:274-277` shows an expired session is actively cleared, i.e. `"default"` is reachable on a device that was
  legitimately logged in a moment earlier.
- `offline-queue.ts:222` (`mutation.accountEmail !== currentTenant`) is structurally unable to detect this, because the
  entry is not in the queue being iterated.
- Same defect strands `getDeadLetters()`/`clearDeadLetters()` (`:189-202`).

**Minimal fix**

Refuse to enqueue without a real tenant, and keep the entry discoverable:

```ts
const accountEmail = getCurrentTenantEmail();
if (accountEmail === 'default' || !accountEmail) {
    // do not mint a namespace no session can ever drain
    throw new OfflineQueueError('not-authenticated');
}
```

plus a one-time migration that, on login, re-keys any `..._default` entries to the now-current tenant (merging into that
queue, de-duplicating by `id`) instead of abandoning them.

**Confidence** High on the mechanism (all four links verified in code). The only environmental premise is that the app can
enqueue while `authStore` is empty — which is the defined purpose of an offline queue.

---

### D-02 [High] During a drain, a concurrent edit is merged into the queue and then deleted unseen — silent lost update — src/lib/offline-queue.ts:220

**What the code does**

```ts
// offline-queue.ts:212,220-245
const queue = this.getQueue();          // snapshot taken once
...
for (const mutation of queue) {         // stale object references
    ...
    await pb.collection(mutation.collection).update(mutation.recordId, mutation.data);
    this.remove(mutation.id);           // deletes by id only — no content check
    processed++;
```

```ts
// offline-queue.ts:119-128  (enqueue merges into the stored row, same id)
const merged: PendingMutation = {
    ...queue[existingIndex],
    timestamp: Date.now(),
    data: { ...(queue[existingIndex].data || {}), ...(data || {}) },
    accountEmail: queue[existingIndex].accountEmail || accountEmail,
};
queue[existingIndex] = merged;
```

`remove()` filters by `id` alone (`:159`). `enqueue` preserves the `id` when it merges.

**Why it is wrong (concrete scenario)**

1. Queue holds `M = {id: mut_1, update products/p1, data: {price: 100}}`.
2. Connectivity returns; `flush()` snapshots the array and `await`s the PATCH — on a 3G showroom link this is hundreds of
   milliseconds to seconds.
3. In that window the operator corrects the price to 120. `enqueue('products','update',{price:120},'p1')` finds `mut_1`
   still in storage, merges to `{price: 120}` and saves. The server has not yet returned.
4. The PATCH resolves. `this.remove('mut_1')` deletes the storage row — which now holds the **120** payload — and reports
   `processed++`.
5. Server: 100. Local UI: 120. Storage: nothing. Next screen load silently reverts to 100 and nobody is told.

This is the "loses a queued mutation" class: the newer value is destroyed by a write that was already in flight, and the
queue believes the drain succeeded.

**Evidence**

- `:220` iterates the snapshot array; `:123` creates a **new** object, so the in-flight `mutation` keeps the old `data`.
- `:245` -> `:158-160` deletes purely by `id`; there is no compare-and-remove on `timestamp` or content.
- `persistMutation` (`:168-173`) has the same read-replace-by-id shape, so a failure path can equally overwrite a merged
  row with the older payload.

**Minimal fix**

Make removal conditional on the row not having changed since it was read:

```ts
private static removeIfUnchanged(mutationId: string, seenTimestamp: number) {
    const queue = this.getQueue();
    const row = queue.find((m) => m.id === mutationId);
    if (!row || row.timestamp !== seenTimestamp) return false; // a newer edit exists
    this.saveQueue(queue.filter((m) => m.id !== mutationId));
    return true;
}
```

and call it with `mutation.timestamp`; when it returns `false`, leave the row queued so the merged payload is replayed.

**Confidence** High (mechanism fully visible; the window is the PATCH round-trip, i.e. exactly when a POS operator is
working).

---

### D-03 [Medium] `isFlushing` is never reset on a throw — one storage error stops all replay for the session — src/lib/offline-queue.ts:215

**What the code does**

```ts
this.isFlushing = true;                 // :215
...
for (const mutation of queue) { try { ... this.remove(mutation.id); ... } catch (err) { ... } }
this.isFlushing = false;                // :284  — no try/finally
```

`remove()`, `persistMutation()` and `deadLetter()` all call `saveQueue()`, which calls
`localStorage.setItem(...)` **without** a try/catch (`:95`).

**Why it is wrong (concrete scenario)**

A create payload carrying an inline image (the storefront CMS stores data URLs, per `niththigal-content.ts:112-113`
"Data URLs (or absolute URLs) for the uploaded brand assets") exhausts the 5 MB origin quota. `setItem` throws
`QuotaExceededError` inside `remove()` -> that throw is caught by the loop's `catch` as if the *network* call failed ->
`persistMutation()` saves again -> throws again, now **outside** any handler -> `flush()` rejects with `isFlushing === true`.
From that point in that tab, `flush()` returns `{processed: 0, failed: 0}` forever (`:208-210`) and every "online" event,
interval or manual drain reports success while nothing replays. The mutation is never dead-lettered either, so there is no
trace.

**Evidence**

- `:208-210` early return keyed on the flag; `:215` set, `:284` clear, no `finally`.
- `:95` `localStorage.setItem` unguarded; `:158-161`, `:168-173`, `:175-186` all funnel through it.
- `:266-272` calls `persistMutation` from inside the `catch`, which is the second, uncaught throw site.

**Minimal fix**

Wrap the drain body in `try { ... } finally { this.isFlushing = false; }`, and wrap `saveQueue`'s `setItem` in a try/catch
that reports a distinct `failed` reason (quota) instead of converting it into a per-mutation retry.

**Confidence** High on the control flow; Medium on the trigger frequency (quota is the realistic one).

---

### D-04 [Medium] The hardware-wedge listener turns fast hand typing into a barcode and swallows Enter — src/lib/mobile-scanner.ts:255

**What the code does**

```ts
// :255-258
if (elapsed > 100) { this.barcodeBuffer = ''; }
this.lastKeyTime = now;

if (e.key === 'Enter') {
    if (this.barcodeBuffer.length >= 3) {
        const scanned = this.barcodeBuffer.trim();
        ...
        e.preventDefault();                       // :267 — form submit / textarea newline killed
        ...
        void this.dispatchScan(scanned, 'hardware');
    }
} else if (e.key.length === 1) {
    if (isRegularInput && elapsed > 100 && this.barcodeBuffer.length === 0) return;
    this.barcodeBuffer += e.key;                  // :285 — ordinary typing is buffered too
}
```

The guard at `:282` is inert: line `:255` has already emptied the buffer whenever `elapsed > 100`, so the condition
`elapsed > 100 && barcodeBuffer.length === 0` is true precisely when the buffer was just cleared. It only ever suppresses
the *first* character of a slow keystroke; nothing suppresses characters 2..n.

**Why it is wrong (concrete scenario)**

POS billing, focus in the customer-name (or phone) field. The cashier types a 10-digit number faster than 100 ms/character
and presses Enter to move on. Enter sees `barcodeBuffer.length >= 3`, calls `preventDefault()` (the field's submit/next
action is dead) and dispatches `"9876543210"` through the **barcode** pipeline: the POS reports "barcode not found",
or — worse — matches an SKU and adds a line. The listener is on `window` with `capture: true` (`:289`), so this happens
regardless of which component owns the field.

The same path also means a hardware scan with focus in an ordinary field types the raw barcode into that field (the
`data-scanner-input` write-back at `:271-275` is additive, not exclusive), e.g. 13 digits into a discount or quantity input.

**Evidence**

- `:242-249` computes `isRegularInput` but only uses it for the inert guard and the write-back; the characters are still
  appended at `:285`.
- `:255-257` clears the buffer before the guard is evaluated.
- `:266-278` `preventDefault()` + `dispatchScan` unconditionally when the buffer is ≥ 3 characters.
- `:289` capture-phase listener on `window`.

**Minimal fix**

Track a per-keystroke cadence and only treat a burst as a scan when **every** inter-key gap in the burst is below the
threshold; reset the buffer for any keystroke originating in a non-dedicated input above the threshold, and only
`preventDefault()`/`dispatchScan` when the burst was classified as a scan (or when a `tauri_native`/dedicated-input
source is active).

**Confidence** High on the logic (the guard cannot work as written); Medium on real-world frequency (needs sustained
<100 ms/char human input).

---

### D-05 [Medium] A backend failure renders a complete, error-free dashboard of zeros — `degraded` is never surfaced — src/app/page.tsx:44

**What the code does**

```ts
// page.tsx:44-62
const [statsData, trendData, productsData, channelsData, activityData] = await Promise.all([
    getDashboardStats(), getSalesTrend(30), getTopProducts(5), getChannelBreakdown(), getRecentActivity(8),
]);
...
} catch (error) { console.error("Error loading dashboard:", error); }
finally { setLoading(false); setRefreshing(false); }
```

```ts
// analytics.ts:212-216
} catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return { ...empty, degraded: true };
}
```

`loadTxWindow` deliberately throws instead of returning `[]` (`load.ts:138-140`, "A failure here must NOT be turned into an
empty transaction set: that silently reported ₹0 revenue for every KPI"). `getDashboardStats` then converts that throw into
`empty`. `KPICards`'s prop type (`KPICards.tsx:46-58`) does not even declare `degraded`.

**Why it is wrong (concrete scenario)**

PocketBase is down or the tunnel is broken at 09:00. The owner opens `/`. `getDashboardStats()` throws internally, returns
all zeros with `degraded: true`; `getSalesTrend` returns `[]`; `loadDashboard`'s catch only writes to the console and the
`finally` clears the spinner. The screen therefore shows **"Revenue (30d) ₹0.00 · Today ₹0.00 · 0 orders · 0 products ·
0 low stock"** with no banner, no toast, no retry — i.e. a fully-formed, plausible business state that is entirely false.
The operator acts on it (e.g. reorders stock that is actually low, or tells the owner the day had no sales).

**Evidence**

- `analytics.ts:213-216` (total-failure path) and `:171-180, 189-196` (partial-failure paths) both set `degraded`.
- No read of `degraded` in `page.tsx` (only `stats` is passed) nor in `KPICards.tsx`; `console.error` is the only output.
- `load.ts:138-140` documents the exact failure mode being reintroduced one layer up.

**Minimal fix**

Add `degraded?: boolean` to the `KPICards` props, render a persistent "figures unavailable — last attempt failed" banner
(and hide/grey the values) when `stats.degraded` is true, and have `loadDashboard` set an `error` state from the `catch`
instead of only logging.

**Confidence** High (proven end-to-end from throw to render).

---

### D-06 [Medium] Storefront defaults publish commercial/legal promises with no contact channel, enabled by default — src/lib/niththigal-content.ts:370

**What the code does**

```ts
// :369-370
export const NITHTHIGAL_DEFAULTS: NiththigalContent = {
    enabled: true,
...
// :426-430
contact: { whatsappPhone: "", supportEmail: "", instagramUrl: "" },
```

The same block is served as the page whenever no CMS record exists (`mergeNiththigal` overlays the saved payload on these
defaults, `:756-794`), and it states, among others:

- `:654` "Pay online via Razorpay, reserve on WhatsApp, or choose cash on delivery."
- `:659-660` "dispatched within 24–48 hours"; `:627` "covered by our 7-day easy return promise".
- `:717` privacy page: "We do not store card details. You can request deletion of your account and data at any time
  through our support concierge."
- `:711` / `:718` CTAs "Talk to our concierge" / "Contact support".

**Why it is wrong (concrete scenario)**

A fresh tenant (or any deployment where the CMS record has not been saved yet) goes live with `enabled: true`. A shopper
opens Shipping & Returns or Privacy and hits "Talk to our concierge" — `contact.whatsappPhone` and `supportEmail` are
`""`, so the CTA resolves to nothing. In the same visit the shop has publicly promised COD, a 7-day return and a
data-deletion channel that do not exist yet. That is unreviewed draft copy published as the live storefront policy, and it
is the version shipped by default rather than the version anyone approved.

**Evidence**

- `:370` `enabled: true` (no gating on a saved record).
- `:426-430` empty `contact` object; the two info pages are returned from `info.shipping/privacy/care` (`:707-726`) with
  CTAs that depend on it.
- The doc comment at `:5-7` confirms this block is what `/api/storefront/content` serves as the base payload.

**Minimal fix**

Default `enabled: false` (or gate the storefront on the presence of a saved record), and require a non-empty
`contact.whatsappPhone`/`supportEmail` before the info-page CTAs render — otherwise hide the CTA instead of shipping a dead
legal promise.

**Confidence** High on the code path; the copy/policy judgement is a business decision, but the dead contact channel is a
hard defect.

---

### D-07 [Low] A re-edited pending update inherits the previous attempt count and error — src/lib/offline-queue.ts:119

**What the code does**

```ts
const merged: PendingMutation = {
    ...queue[existingIndex],       // carries retries + error
    timestamp: Date.now(),
    data: { ...(queue[existingIndex].data || {}), ...(data || {}) },
    accountEmail: queue[existingIndex].accountEmail || accountEmail,
};
```

`retries` and `error` are spread in from the old row; only `timestamp`, `data` and `accountEmail` are refreshed.

**Why it is wrong**

An update to product `p1` failed 4 times (e.g. a server-side 500 during an incident) and is persisted with `retries: 4`.
The operator fixes the value and saves again. The merged row still has `retries: 4`, so the **new** payload gets exactly one
attempt; the next failure dead-letters it (`:226-229` / `:266-267`) — a payload that was never actually tried is dropped and
the user is told the edit is queued.

**Evidence** `:119-128` (spread), `:226` / `:266` (budget check).

**Minimal fix** `retries: 0, error: undefined` in the merged object.

**Confidence** High.

---

### D-08 [Low] The activity feed lists one storefront sale twice — src/lib/analytics.ts:345

**What the code does**

```ts
// :345-348  "Recent sales (mirror rows still appear in the activity feed — they are real events...)"
const sales = await pb.collection('sales').getList<Sale>(1, 5, { filter: `account_email="..."`, sort: '-created' });
...
// :363-368  the corresponding order, same transaction
const orders = await pb.collection('sales_orders').getList<SalesOrder>(1, 5, {...});
```

**Why it is wrong**

A storefront checkout writes `sales_orders` **and** a mirror `sales` row (`load.ts:4-12`). Both are pushed into
`activities`, so the "Recent Activity" panel shows "New Sale (Storefront) ₹1,499 — 2 min ago" and
"Order ORD-0001 ₹1,499 — 2 min ago" for the same transaction, consuming 2 of the 8 slots. With 5 sales in the window the
panel can show 10 of 8 entries — i.e. storefront activity crowds out POS/purchase activity entirely.

**Evidence** `:352-361` (mirror includes `channel === MIRROR_CHANNEL`) plus `:369-378`; the slice at `:430` then cuts the
list, so duplicates displace real events.

**Minimal fix** Skip `sales` rows whose `channel === MIRROR_CHANNEL` in the feed, or key the feed on the canonical tx
(`id` of the order) and de-duplicate before `slice`.

**Confidence** High.

---

### D-09 [Low] `ScanResult.format` is declared but never populated — src/lib/mobile-scanner.ts:121

**What the code does**

```ts
// :12-17
export interface ScanResult { barcode: string; format?: string; ... }
// :121
const result: ScanResult = { barcode: cleaned, source, context: activeContext };
```

`format` is never assigned on any of the three dispatch paths (`:128`, `:164`, `:221`).

**Why it is wrong** Any handler that routes on symbology (e.g. accept DataMatrix dumbbell tags but reject EAN-13 in
packing, or tell a coupon QR from an SKU barcode) receives `undefined` and silently takes its default branch — a wrong
parse with no error. No in-scope consumer was read, so the impact is latent, not yet demonstrated.

**Evidence** `:12-17` declares it; `:121` omits it; `:219` / `:163` both discard the detector's format information
(`codes[0]?.rawValue` only).

**Minimal fix** Populate it at the source (`codes[0].format` for the browser path; the plugin's symbology for Tauri) and
pass it through `dispatchScan(barcode, source, format)`.

**Confidence** High that the field is dead; impact conditional on a consumer.

---

### D-10 [Low] The "Products" KPI card's subtitle shows pending orders — src/components/dashboard/KPICards.tsx:94

**What the code does**

```ts
<KPICard title="Products"
    value={stats.totalProducts.toLocaleString()}
    subtitle={pluralize(stats.pendingOrders, "pending order")}   // :97
```

**Why it is wrong** A card labelled Products carries an unrelated order count; with 412 products and 3 pending orders it
reads "412 — 3 pending orders", which invites reading pending orders as a property of the catalogue. The number itself is
correct; its placement is misleading.

**Evidence** `:94-100` vs. the `totalOrders` card at `:72-78`, which has no such subtitle.

**Minimal fix** Move the pending count to the Orders card's subtitle (or drop it).

**Confidence** High.

---

### D-11 [Low] `startCameraScan` both dispatches and returns the scan, so callers that use the value double-handle it — src/lib/mobile-scanner.ts:147

**What the code does**

```ts
// :163-166 (Tauri path)
await this.dispatchScan(res.content, 'tauri_native');
return res.content;
// :221 (browser path)
await this.dispatchScan(value, 'camera');
return value;
```

Every successful scan is delivered **twice** by design: once through `registerContext`/`onScan` subscribers and once as the
function's return value.

**Why it is wrong** The natural caller pattern `const code = await startCameraScan(); if (code) addItem(code)` — which is
what the `Promise<string | null>` signature advertises — applies the item twice: the registered POS handler adds it, then
`addItem` adds it again. Unlike the hardware path (which returns nothing), the camera path therefore cannot be used with
its return value safely.

**Evidence** `:147` signature, `:163-165` + `:221-222` dispatch-and-return, `:113-140` fan-out to all handlers.

**Minimal fix** Pick one contract: either dispatch internally and resolve `boolean` ("handled"), or return the raw scan and
let the caller dispatch. Document it in the JSDoc either way.

**Confidence** High on the double-delivery contract; the duplicate add requires a caller that uses the return value, which
was outside the read budget.

---

## Clean

- **`src/lib/mobile-printer.ts` — clean for both printer classes.** No total is recomputed: `subtotal`, `discountTotal`,
  `cgst`, `sgst`, `grandTotal` and each line's `total` are printed verbatim via `toFixed(2)` (`:142-161`), so a receipt can
  never disagree with the numbers handed to it. There is no barcode rendering path at all. Every free-text field —
  store name/address/phone/GSTIN, invoice no, date, cashier, customer, item name, SKU, payment method, footer — passes
  through `escapeHtml` (`:113-166`), which matters because the payload is `document.write`-ed into a same-origin iframe.
  Only `cgst`/`sgst` are modelled (`:29-30`); an IGST split is the caller's concern and was not verifiable in scope.
- **`src/lib/sound-effects.ts` — clean.** Best-effort Web Audio only; `getContext()` returns `null` under SSR
  (`:10`) and every public method is wrapped in `try/catch` (`:27, 55, 83`), so a blocked/suspended `AudioContext` cannot
  throw into the scan or checkout path. No state that can affect figures, scans or queues.
- **`src/lib/niththigal-content.ts` merge logic — clean.** Arrays are replaced wholesale, objects merge key by key,
  `undefined`/`null` fall back to the default (`:761-772`), `enabled`/`order`/`space*` use `?? ` and `typeof` so a saved
  `false` or `0` survives (`:777-792`), and `sections` is always rebuilt over every known id so a payload predating a new
  section cannot blank it. The read path cannot produce a lost update (see D-06 for the default-content issue; the save
  route itself was out of scope).
- **`offline-queue.ts` — no duplicate replay found.** Creates carry a deterministic 15-char id (`:53-57`) and are replayed
  with `{...data, id}` (`:236-238`); a duplicate error is only treated as success after `getOne(clientRecordId)` confirms
  the row exists (`:251-261`), so a lost-response retry cannot insert twice and a collection that rejects client ids is not
  silently "deduplicated". Updates replay absolute payloads, so a repeated PATCH is idempotent; per-row
  `persistMutation` (`:168-173`) correctly avoids resurrecting rows removed earlier in the same pass.
- **`mobile-whatsapp.ts` — clean.** The phone normaliser only prefixes `91` for bare 10-digit input and leaves anything
  else untouched (`:30-36`); the message is built from the caller's `total`/`grandTotal` without recomputation, so it cannot
  invent a price. The sidecar call is correctly shaped (`/api/<session>/send-message`, bearer token, 3 s timeout,
  `:97-108`) and any non-OK or unreachable response falls back to the intent (`:113-120`) rather than reporting a false
  success.
- **Dashboard figures — no double count, no cancelled rows, no cache.** `src/lib/analytics.ts` + `analytics-v2/load.ts`
  derive every KPI, the 30-day trend, the channel pie and the top-product table from one canonical
  `loadTxWindow` (`load.ts:126-136`) which excludes `channel="storefront"` mirrors, WhatsApp mirrors
  (`channel="whatsapp" && channel_order_id != ""`), `status="cancelled"` sales, and any order outside
  `confirmed|shipped|delivered|invoiced`. There is **no client-side cache anywhere** in the read set — each call refetches
  (`analytics.ts:134, 230, 316-321`), so a "stale cache" figure is not reachable. `degraded` handling is the one gap (D-05).
- **`SalesChart.tsx`, `ChannelBreakdown.tsx`, `TopProducts.tsx`, `RecentActivity.tsx` — arithmetic clean.** The tooltip
  reads `orders` from the data point rather than a second series (`SalesChart.tsx:33-47`); the pie keys on `revenue` and
  the legend uses the server-computed `percentage`; `maxRevenue` uses `Math.max(..., 1)` so a zero-revenue list cannot
  divide by zero (`TopProducts.tsx:21`); `RecentActivity` guards `amount !== undefined` and formats dates through
  `safeFormatDate`. Remaining observations are cosmetic (IST-only date parsing at `SalesChart.tsx:58`, 6-colour palette
  wrap) and out of scope.
