# Wave 2 audit — sales orders, challans, logistics, reports, analytics, AI

Date: 2026-11-17
Scope: `src/lib/orders.ts`, `challan.ts`, `shipments.ts`, `logistics-engine.ts`, `sequence-generator.ts`, `concurrency.ts`, `reports.ts`, `analytics.ts`, `analytics-v2/**`, `ai-client.ts`, `ai/**`, and the app pages under `src/app/{orders,challan,reports,analytics,assistant}/**`.
Method: full file reads, caller tracing (`git grep`), state-trace and arithmetic proofs. `eway-bill*.ts` excluded (audited elsewhere). Baseline `tsc`/eslint/30 suites assumed clean per brief; every claim below is proved from code, not from existing reports.

Severity counts: **1 Critical, 7 High, 10 Medium, 4 Low** (22 findings).

---

### O-01 [CRITICAL] Storefront coupon discount is dropped when the invoice is generated — `src/lib/orders.ts:520`
- What the code does:
  ```ts
  const gross = (item.unit_price || 0) * (item.quantity || 1);
  const taxable = Math.max(0, gross - (item.discount_amount || 0));
  ...
  const grandTotal = subtotal + totalTax + shippingCharges;      // :598
  ```
  Invoice lines are built from `sales_order_items.discount_amount` only; the order-level `discount_total` is written to the invoice header (`discount: order.discount_total`, `discount_amount: order.discount_total`, :619/:627) but never subtracted from `grandTotal`.
- Why wrong: the storefront checkout stores the coupon on the **header only** — `discount_total: verifiedDiscount` and `total = calculatedSubtotal - verifiedDiscount + shippingCharges` (`src/app/api/storefront/order/route.ts:749-751,825`), while item rows are created with no `discount_amount` (`:898-911`). `createInvoice` recomputes the grand total from items + shipping and ignores the discount field (`src/lib/invoice.ts:534-542,589-604`), so the wrong amount is persisted silently.
  Concrete: cart 1 × ₹1,200 GST-inclusive, `MYCART49` = ₹49 off, shipping ₹99 → order/paid total **₹1,250**. Invoice lines: gross ₹1,200, no line discount → taxable ₹1,165.05 + 3% GST ₹34.95 + shipping ₹99 = **₹1,299**; invoice header says discount ₹49. Taxable value and GST are overstated on every couponed storefront order.
- Evidence: `generateInvoiceFromOrder` is the invoice path for storefront settlement (`src/lib/razorpay-webhook-handler.ts:250-258` calls it after setting the order `confirmed`); `pricesIncludeGst` is true for `capture_source='storefront'` (`orders.ts:515-518`); `createInvoice`'s mismatch check passes because `subtotal/tax/grand_total` were all computed from the same (undiscounted) lines. `test-capture-invariants.ts:134` itself submits `couponCode: 'MYCART49'`.
- Minimal fix: allocate the header discount across lines before mapping (`headerDiscount = max(0, order.discount_total - Σ item.discount_amount)`), or pass the net taxable/line total to `createInvoice` and set the header `discount` only for the order-level part.
- Confidence: confirmed

### O-02 [HIGH] Any non-cancelled order can be dispatched again, regressing `delivered` to `shipped` — `src/lib/shipments.ts:149`
- What the code does:
  ```ts
  const order = await db.collection('sales_orders').getOne(input.orderId);
  if (!canActOnTenant(order.account_email, db)) ...
  if (['cancelled', 'refunded'].includes(String(order.status || ''))) ...
  ...
  const shipment = await db.collection('shipments').create({ ... shipping_status: 'in_transit' });
  const orderUpdate: Record<string, unknown> = { status: 'shipped' };   // :174
  await db.collection('sales_orders').update(input.orderId, orderUpdate);
  ```
  There is no `confirmed|invoiced` status gate and no "already dispatched" check. `markSalesOrderShipped` has exactly that gate (`orders.ts:795-799`), but it is unused.
- Why wrong: expected dispatch only from confirmed/invoiced, exactly once; actual:
  - a **delivered** paid order can be "Record Dispatch"ed again → a second shipment + AWB row, and its status is overwritten back to `shipped` (so it can be "delivered" a second time);
  - a **shipped** order accepts another dispatch (duplicate AWBs for one order);
  - multiple shipment rows are then possible, and delivering the first parcel marks the whole order delivered (`shipments.ts:235-240`).
  The order-detail page renders the button for every non-estimate order regardless of status (`src/app/orders/detail/page.tsx:608-612`), and the AWB modal does not re-check status.
