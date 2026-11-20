# Wave 1 — Money In/Out (purchase, vendors, manufacturing cost, banking, cheques, gateways, reconciliation, expenses)

Date: 2026-11-17
Scope: `src/lib/{purchase,vendors,manufacturing-engine,manufacturing-jobs,cheque-engine,cheque-register,banking,payment-reconciliation,razorpay,razorpay-orders,razorpay-webhook-handler,phonepe,payment-links,webhook-dedupe,expenses,logistics-engine,shipments,eway-bill,eway-bill-settings,gstr1-report}.ts`, the pages under `src/app/{purchase,vendors,manufacturing,cheques,banking,expenses}/**`, and the API routes that settle these flows.
Method: complete file reads, caller traces with `findstr`, state and unit traces. Baseline assumed clean (tsc, eslint, 30 logic suites); findings below are outside that coverage.

Severity counts: **1 CRITICAL, 3 HIGH, 7 MEDIUM, 2 LOW**.

---

### P-01 [CRITICAL] Payment-link reconciler settles a sales order for less than its total — `src/lib/payment-reconciliation.ts:283`
- What the code does: the reconciler treats any `paid` gateway link as fully settling the linked ERP order:
  ```ts
  if (remote.status === 'paid' || remote.amount_paid >= remote.amount) {
      ...
      ({ orderNumber, pointsCredited } = await settleLinkedOrder(link, paymentRef));
  ```
  and `settleLinkedOrder` calls the canonical settlement with no amount argument:
  ```ts
  const settled = await settleCapturedOrder(link.order, {
      paymentId: paymentRef || link.link_id,
      tenantEmail: accountScopeEmail() || undefined,
  });
  ```
  (`src/lib/payment-reconciliation.ts:172-175`). `settleCapturedOrder` writes `payment_status: 'PAID', status: 'confirmed'`, deducts stock, raises the invoice and credits loyalty/CRM (`src/lib/razorpay-webhook-handler.ts:171-177`, `326-349`).
- Why it is wrong: expected — an order may only be marked PAID when the captured amount covers (or exceeds) the order total, exactly as the webhook enforces with `amountMatchesRupees(expectedRupees, capturedPaise)` (`src/lib/razorpay-webhook-handler.ts:501-512`). Actual — the reconciler never compares `remote.amount_paid`/`link.amount` with `sales_orders.total`. Concrete: a ₹50,000 chat order (modal `defaultAmount = sale.total`, `src/app/whatsapp/page.tsx:1953-1955`) gets a ₹5,000 advance link (`RazorpayPaymentModal` lets the operator edit `amount`, line 249). The customer pays ₹5,000. The reconciler polls the link, sees `paid`, and settles the ₹50,000 order: PAID, stock deducted, invoice raised, loyalty awarded. The remaining ₹45,000 is never collected and the order is closed as paid.
- Evidence: caller trace `startPaymentReconciler` (`src/app/whatsapp/page.tsx:1136`) → `reconcilePendingPaymentLinks` → `settleLinkedOrder` → `settleCapturedOrder`. The ERP `payment_links` row is written with `order = defaultOrderId` and `amount = finalChargeAmount` (`src/components/whatsapp/RazorpayPaymentModal.tsx:130-176`), i.e. it can be any amount > 0. Test gap: `test-phase2-phase3.ts` only asserts that the reconciler “executes cleanly” (line 255), with no amount scenario, and `test-webhook-dedupe.ts` covers the webhook’s rupee/paise check but not this path.
- Minimal fix: in `settleLinkedOrder`, load `link.order`’s `total` and return/throw (leave the link `created`) unless `link.amount >= total - 0.005` (or pass the expected amount into `settleCapturedOrder` and enforce it there).
- Confidence: confirmed

---