- Evidence: direct UI path (order detail → Record Dispatch, `page.tsx:609`), and `createShipmentForOrder` is also called from `BarcodeScanDispatchModal.tsx:278` and `RapidManifestPanel.tsx:110`. The payment gate (`isPaidOrCod`) passes for delivered PAID orders, so the regression is reachable with normal data.
- Minimal fix: before creating, require `status` ∈ `confirmed|invoiced` and reject when a shipment with an AWB already exists for the order (or when status is `shipped|delivered`).
- Confidence: confirmed

### O-03 [HIGH] Marking a leftover shipment delivered resurrects a cancelled order — `src/lib/shipments.ts:235`
- What the code does:
  ```ts
  if (status === 'delivered' && shipment.order_id) {
      await db.collection('sales_orders').update(shipment.order_id, { status: 'delivered' });
  }
  ```
  No order-status guard: the write runs even if the order is `cancelled`/`refunded`.
- Why wrong: `cancelSalesOrder` never cancels shipment rows — it only closes payment links, POS mirrors, invoices and packing sessions (`orders.ts:949-1003`) — and its dispatched-shipment check only applies to `status === 'invoiced'` and only rejects `in_transit|delivered` shipments (`orders.ts:888-903`). A shipment left in `pending`/`manifested` state (the legacy `createShipment` writes `manifested`, `shipments.ts:76-85`) survives cancellation. The order detail page then still renders "Mark delivered" for every shipment whose status is not `delivered`, even on a cancelled order (`src/app/orders/detail/page.tsx:596-604`).
  Scenario: invoiced order with a legacy manifested shipment → cancel (allowed, because not in_transit/delivered) → order cancelled, invoice voided, stock restored → click "Mark delivered" → `sales_orders.status` becomes `delivered` for a cancelled order.
- Evidence: `updateShipmentStatus` transitions validated only inside the shipment's own state machine (`SHIPMENT_TRANSITIONS`, :47-53), never against the order; no shipment cleanup in `cancelSalesOrder`.
- Minimal fix: refuse any shipment transition when the parent order is `cancelled`/`refunded`, and cancel/remove open shipment rows in `cancelSalesOrder`.
- Confidence: likely (requires a shipment row that is not `in_transit`/`delivered` on a cancelled order; legacy rows are documented in the module itself)

### O-04 [HIGH] A failed shipment read lets a dispatched order be cancelled — `src/lib/orders.ts:889`
- What the code does:
  ```ts
  const activeShipments = await pb.collection('shipments')
      .getFullList<{ id: string; shipping_status?: string }>({ filter: ..., requestKey: null })
      .catch(() => []);
  const dispatched = activeShipments.find((s) => s.shipping_status === 'in_transit' || s.shipping_status === 'delivered');
  if (dispatched) throw new Error(...);
  ```
  Every read error (timeout, 500, PB restart) is converted to "no shipments".
- Why wrong: the dispatched guard fails open. Expected: only a genuine 404 may mean "no shipment" (the file already has `isNotFoundError` for exactly this, :405-408). Actual: a transient shipment-query failure lets an `invoiced` order with an in-transit/delivered parcel be cancelled; cancel then voids linked invoices (`:977-990`), restores stock (`:914`) and marks the order cancelled (`:1015`), while goods are in transit.
- Evidence: `cancelSalesOrder`'s only shipment check is this fail-open query; the `requestKey: null` only disables PB request auto-cancellation, not errors.
- Minimal fix: `.catch((err) => { if (isNotFoundError(err)) return []; throw err; })` and refuse the cancel when the read fails.
- Confidence: likely (fail-open is confirmed; the trigger is a transient read failure)

### O-05 [HIGH] Cancelling an order leaves its linked invoice alive unless status is exactly `invoiced` — `src/lib/orders.ts:977`
- What the code does:
  ```ts
  if (order.status === 'invoiced') {
      const linkedInvoices = await pb.collection('invoices').getFullList({ filter: `order="..."` ... });
      for (const inv of linkedInvoices) { if (inv.status !== 'cancelled') update(inv.id, { status: 'cancelled' }); }
  }
  ```
  Invoice voiding is keyed on the order's status instead of on the existence of invoices.
- Why wrong: the code itself produces "invoice exists, order not invoiced":
  - the existing-invoice branch swallows the status update: `await ...update(orderId,{status:'invoiced'}).catch(() => {})` (`:453-455`), then returns success;
  - the final status update is inside the outer `try`, so a failed update returns `{success:false}` **after** the invoice was created (`:664-665`, comment at `:430-433` acknowledges this retry state).
  Cancelling such a `confirmed`/`draft` order restores stock and marks it cancelled but skips the void block. The pending invoice remains and is included by `getSalesReport` (`reports.ts:215` excludes only draft/cancelled) and GSTR-1 (`reports.ts:258`), so a cancelled order still contributes revenue and tax.
- Evidence: UI exposes Cancel for `confirmed` (`canCancelSalesOrder`, :830-831; detail page :421). Invoice rows are linked by `order` but never re-read in the non-invoiced cancel path.
- Minimal fix: always query `invoices` for `order=orderId` and cancel every non-cancelled linked invoice, independent of `order.status`.
- Confidence: likely (state is explicitly anticipated by the code; trigger is a failed status write)

### O-06 [HIGH] Profitability and turnover subtract line discounts twice for sales orders — `src/lib/analytics-v2/discount-allocation.ts:40`
- What the code does:
  ```ts
  const scale =
      tx && tx.discount > 0 && lineNetSum > 0
          ? Math.max(0, (lineNetSum - Math.min(tx.discount, lineNetSum)) / lineNetSum)
          : 1;
  adjusted.set(l, l.netRevenue * scale);
  ```
  The whole header discount is allocated over lines.
- Why wrong: for B2B orders, `sales_orders.discount_total` is **the sum of the line discounts** (`orders.ts:145-163`), and `loadUnifiedLines` has already netted those discounts into `netRevenue = gross - lineDiscount` (`load.ts:321-328`). The allocation subtracts them a second time. Storefront/POS header-only discounts are handled correctly; sales-order discounts are not.
  Concrete: one line ₹1,000 with ₹100 discount, 3% GST. `netRevenue = 900`, `tx.discount = 100`, scale = (900−100)/900 = 0.8889 → profitability revenue **₹800** instead of ₹900; discount erosion becomes (1000−800)/1000 = **20%** instead of 10%. The Sales tab "Gross Margin" card is `profitability.overallMargin` (`src/components/analytics/SalesTab.tsx:53-57,77`), so the headline margin is understated by the discount total of every discounted B2B order; per-category/per-product margins and turnover GMROI inherit the error.
- Evidence: `orders.ts:163` computes `discountTotal` from the same line `discount_amount` values that `load.ts:321` already uses; `createOrder` stores both (`orders.ts:228` and `:187`).
- Minimal fix: allocate only the unaccounted part: `headerDiscount = Math.max(0, tx.discount - Σ lineDiscount)` (fall back to `tx.discount` for POS/storefront when line discounts are 0).
- Confidence: confirmed

### O-07 [HIGH] POS sales recorded under the WhatsApp channel disappear from all analytics — `src/lib/analytics-v2/load.ts:130`
- What the code does:
  ```ts
  ` && (channel!="whatsapp" || channel_order_id = "")` +
  ```
  Any `sales` row with `channel='whatsapp'` and a non-empty `channel_order_id` is excluded as a mirror.
- Why wrong: `createPOSSale` always writes a non-empty `channel_order_id` (the idempotency transaction id) and takes `channel` from the POS channel selector (`src/lib/pos-sales.ts:247-250`; `src/app/pos/page.tsx:1585`). The default channel list includes `whatsapp` (`src/lib/pricing-rules.ts:80-89`), so an in-store/WhatsApp-counter sale tagged "WhatsApp" is a standalone revenue row — but it is removed before every aggregation. Dashboard revenue, sales KPIs, trend, channel table, payment mix, top products, profitability and turnover all read through `loadTxWindow`/`loadUnifiedLines`, so that revenue is invisible everywhere.
- Evidence: the mirror the filter intends to drop is the `chat-sales` row with `status: 'pending'` (`src/lib/chat-sales.ts:402-418`); a POS sale has `status: 'delivered'` (`pos-sales.ts:260`). The comment at `load.ts:121-125` assumes every WhatsApp row with `channel_order_id` is a chat mirror.
- Minimal fix: narrow the exclusion to the mirror (`... && status="pending"`) or give POS rows a distinct marker/prefix (e.g. `channel_order_id` starting `TXN-`).
- Confidence: confirmed

### O-08 [HIGH] Report periods are filtered in UTC while invoice dates are displayed/exported in local time — `src/lib/reports.ts:213`
- What the code does:
  ```ts
  const { start, end } = normalizeDateRange(startDate, endDate);   // utils.ts:118-121
  filter: `... invoice_date>="${start}" && invoice_date<="${end}" ...`
  ...
  date: formatDateSafe(inv.invoice_date, 'dd/MM/yyyy'),            // :221
  ```
  `normalizeDateRange` expands a picked date to UTC day bounds (`${d} 00:00:00.000Z` / `23:59:59.999Z`), while `formatDateSafe` (and the GSTR-1 export at `:668`) interprets the same stored timestamp in the machine's local zone. POS invoices store a full UTC instant (`invoice.ts:1366`); order invoices store the UTC calendar date (`orders.ts:601`).