### P-02 [HIGH] Online gateway settlement leaves the generated tax invoice unpaid, so the receivable is double-counted — `src/lib/razorpay-webhook-handler.ts:251`
- What the code does: every settlement raises the invoice and never settles it:
  ```ts
  const invoiceResult = await generateInvoiceFromOrder(orderId, db);
  if (!invoiceResult?.success) {
      console.warn(`[settlement] Invoice generation did not succeed for ${orderId}`);
  }
  ```
  `generateInvoiceFromOrder` always creates the invoice unpaid:
  ```ts
  status: 'pending',
  ...
  is_paid: false,
  paid_amount: 0,
  ```
  (`src/lib/orders.ts:605, 632-633`). Only the payment-link reconciler later records an `invoice_payments` row and sets `paid_amount/status` (`src/lib/payment-reconciliation.ts:196-231`). `markInvoicePaid` exists but has no production caller (`src/lib/invoice.ts:1207`).
- Why it is wrong: expected — a captured payment that pays an order also settles the order’s invoice (the app does exactly this for payment links). Actual — the Razorpay-Checkout storefront path (`src/app/api/storefront/order/route.ts:276-280`) and the flash-drop path (`src/app/api/storefront/flash-drop/route.ts:1006-1010`) call `settleCapturedOrder` and then return; the order is PAID while its invoice remains `pending` with `paid_amount = 0`. Concrete: a ₹20,000 storefront order paid by card. The order shows PAID, stock is deducted, the GST invoice is filed for the period, but the invoice list/detail and `erp-read.ts`’s `outstandingReceivable` treat the ₹20,000 as still due. The invoice detail then offers “Record Payment” for the full ₹20,000 (`src/app/invoices/detail/page.tsx:194-221`): to clear the receivable the operator records the already-captured money as a fresh receipt, while the gateway capture itself has no `invoice_payments` row and no bank-ledger entry — so the records cannot distinguish a settled invoice from a genuine second payment, and the bank/Razorpay flow is never reconciled against it.
- Evidence: settlement function read in full; only `recordPayment` (invoice detail UI) and the payment-link reconciler write `invoice_payments`/`paid_amount` (`findstr invoice_payments`). No storefront route touches `invoices` (grep returns only a comment). Test gap: `test-capture-invariants.ts` checks the order/customer side of settlement but not the invoice ledger.
- Minimal fix: after `generateInvoiceFromOrder` in `settleCapturedOrderInner`, record an `invoice_payments` row for the order total (gateway reference) and set `paid_amount/status/is_paid`, or reuse the reconciler’s invoice-settlement helper.
- Confidence: confirmed

---

### P-03 [HIGH] GSTR-1 omits credit/debit notes raised through the Invoices module — `src/lib/gstr1-report.ts:196`
- What the code does: the payload builder loads only regular invoices from `invoices` and notes only from the separate `credit_notes` collection:
  ```ts
  const allRegular = await pb.collection('invoices').getFullList<InvoiceRow>({
      filter: `${tenantFilter()} && invoice_type="regular"`,
      sort: 'invoice_date',
  });
  ...
  const allNotes = await pb.collection('credit_notes').getFullList<CreditNoteRow>({
      filter: tenantFilter(),
  ```
  (`src/lib/gstr1-report.ts:196-199`, `214-217`).
- Why it is wrong: Invoices → New offers Credit Note and Debit Note (`src/app/invoices/create/page.tsx:620-627`), and `createInvoice` persists that type on the invoice row (`invoice.ts:599`); no `credit_notes` row is created there. The GSTN engine explicitly supports note types inside the invoice feed (`gstr1-engine.ts:293-296`: `invoice_type === 'credit_note' || 'debit_note'`), but the builder filters them out before the engine sees them. Expected — a debit note increases output tax and a credit note reduces it in the return for the month of issue. Actual — both vanish from `b2b`/`cdnr`/`b2cs` and from Table 13. Concrete: a ₹1,18,000 (₹1,00,000 + 18% GST) debit note raised on 10 Nov is never filed; the Oct/Nov GSTR-1 understates output tax by ₹18,000. A credit note filed this way likewise overstates tax and understates the customer’s credit.
- Evidence: trace `invoices/create` → `createInvoice` (no `credit_notes` write) → `buildGstr1OfficialPayload` (no query of note-typed invoices). `test-gstr1-period.ts` only covers `toFinancialPeriod`/`financialYearStart`; `test-gstr1-engine.ts` feeds note types directly to the engine, so the builder’s filter is untested.
- Minimal fix: query `invoices` for `invoice_type="regular" || invoice_type="credit_note" || invoice_type="debit_note"` (tenant-scoped, date-filtered), map note rows into `sourceInvoices` with their type, and keep the `credit_notes` collection feed as well (dedupe by id).
- Confidence: confirmed