- Why wrong (IST deployment): a POS invoice stored `2026-04-30T20:00:00.000Z` is **1 May 01:30 local**.
  - The April sales/GST report (end `2026-04-30 23:59:59.999Z`) includes it, but the row prints **01/05/2026**.
  - `generateGSTR1JSON` emits `fp: "042026"` with `idt: "01-05-2026"` (`:668`), i.e. a May-dated invoice inside an April return.
  - The official GSTN builder parses the picked dates as **local** day bounds (`src/lib/gstr1-report.ts:191-192` + `inRange` `:130-133`), so it omits that invoice from April (and puts it in May): the on-screen April report and the April GSTN JSON disagree about the same invoice.
  - Conversely, B2B invoices generated 00:00–05:29 IST get the previous UTC day (`orders.ts:601`), so they are dated and filed in the prior month at month boundaries.
  Sales KPIs elsewhere (analytics `dayKey`, local) count the same sale on 01-May, so the GST report and analytics disagree too.
- Evidence: `normalizeDateRange`/`normalizeDateBounds` (`src/lib/utils.ts:107-122`); `formatDateSafe` (`reports.ts:196-200`); GSTR-1 JSON `idt` (`reports.ts:668`); official builder local bounds (`gstr1-report.ts:190-206`); POS invoice instant (`invoice.ts:1366`); order invoice UTC date (`orders.ts:601`).
- Minimal fix: make report bounds local calendar days (`new Date(y, m, d).toISOString()` .. `new Date(y, m, d + 1).toISOString()`), and write date fields with a local `dayKey()`, not `toISOString().slice(0,10)`.
- Confidence: confirmed (timezone-dependent; this is the production IST case)

### O-09 [MEDIUM] Concurrent confirm/convert can deduct stock twice; concurrent cancel can restore it twice — `src/lib/orders.ts:334`
- What the code does: `confirmSalesOrder` reads the order, checks `status !== 'draft'` in memory, then updates to `confirmed` and calls `deductStockForConfirmedOrder` (:334-355). `convertEstimateToOrder` does the same (:371-394). `applyChannelStock` has no idempotency check — it unconditionally decrements and writes a movement per call (`src/lib/channel-stock.ts:382-390`). `cancelSalesOrder` similarly reads status, restores stock, then writes `cancelled`, and `restoreChannelStockForReference` decides what to restore from a read of existing reversal rows (`channel-stock.ts:529-605`).
- Why wrong: two tabs / two clicks that both read `draft` both write `confirmed` and both deduct N units → stock −2N and two sale movements for one order. Two concurrent cancels both see no reversal rows and both restock → +2N. There is no atomic claim (conditional update, unique marker, or `reference_id` uniqueness).
- Evidence: stock movement uniqueness is not enforced on `reference_id`; tests cover only sequential flows.
- Minimal fix: take an atomic claim before side effects (e.g. create a deterministic per-order marker row and treat a duplicate-id error as "already done", as `settleCodOrder` does at `shipments.ts:275-301`), or make `applyChannelStock` skip when a sale movement already exists for `reference_id`.
- Confidence: likely

### O-10 [MEDIUM] Dashboard gross margin includes the GST and shipping the customer paid — `src/lib/analytics.ts:137`
- What the code does:
  ```ts
  const sumRevenue = (list) => list.reduce((sum, t) => sum + t.revenue, 0);
  const totalRevenue = sumRevenue(txs);
  ...
  const grossMargin = Math.round(totalRevenue - cogs);       // :155
  ```
  `tx.revenue` is the order/sale total, which is tax-inclusive (`orders.ts:165` adds tax; storefront is GST-inclusive; POS treats `sale.total` as collected-inclusive in `invoice.ts:1300-1306`).
- Why wrong: subtracting tax-exclusive COGS from a tax-inclusive revenue overstates gross margin by the GST collected (plus shipping). Example: POS bill ₹10,300 (₹10,000 + 3% GST), COGS ₹7,000 → dashboard margin **₹3,300**; the profitability tab computes ₹3,000. The dashboard `Gross Margin` card displays this figure (`src/components/dashboard/KPICards.tsx:88-89`).
- Evidence: `getProfitabilityAnalytics` computes margin from line `netRevenue` (tax-exclusive) and the same COGS, so the two screens disagree for the same 30-day window by the tax/shipping amount.
- Minimal fix: compute the dashboard margin from `loadUnifiedLines` net revenue (as profitability does), or net tax/shipping out of `tx.revenue` before subtracting COGS.
- Confidence: confirmed