---

### P-04 [HIGH] The `payment.captured` webhook can never match gateway-checkout payments — captured money is silently dropped — `src/lib/razorpay-webhook-handler.ts:430`
- What the code does: for a `payment.captured` event the only order reference it accepts is on the payment:
  ```ts
  const orderId =
      paymentLink?.notes?.order_id || paymentLink?.reference_id || payment?.notes?.order_id;
  ```
  If that is empty the handler falls through to `return { success: true, event };` (`:535`) without settling, matching or logging an unmatched payment.
- Why it is wrong: the storefront’s Razorpay-Checkout flow puts the ERP order id on the **Razorpay Order**, not on the payment (`createGatewayOrder` `notes: { order_id: salesOrder.id, account_email, source }`, `src/lib/razorpay-orders.ts:74-79`; call site `src/app/api/storefront/order/route.ts:1019-1027`), and the checkout options never pass a `notes` object (`storefront/src/lib/razorpay.ts:59-85`). Razorpay payment notes are the fields read here; they are not populated by the app. Expected — if the buyer closes the tab after paying, the signed webhook settles the order. Actual — the event is acknowledged with HTTP 200 and dropped; the order stays `PENDING`/`draft`, no stock is deducted and no invoice is raised. Concrete: a ₹30,000 storefront card payment whose browser never calls the confirm endpoint is captured in Razorpay but invisible to the ERP, and Razorpay will not retry a 200.
- Evidence: `razorpay-webhook-handler.ts:430-435, 535`; the only note writers for gateway orders are `createGatewayOrder` (order notes) and the checkout (no notes). The storefront confirm path (`src/app/api/storefront/order/route.ts:254-280`) is the only working matcher, and it requires the browser. Confidence depends on Razorpay not copying Order notes onto the Payment entity (the API docs’ `payment.captured` sample shows `"notes": []`); that is the only runtime check left.
- Minimal fix: also read `payload.order.entity.notes.order_id` (type it in the payload interface) and match `payment.order_id` to `sales_orders.gateway_order_id` when payment notes are empty; log and return a non-2xx for a captured payment that matches nothing.
- Confidence: likely

---

### P-05 [MEDIUM] The webhook rejects the app’s own marked-up payment links — `src/lib/razorpay-webhook-handler.ts:501`
- What the code does: for `payment_link.paid` the expected amount is the **order total**, compared exactly:
  ```ts
  const expectedRupees = Number(existingOrder.total ?? existingOrder.subtotal ?? 0);
  if (!amountMatchesRupees(expectedRupees, capturedPaise)) {
      ... return { success: false, ... error: 'Captured amount does not match the order total' };
  }
  ```
  But the ERP’s link creator defaults to adding a 2.2% gateway markup:
  ```ts
  const [includeMarkup, setIncludeMarkup] = useState<boolean>(true);
  ...
  const finalChargeAmount = isDiscountApplied
      ? upiDiscountInfo.finalCustomerCharge
      : (includeMarkup ? markupInfo.grossAmount : amount);
  ```
  (`src/components/whatsapp/RazorpayPaymentModal.tsx:38, 82-84`), with `grossAmount = ceil(amount / (1 - 0.022))` (`src/lib/razorpay.ts:79-89`).