### O-11 [MEDIUM] Monthly trend maps previous months by sparse index, so a zero-sales month shifts the whole previous series — `src/lib/analytics-v2/sales-metrics.ts:96`
- What the code does:
  ```ts
  const prevMonths = [...previousAgg.keys()].sort();
  prevMonths.forEach((m, i) => { if (i < currentKeys.length) aligned.set(currentKeys[i], previousAgg.get(m)!); });
  ```
  `previousAgg` only contains months that had transactions.
- Why wrong: a month with no sales is absent, so every later month is mapped one slot too early. Example: current window Jan–Mar; previous window Oct–Dec with no November sales → `previousAgg = [Oct, Dec]`, aligned as Oct→Jan, **Dec→Feb**, Mar→null. December's previous revenue is drawn against February; the dashed comparison silently lies. The daily branch zero-fills every day, so only the monthly (lengthDays > 60) view is affected.
- Evidence: `buildTrend` keys are derived from `win.previous.days`, but only the sparse `previousAgg` is iterated (`:124-131,144-145`). `test-analytics.ts:365-386` only covers contiguous months with data.
- Minimal fix: build the previous axis from `win.previous.days` (unique `YYYY-MM`), defaulting each to `{revenue:0,orders:0}`, then align by index.
- Confidence: confirmed

### O-12 [MEDIUM] Customer "returning" history uses `created` while current transactions use `order_date` — `src/lib/analytics-v2/sales-metrics.ts:304`
- What the code does:
  ```ts
  const historyFilterOrders =
      `account_email="..." && created<"${pbBound(win.current.startISO)}"` + status whitelist;
  ```
  while `loadTxWindow` dates orders by `o.order_date || o.created` (`load.ts:169-172`).
- Why wrong: `convertEstimateToOrder` resets `order_date` to the confirmation time but leaves `created` at the estimate's creation (`orders.ts:377-381`). An estimate created 30 March, converted 2 April is counted in the April window (order_date) **and** in pre-April history (created < 1 April), so the customer is classified as returning even though this is their first completed purchase. `newCustomers` is understated and `repeatRatePct` inflated. A backdated manual order has the mirror-image problem (counted in history by creation even though its business date is outside).
- Evidence: `buildCustomerSplit` at `:299-311`; conversion path at `orders.ts:369-403`; note `loadTxWindow`'s own window guard uses `order_date`.
- Minimal fix: use the same business-date expression for history: `(order_date<start || (order_date="" && created<start))`.
- Confidence: confirmed

### O-13 [MEDIUM] Challan header stores IGST 0 and line edits drop IGST, so header totals disagree with the lines — `src/app/challan/create/page.tsx:318`
- What the code does:
  ```ts
  igst_amount: 0,        // :318, always
  ```
  while each line is built with a real IGST split (`calculateGST`, :156-175). `updateItem` recomputes only CGST/SGST:
  ```ts
  item.taxable_value = item.quantity * item.unit_price;
  item.cgst_amount = (item.taxable_value * item.cgst_rate) / 100;
  item.sgst_amount = (item.taxable_value * item.sgst_rate) / 100;
  item.total = item.taxable_value + item.cgst_amount + item.sgst_amount;   // :254-257
  ```
  and never touches `igst_amount`.
- Why wrong: for an inter-state challan (`buyerState = selectedConsignee.state_code` ≠ seller state) every line has `igst_rate/igst_amount > 0`, but the header is saved with `igst_amount: 0` while `total_value` sums `item.total` (which includes IGST). Header identity `taxable + cgst + sgst + igst == total_value` fails. After editing a quantity on an inter-state line, the line total loses its IGST while `igst_amount` keeps the stale value, so even the line rows no longer add up. `consignee_state_code` is also written from `manualConsignee.state_code` (`:308`), ignoring the selected customer, and `place_of_supply` is never sent, so the persisted header has no state basis for the split.
- Evidence: `createChallan` persists the caller's header figures verbatim (`challan.ts:250-255`) and writes the line figures separately (`:270-291`); `generateChallanFromOrder` in the same library computes both correctly (`challan.ts:602-630`), proving the intended invariant.
- Minimal fix: `const igstAmount = items.reduce((s,i)=>s+i.igst_amount,0)` and pass it; recompute the full split in `updateItem`; use `selectedConsignee?.state_code` and pass `place_of_supply`.
- Confidence: confirmed

### O-14 [MEDIUM] Every split of the same order is numbered `-BO1`; the second split collides and aborts — `src/lib/orders.ts:1128`
- What the code does:
  ```ts
  let seq = 1;
  const childOrder = await createWithUniqueRetry(
      () => Promise.resolve(`${order.order_number || order.id}-BO${seq++}`),
      async (allocated) => { ... create({ order_number: allocated, ... }) }
  );
  ```
  `createWithUniqueRetry` calls `generatorFn` exactly once and retries the **same** number (`sequence-generator.ts:270-289`).
- Why wrong: the first split creates `SO/2611/00001-BO1`. The parent stays `confirmed` with remaining quantities, so the UI still offers Split. A second split regenerates `SO/2611/00001-BO1`; `sales_orders.order_number` has a unique index (`pocketbase/pb_migrations/1700000000_initial_schema.js:4400`), so all three retries collide and the operation throws ("Failed to create record with allocated document number…"), after logging a bogus "skipped number". Without the unique index it would instead persist two orders with the same document number.
- Evidence: split UI condition `order.items.length > 1 || some(quantity > 1)` (`src/app/orders/detail/page.tsx:235-239`); no other guard prevents repeated splits; the generator's `seq` is local to one invocation.
- Minimal fix: derive the suffix from existing children (e.g. count `order_number LIKE parent-BO%`) before allocating, or let `createWithUniqueRetry` invoke the generator again on a number collision.
- Confidence: confirmed

### O-15 [MEDIUM] Invoice header discount duplicates the already-netted line discount, so the printed invoice does not add up — `src/lib/orders.ts:619`
- What the code does:
  ```ts
  discount: order.discount_total || 0,
  ...
  discount_amount: order.discount_total || 0,
  grand_total: grandTotal,          // computed from post-line-discount taxable + tax + shipping
  ```
  `createInvoice` stores the discount field but recomputes the total from items+shipping, ignoring it (`invoice.ts:541,590-604`).
- Why wrong: for B2B orders `order.discount_total` is the sum of the per-line `discount_amount` values (`orders.ts:163`), and invoice `subtotal` is already the post-discount taxable value (`:593`). The invoice print shows `Subtotal 900 + CGST/SGST 27 − Discount 100` and then `TOTAL 927` (`src/components/invoice/InvoicePrint.tsx:265-300`) — the visible arithmetic is wrong by the discount, although the total itself matches the order. For storefront orders the same field claims a coupon that was never applied (O-01), so the print is inconsistent there too.
- Evidence: `generateInvoiceFromOrder` passes the order-level figure twice; `createInvoice`'s validation (`invoice.ts:544-561`) only compares taxable/tax/grand total, so no mismatch is raised.
- Minimal fix: persist `discount`/`discount_amount` as 0 when line discounts were already netted, or make `subtotal` gross and subtract the discount once in `createInvoice`.
- Confidence: confirmed

### O-16 [MEDIUM] Returns and refunds never reduce revenue in the sales report, dashboard or analytics — `src/lib/analytics-v2/load.ts:26`
- What the code does: the loader documents the gap — "returns / credit notes do NOT net against analytics revenue" — and sums only `sales` + revenue-status `sales_orders`. Returns write a separate `credit_notes` collection (`src/lib/returns.ts:295`) and never update the source order or invoice. `getSalesReport` likewise sums invoices only (`reports.ts:214-231`). No analytics/report module reads `credit_notes`; the only reader is the GSTN builder (`gstr1-report.ts:214`).
- Why wrong: a fully returned ₹10,000 sale still contributes ₹10,000 on the dashboard, the sales report and every analytics tab; refunds are not netted anywhere in the revenue figures. This is the audit's "refund not netted" case.
- Evidence: `git grep credit_notes` shows only `returns.ts`, `gstr1-report.ts` and tests; `cancelSalesOrder` handles cancellation, not returns; returns never touch `sales_orders`/`invoices`.
- Minimal fix: subtract approved/refunded credit-note totals for the window in `loadTxWindow`/`getSalesReport`, or mark the originating invoice/order as partially refunded and net it.
- Confidence: confirmed

### O-17 [MEDIUM] Landed cost includes quantities that were never received on partial purchase orders — `src/lib/reports.ts:403`
- What the code does:
  ```ts
  .filter((item) => item.variant && (item.quantity_received || item.quantity_ordered || 0) > 0)
  .map((item) => ({
      key: item.variant as string,
      quantity: Number(item.quantity_received || item.quantity_ordered || 0),
  ...
  ```
  `||` treats an explicit `quantity_received = 0` (partial PO line) as "use ordered quantity".
- Why wrong: freight/discount on a partial PO is spread by value over un received units, and those units are added to `receiptsByVariant`, so a variant with no receipt in that PO gets a weighted-average landed cost from goods that never entered stock. Example: PO lines A (10 ordered, 10 received, ₹100) and B (10 ordered, 0 received, ₹100), shipping ₹1,000 → overhead splits ₹500/₹500; A's landed cost is ₹150 instead of ₹200, and B's variant is valued at ₹150/unit despite receiving nothing. `getStockReport` then reports the wrong inventory value and `landedCount`.
- Evidence: status filter includes `partial` (`:367`); the same `quantity_received || quantity_ordered` appears twice. `allocateLandedCosts` spreads exactly what it is given.
- Minimal fix: use `Number(item.quantity_received ?? 0)` and skip lines whose received quantity is 0.
- Confidence: confirmed