- Why it is wrong: expected — a link the ERP itself created and delivered should be accepted when the customer pays its full amount. Actual — for any order ≥ ₹2,000 (below that the UPI discount charges the net amount) the link collects the gross amount while `sales_orders.total` is the net amount, so the strict equality fails and the webhook returns 409. Concrete: order total ₹10,000 → modal default link ₹10,225 → customer pays ₹10,225 → `expectedPaise 1,000,000` vs `capturedPaise 1,022,500` → rejected. The order only settles while the WhatsApp hub page is open and its 90-second reconciler happens to run; close the app and the order stays unpaid even though the customer paid.
- Evidence: the webhook error is surfaced by the route (`src/app/api/webhooks/razorpay/route.ts:8-9` maps “amount does not match” to 409); `RazorpayPaymentModal` always resets `includeMarkup` to true on open (line 90). Test gap: `test-webhook-dedupe.ts` tests `amountMatchesRupees` in isolation, never against a marked-up link.
- Minimal fix: compare `capturedPaise` with the ERP `payment_links.amount` (the amount actually requested) for `payment_link.paid`, or accept `capturedPaise >= expectedPaise` when the difference is the documented markup.
- Confidence: confirmed

---

### P-06 [MEDIUM] Karigar job accepts finished + scrap metal greater than issued metal, silently costs the piece at 0% loss — `src/lib/manufacturing-engine.ts:194`
- What the code does: the metal reconciliation clamps the loss, so an over-issue can never be negative:
  ```ts
  const unrecoveredMeltingLossGrams = roundGrams(Math.max(0, totalInputMetalGrams - accountForMetal));
  ...
  const isWithinTolerance = unrecoveredMeltingLossGrams <= allowedLossGrams;
  ```
  The only production consumer (`computeKarigarJobCost`, `manufacturing-jobs.ts:127-146`) never calls `validateManufacturingOrder` — the function that would catch the conservation violation (`manufacturing-engine.ts:292-305`) is used only by its test. `saveKarigarJob` validates only name, piece and `metalGrams > 0` (`manufacturing-jobs.ts:228-233`).
- Why it is wrong: expected — issuing 10.000 g and recording 12.000 g finished must be rejected or flagged; `perGramCost` must not be divided by an impossible weight. Actual — input 10 g, finished 12 g, scrap 0 → `unrecoveredMeltingLossGrams = max(0, -2) = 0`, `meltingLossPercent = 0`, `isWithinTolerance = true`, and the UI shows the green “Within tolerance” badge; `perGramCost = netCost / 12`, understating the per-gram cost by 16.7%. The amber “Negative loss — check finished + scrap vs issued weights” branch (`src/app/manufacturing/page.tsx:307-310`) is unreachable because both values are clamped non-negative.
- Evidence: read `computeKarigarJobCost`, `reconcileMetalBalance` and the page in full. `test-manufacturing.ts` covers zero finished weight but not `finished + scrap > issued`; `test-manufacturing-engine.ts`’s conservation test exercises `validateManufacturingOrder`, which the karigar flow never calls.
- Minimal fix: call `validateManufacturingOrder`-equivalent checks in `saveKarigarJob` (finishedNetGrams + scrapGrams ≤ metalGrams, per line) or return a separate `overIssuedGrams` from `reconcileMetalBalance` and block/flags the job.
- Confidence: confirmed

---

### P-07 [MEDIUM] Blanket-PO GST + shipping overhead is re-applied in full on every Excel inward batch, inflating product cost N× — `src/lib/excel-import.ts:752`
- What the code does: each import computes the whole PO’s overhead and spreads it over only the rows in that import:
  ```ts
  if (poData && poData.meta?.absorb_overhead) {
      const totalOverhead = Number(poData.meta.gst_paid_overhead || 0) + Number(poData.meta.shipping_overhead || 0);
      if (totalOverhead > 0) {
          const landed = calculateLandedUnitCosts(rows, totalOverhead);
  ```
  (`src/lib/excel-import.ts:752-762`), and the landed value becomes the product’s `cost_price` (line 804). `calculateLandedUnitCosts` is a per-call distribution (`src/lib/purchase.ts:1440-1469`); there is no record of overhead already absorbed.