### O-18 [LOW] Category deep-dive ignores header-level discounts, so category revenue/margin disagree with profitability — `src/lib/analytics-v2/category-metrics.ts:87`
- What the code does: price bands, purity split, making-charge share and monthly mix all read `l.netRevenue` (`:87,107,133,154`) and never call `adjustedLineRevenues`.
- Why wrong: POS bill discounts live on the sale header (`sales.discount`) and storefront coupons on the order header, so those tabs show pre-bill-discount revenue while the profitability/turnover engines allocate the header discount (`discount-allocation.ts`). A ₹10,000 POS bill with a ₹1,000 discount yields ₹10,000 category revenue here and ₹9,000 in profitability; `makingChargeSharePct` and the mix chart are inflated for the same window.
- Evidence: profitability/turnover both call `adjustedLineRevenues` (`profitability.ts:156-159`, `turnover.ts:271,301`); category-metrics does not.
- Minimal fix: load `txs` for the window and multiply `revenue` by the same `adjustedLineRevenues` map before aggregating.
- Confidence: confirmed

### O-19 [LOW] AI reporting buckets by UTC day and its revenue omits manual B2B orders — `src/lib/ai/tools/pb-util.ts:60`
- What the code does:
  ```ts
  export function dayKey(isoLike: string): string { ... return date.toISOString().slice(0, 10); }
  ...
  fromDate: from.toISOString().slice(0, 10), toDate: now.toISOString().slice(0, 10),
  ```
  `get_store_overview` sums only the `sales` collection (`src/lib/ai/tools/erp-read.ts:126-149`) and `get_sales_report` groups by that UTC day (`:484-497`).
- Why wrong: in IST a sale at 01:30 local is bucketed to the previous UTC day (and `revenueToday` compares UTC dates), so "today" and daily groups are wrong between 00:00 and 05:29 local. Separately, B2B orders created by `createOrder` have no `sales` mirror, so the assistant's revenue under-reports versus the dashboard's canonical `sales + sales_orders` rule.
- Evidence: all other analytics use local `dayKey` (`analytics-v2/range.ts:35-40`) and the canonical loader; the AI tools reimplement both with different semantics.
- Minimal fix: reuse the local `dayKey` and the canonical `loadTxWindow`/`loadUnifiedLines` set for revenue answers.
- Confidence: confirmed

### O-20 [LOW] "Top products" can list zero-revenue non-sellers — `src/lib/analytics.ts:290`
- What the code does:
  ```ts
  return Array.from(byProduct.entries())
      .map(([id, data]) => ({ ... totalSold: data.sold, revenue: Math.round(data.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  ```
  Every product that has any line is included; there is no `sold > 0 && revenue > 0` filter.
- Why wrong: `createOrder` accepts `quantity = 0` (its check is `quantity < 0`, `orders.ts:137`) and the create page allows a discount equal to the line gross, so ₹0 / 0-unit lines exist. With fewer than `limit` products sold, the leaderboard shows products with zero or negative revenue ("top" N includes non-sellers).
- Evidence: sales-order and POS lines both enter `loadUnifiedLines` without a revenue filter; `getTopProducts` is rendered on the analytics Sales tab.
- Minimal fix: filter `data.sold > 0 && data.revenue > 0` before sorting.
- Confidence: confirmed

### O-21 [LOW] Sales-report "total items" is hardcoded to 0 — `src/lib/reports.ts:237`
- What the code does:
  ```ts
  const summary: ReportSummary = { totalSales: ..., totalTax: ..., totalOrders: rows.length, totalItems: 0 };
  ```
- Why wrong: the metric is always zero; the monthly-summary quick export writes `Total Items: 0` (`src/app/reports/page.tsx:78-84`). `fetchInvoiceItemsForInvoices` already exists to compute the real count.
- Evidence: no other writer assigns `totalItems`.
- Minimal fix: sum `quantity` over `fetchInvoiceItemsForInvoices(invoiceIds)` in the same function (or remove the metric).
- Confidence: confirmed

### O-22 [MEDIUM] Scanning a variantless product into a challan writes the invalid relation id `"default"` — `src/app/challan/create/page.tsx:200`
- What the code does:
  ```ts
  variants: payload.variant ? [{ id: payload.variant.id, ... }] : [{ id: 'default', price_adjustment: 0 }]
  ```
  and `createChallan` writes `variant: item.variant_id || ''` (`challan.ts:275`).