- Why it is wrong: expected — the PO’s ₹20,000 overhead (GST ₹18,000 + shipping ₹2,000) is absorbed once across all goods received under that PO. Actual — a blanket PO received in two Excel files absorbs it twice: batch 1 (goods value ₹60,000) inflates its rows by 1 + 20,000/60,000; batch 2 (₹40,000) inflates its rows by 1 + 20,000/40,000; ₹40,000 of overhead is capitalised instead of ₹20,000. Inventory valuation and every margin/COGS report built on `products.cost_price` are then wrong. Single-item scan intakes apply no overhead at all, so the split is also uneven.
- Evidence: read the import block around the landed-cost map and `calculateLandedUnitCosts` in full; `absorb_overhead` is written into PO metadata at creation (`purchase.ts:375-377`) and never consumed per batch. No test covers a second import under the same PO.
- Minimal fix: either require the whole PO to be imported in one call when `absorb_overhead` is set, or store the absorbed-overhead total per PO (a column/metadata counter) and only apply the remaining amount on each import.
- Confidence: confirmed

---

### P-08 [MEDIUM] An issued cheque cannot be marked cleared when the ledger balance is below the cheque amount — `src/lib/cheque-register.ts:201`
- What the code does: the cheque transition commits first, then posts the bank ledger movement:
  ```ts
  const { bankBalanceDelta, bankAccountId, description } = result.ledgerEffect;
  if (bankBalanceDelta !== 0 && bankAccountId) {
      ...
      await createBankTransaction({
          ...
          type: bankBalanceDelta > 0 ? 'deposit' : 'withdrawal',
          amount: Math.abs(bankBalanceDelta),
  ```
  and `createBankTransaction` refuses any withdrawal above the recorded balance:
  ```ts
  if (transaction.type === 'withdrawal' || transaction.type === 'transfer') {
      if ((account.current_balance || 0) < amount) {
          throw new Error(`Insufficient funds: ...`);
  ```
  (`src/lib/banking.ts:221-226`). The catch rolls the register back to `deposited` (`cheque-register.ts:214-226`).
- Why it is wrong: expected — a cheque the bank has honoured must be recordable even if the app’s opening/deposit history is incomplete (the bank, not the app, decided the funds existed). Actual — clearing an issued cheque for ₹2,50,000 on an account whose recorded balance is ₹50,000 throws “Insufficient funds”, the register reverts, and the cheque is stuck in `deposited` while the bank has already debited the money. The operator must first invent a deposit to raise the balance, which corrupts the ledger, or leave the bank ledger missing a real debit. The same guard can block `cleared → open` reversals for a received cheque whose funds were spent.
- Evidence: read the full state machine, `advanceCheque` and `createBankTransaction`. `test-cheque-engine.ts` covers the transitions and deltas but only with an account that has funds; `test-cheque-register.ts` never posts a ledger.
- Minimal fix: post cheque/bank-confirmed movements with an explicit `allowOverdraft` flag (or bypass the pre-check for `related_entity_type === 'cheque'`), while keeping the atomic negative-balance warning.
- Confidence: confirmed

---

### P-09 [MEDIUM] COD settlement reports success on a duplicate claim without verifying the order reached PAID — `src/lib/shipments.ts:349`
- What the code does: the claim row is created first, then the order is updated, then the claim is marked paid. If the claim id already exists, the function returns success immediately:
  ```ts
  } catch (claimErr) {
      if (isDuplicateRecordError(claimErr)) {
          console.warn('[shipments] COD settlement already claimed for this order:', orderId);
          return { success: true };
      }
      throw claimErr;
  }
  ```
  (`src/lib/shipments.ts:348-355`). The order update and its compensating claim delete are at `:357-379`.
- Why it is wrong: expected — “already claimed” may only return success when the order is actually `payment_status = 'PAID'` (or the caller is told to retry). Actual — the deterministic claim id (`codClaimRecordId`, `:275-287`) survives a crash between the claim create (`:336-347`) and the order update (`:358-369`). Every later retry sees the duplicate, returns `{success:true}`, and the UI toasts “COD settled — order marked PAID and delivered” (`src/app/orders/detail/page.tsx:221-227`) while the order remains UNPAID and the claim row stays `pending`. The concurrent variant is also wrong: the loser returns success while the winner can still fail and delete the claim, leaving no settlement at all.
- Evidence: read `settleCodOrder` in full; nothing else scans `payment_links` with `provider='cod'` (grep finds only the writer), so the stale `pending` row is never reconciled. `test-roadmap-capture.ts` covers the happy path and a sequential repeat after the order is already PAID, not the crash/race window.
- Minimal fix: on a duplicate claim, re-read the order and return success only if `payment_status === 'PAID'`; otherwise surface an error/manual-review state (or delete/reuse the stale claim when its status is still `pending`).
- Confidence: likely

---

### P-10 [MEDIUM] Expense Save has no in-flight guard: a double-click records the expense twice — `src/app/expenses/page.tsx:115`
- What the code does: the handler is async but sets no submitting state and the button stays enabled:
  ```ts
  const handleCreate = async () => {
      if (!newExpense.amount || !newExpense.category_id || !newExpense.date) { ... return; }
      const result = await createExpense({ ...newExpense, amount: parseFloat(newExpense.amount), ... });
      if (result) { ... }
  };
  ```
  and the footer is `<Button onClick={handleCreate}>Save Expense</Button>` with no `disabled` (`src/app/expenses/page.tsx:294-297`). `createExpense` allocates a new sequential number per call (`src/lib/expenses.ts:243-261`), so nothing dedupes the two rows.
- Why it is wrong: expected — one click (or a double-click during the network round-trip) records one expense. Actual — the page does not re-render between the click and the first `await`, so a second click invokes `handleCreate` again and creates a second `EXP-xxxxx` row with the same amount/date/category. Both are counted by `getExpenseStats` (`expenses.ts:535-544`) and included in the dashboard/profit reports. Concrete: a ₹12,000 packaging expense double-clicked becomes ₹24,000 in the period and in the profitability margin.
- Evidence: read the page handler and modal in full; contrast with the other money forms in this cluster (cheque `saving`, bank `submitting`, GRN `processing`, POS `isProcessingRef`), all of which disable the button. No test exercises the UI path.
- Minimal fix: add a `saving` state set before the first `await` and pass `disabled={saving}` (plus an early `if (saving) return`).
- Confidence: confirmed

---

### P-11 [MEDIUM] Auto-generated invoice date is the UTC calendar date, so night-time invoices are back-dated (wrong GSTR-1 period/FY) — `src/lib/orders.ts:601`
- What the code does:
  ```ts
  const invoice = await createInvoice({
      invoice_date: new Date().toISOString().split('T')[0],
  ```
  (`src/lib/orders.ts:601`). `toISOString()` is always UTC, and `gstr1-report.ts` files invoices by this date (`buildGstr1OfficialPayload` loads/sorts by `invoice_date` and filters `inRange(invoice.invoice_date, start, end)`, `:196-206`).
- Why it is wrong: expected — an invoice raised at 02:00 IST on 1 May is dated 1 May and filed in `052027`. Actual — at 02:00 IST the UTC date is 30 April, so `invoice_date` is `2026-04-30` and the invoice is filed in the previous GSTR-1 month; at 02:00 IST on 1 April it is dated 31 March and lands in the previous financial year (affecting the FY turnover fields as well). The window is 00:00–05:29 IST every day, i.e. all late-night online/POS-adjacent order invoicing.
- Evidence: read `generateInvoiceFromOrder` and the GSTR-1 period builder in full. The frontend already fixed the same class for the expense range with a local-date helper and an explicit FIN-22 comment (`src/app/expenses/page.tsx:51-59`), but this path still uses `toISOString()`. No test covers invoice dates.
- Minimal fix: format the business-local date (`getFullYear/getMonth/getDate` on the store timezone, or `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })`).
- Confidence: confirmed

---

### P-12 [LOW] Expense form pre-fills the UTC date, which can put the expense in the previous month/FY — `src/app/expenses/page.tsx:76`
- What the code does: the create dialog’s initial and reset dates are:
  ```ts
  date: new Date().toISOString().split('T')[0],
  ```
  at `src/app/expenses/page.tsx:76` and `:132` (the same pattern is in the bank ledger form at `src/app/banking/transactions/page.tsx:62, 126`).