- Why wrong: PocketBase relation ids are 15-character record ids; `'default'` is not one, so `delivery_challan_items.create` fails validation. `createChallan` then deletes the freshly created header and every line and rethrows (`challan.ts:294-300`), so the whole challan cannot be saved. The order-create page already fixed the identical bug by resolving a real variant before adding the line (`src/app/orders/create/page.tsx:182-190`, comment "ORD-09").
- Evidence: the challan page's own product search explicitly supports products with no variants (`challan/create` :121-127), and the mobile-scanner path passes `payload.variant` only when the barcode resolved to a variant.
- Minimal fix: reuse `resolveVariantForProduct` (as the order page does) or leave the relation empty when no variant exists.
- Confidence: likely

---

## Checked and clean

Files fully read (code is the evidence; no defects beyond the above):

- `src/lib/orders.ts`, `challan.ts`, `shipments.ts`, `logistics-engine.ts`, `sequence-generator.ts`, `concurrency.ts`, `reports.ts`, `analytics.ts`, `ai-client.ts`
- `src/lib/analytics-v2/category-metrics.ts`, `discount-allocation.ts`, `insights.ts`, `profitability.ts`, `range-store.ts`, `range.ts`, `snapshots.ts`, `turnover.ts`, `load.ts`, `sales-metrics.ts`
- `src/lib/ai/agent-loop.ts`, `chat-stream.ts`, `events.ts`, `guardrails.ts`, `harness.ts`, `http.ts`, `net-guard.ts`, `openai-compatible.ts`, `prompt.ts`, `sessions.ts`, `sse.ts`, `providers.ts`, `types.ts`, `tools/erp-read.ts`, `tools/erp-write.ts`, `tools/pb-util.ts`, `tools/registry.ts`
- `src/app/api/ai/chat/route.ts`, `src/app/api/ai/conversations/route.ts`, `src/app/api/ai/conversations/[id]/route.ts`, `src/app/api/ai/status/route.ts`, `src/app/api/ai/providers/route.ts`, `src/app/api/ai/providers/models/route.ts`, `src/app/api/ai/providers/test/route.ts`
- `src/app/orders/page.tsx`, `orders/create/page.tsx`, `orders/detail/page.tsx`
- `src/app/challan/page.tsx`, `challan/create/page.tsx`, `challan/detail/page.tsx`
- `src/app/reports/page.tsx`, `reports/sales/page.tsx`, `reports/gst/page.tsx`, `reports/stock/page.tsx`, `reports/export/page.tsx`
- `src/app/analytics/page.tsx`, `src/app/assistant/page.tsx`
- `src/scripts/test-analytics.ts`, `test-gstr1-period.ts`, `test-capture-invariants.ts` (`test-analytics-v2` does not exist)

Supporting files read fully/partially to prove call traces: `src/lib/pocketbase.ts`, `src/lib/utils.ts`, `src/lib/invoice.ts` (invoice creation/validation and POS invoice path), `src/lib/pos-sales.ts`, `src/lib/channel-stock.ts`, `src/lib/chat-sales.ts`, `src/lib/razorpay-webhook-handler.ts`, `src/lib/api-auth.ts`, `src/lib/gstr1-report.ts`, `src/lib/pricing-rules.ts`, `src/lib/channel-pricing.ts`, `src/app/api/storefront/order/route.ts`, `src/app/pos/page.tsx`, `src/app/api/webhooks/razorpay/route.ts`, `src/hooks/use-ai-chat.ts`, `src/components/orders/OrderMilestoneBar.tsx`, `src/components/analytics/SalesTab.tsx`, `src/components/invoice/InvoicePrint.tsx`, `pocketbase/pb_migrations/1700000000_initial_schema.js` (unique indexes), `pocketbase/pb_migrations/1791804087_updated_sales_orders.js`.

Behaviours already covered by the existing tests (so not re-reported as defects): range window length/previous windows, custom-range normalisation and day-key inclusion, `deltaPct` zero-previous sentinel, daily/monthly trend summation and previous overlay for contiguous months, channel/payment/heatmap aggregation, distinct-customer split pure function, insights rule ranking/zero-mock, `pbBound` PB space-datetime conversion, GSTR-1 financial-period helpers (`MMYYYY`, 1-April FY start), storefront capture invariants (header+items sum, duplicate submit, settle-once aggregates, no stock for an unpaid online draft), plus the stated clean `tsc`/eslint/30-suite baseline.

Test gaps observed: no coverage of `discount-allocation`/profitability revenue, category metrics, report period boundaries (UTC vs local), shipment/dispatch and cancellation state machines, challan header-vs-line totals, or backorder numbering; `test-analytics.ts` uses contiguous months only, so the sparse-month alignment bug is untested.