- Why it is wrong: expected — the date field defaults to today in the operator’s timezone, so a 01:00 IST expense is dated today. Actual — the field shows yesterday (UTC), and on 1 April at 01:00 it shows 31 March: accepting the prefilled value files the expense in the previous FY, changing the period’s expense total and the analytics margin. The user can correct it manually, which is why this is low rather than medium.
- Evidence: the page’s own range default uses a local-date helper with the FIN-22 comment (`:51-59`), but the create/reset default still uses `toISOString()`; no test covers it.
- Minimal fix: reuse the existing `localDate(new Date())` helper for both the initial state and the reset.
- Confidence: confirmed

---

### P-13 [LOW] Clearing-deposit row and bank balance are not atomic; a crash permanently loses the clearing credit — `src/lib/payment-reconciliation.ts:123`
- What the code does: `recordClearingDeposit` inserts the bank transaction, dedupes rows, then increments the account:
  ```ts
  if (await hasClearingEntry(link.id)) return; // already ledgered (crash-retry)
  ...
  const created = await pb.collection('bank_transactions').create({ ... related_entity_type: 'payment_link', related_entity_id: link.id });
  ...
  await pb.collection('bank_accounts').update(accountId, { 'current_balance+': link.amount });
  ```
  (`src/lib/payment-reconciliation.ts:123-158`).
- Why it is wrong: expected — the ledger row and the balance are one effect; a retry repairs either half. Actual — if the process dies after the row insert but before the increment (or after a second reconciler deletes the loser’s row), `hasClearingEntry` short-circuits on the next pass: the row survives, the Razorpay clearing account’s `current_balance` never receives `link.amount`, and the link is then marked paid. The bank page under-reports the clearing account balance permanently; no reconciliation pass looks for rows without a matching balance movement.
- Evidence: state trace of the create → dedupe → increment sequence; there is no balance-vs-ledger check anywhere in `banking.ts` or the reconciler. A crash window, so `needs-runtime-check`.
- Minimal fix: wrap the increment in a retry/repair pass (or record a `balance_applied` flag on the row and have the reconciler apply the balance for rows without it).
- Confidence: needs-runtime-check

---

## Checked and clean

Fully read and found no defect of the audited classes:

- `src/lib/vendors.ts` and `src/app/vendors/page.tsx`, `src/app/vendors/detail/page.tsx` — tenant ownership checks on every mutator, PO existence guard on delete, vendor↔variant mapping; no money movement.
- `src/lib/banking.ts` — tenant/ownership checks, balance writes only through `createBankTransaction`, atomic `current_balance+/-`, overdraft re-check after the atomic decrement, transfer destination rollback, `updateBankAccount` refuses balance edits. (The overdraft rule’s interaction with cheque clearing is P-08.)
- `src/lib/cheque-engine.ts` — state machine, ledger deltas, bounce penalty idempotency (`fromStatus === 'bounced'` cannot re-apply), reopen reversal, portfolio aggregation; covered by `test-cheque-engine.ts` (state machine, deposit/clear/reopen deltas, bounce description) and `test-cheque-register.ts` (validation, maturity, deposit requirement).
- `src/lib/phonepe.ts` — checksums and endpoint strings match the PhonePe spec, amount stays integer paise, `toPaise` uses the decimal-shift conversion, secrets are redacted/masked, merchant transaction ids are not reused. No webhook exists to replay.
- `src/lib/payment-links.ts` — refuses to write an unscoped `payment_links` row.
- `src/lib/webhook-dedupe.ts` — fail-closed tenant resolution, 404-vs-transport distinction, event key includes the subject payment, rupee↔paise comparison is correct; covered by `test-webhook-dedupe.ts` (key shape, duplicate detection, eviction, amount match incl. non-finite).
- `src/lib/razorpay.ts` — HMAC-SHA256 signature verification with `timingSafeEqual`, fail-closed when the secret is missing, note ordering forces `order_id` after client notes, `toPaise` boundary conversion, fee markup arithmetic; `verifyGatewaySignature` binds `<order>|<payment>` and is covered by `test-gateway-signature.ts`.
- `src/lib/razorpay-orders.ts` — order-bound signature verification and `toPaise` amount conversion; no defect found in the module itself (the gateway-order note placement is P-04).
- `src/lib/logistics-engine.ts` — weight/COD arithmetic is unit-correct (grams/kg, ₹/paise), COD fee floor is applied; the shipment builders are only used by tests/tracking, not the production dispatch path.
- `src/lib/eway-bill.ts`, `src/lib/eway-bill-settings.ts` — GSTIN/state/PIN checks, amount fields are passed in rupees as NIC expects; note that NIC authentication currently refuses to run because the RSA public key is not configured (`encryptWithPublicKey` throws), so generation cannot transmit credentials. This is a declared unimplemented integration, not a money defect.
- `src/lib/gstr1-report.ts` — period/FY helpers and turnover windows are correct (covered by `test-gstr1-period.ts`); the debit/credit-note omission is P-03.
- `src/lib/expenses.ts` — amount validation, period bounds via `normalizeDateBounds`/`pbBound`, category seeding, ownership checks; the duplicate-submit and default-date defects are in the page (P-10, P-12).
- `src/lib/manufacturing-engine.ts`, `src/lib/manufacturing-jobs.ts` — divide-by-zero guarded (`totalFinishedUnits > 0`, `finishedNetGrams > 0`, `totalInputMetalGrams > 0`); `test-manufacturing.ts` covers zero finished weight and per-gram cost, `test-manufacturing-engine.ts` covers costs, loss tolerance and metal conservation (for the unreachable assembly API). The over-issue gap in the reachable jobs flow is P-06.
- `src/lib/purchase.ts` — GST-inclusive item totals are not double-added to the PO total, over-receipt reservation rolls back and caps, GRN stock/movement/PO-item writes are rolled back on failure, landed-cost division is zero-guarded, PO inward cost is an atomic `inward_cost+`, tenant ownership is asserted before PO mutations; the overhead-per-batch issue is in the import caller (P-07).
- `src/app/purchase/page.tsx`, `src/app/purchase/create/page.tsx`, `src/app/purchase/detail/page.tsx` — totals/discount clamping, receipt quantity capped at pending, unlinked-SKU warning, ownership/status gating.
- `src/app/manufacturing/page.tsx`, `src/app/cheques/page.tsx` — duplicate-submit safe (saving/queued engine state machine); the dead negative-loss badge is part of P-06.
- `src/app/banking/page.tsx`, `src/app/banking/transactions/page.tsx`, `src/app/expenses/categories/page.tsx` — positive-amount/IFSC validation and disabled-during-submit; the UTC default date in the transaction form is noted in P-12.
- `src/app/api/webhooks/razorpay/route.ts` — raw-body signature header handling and non-2xx mapping; `src/app/api/pos/payment/route.ts` — operator capability checks, forced `notes.account_email`, positive amount, tenant echo check for status; `src/app/api/settings/eway/route.ts` — encrypted secret storage and capability gates.
- `src/app/api/storefront/order/route.ts` (confirm/settlement section) and `src/app/api/storefront/flash-drop/route.ts` (settlement section) — capture status, gateway order binding, amount-in-rupees vs paise, replay guard and signature/gateway verification are all present; their missing invoice settlement is P-02.

Tests read for coverage: `test-webhook-dedupe.ts`, `test-gateway-signature.ts`, `test-cheque-engine.ts`, `test-cheque-register.ts`, `test-manufacturing-engine.ts`, `test-manufacturing.ts`, `test-gstr1-period.ts`, plus the settlement portion of `test-capture-invariants.ts`.

Files inspected but not part of a finding beyond the evidence above: `src/lib/orders.ts` (invoice generation/date at `:600-636`), `src/lib/invoice.ts` (invoice persistence/payment recording), `src/lib/excel-import.ts` (PO landed-cost batch handling), `storefront/src/lib/razorpay.ts` (checkout options), `src/components/whatsapp/RazorpayPaymentModal.tsx` (link amount/markup), `src/app/orders/detail/page.tsx` (COD settlement UI), `src/app/invoices/create/page.tsx` and `src/app/invoices/detail/page.tsx` (note types/payment recording).
