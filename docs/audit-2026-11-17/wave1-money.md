# Wave 1 — Money correctness audit (pricing, tax, discounts, line math, POS/invoice writes)

Date: 2026-11-17. Scope: the files listed for this cluster. Method: every listed file read in full, callers traced with `findstr`, claims proved from code and, where possible, from the live database at `pocketbase/pb_data/data.db` and from executed calls into the real modules. Baseline accepted: `tsc` clean, `eslint` clean, 30 logic suites passing — nothing below is something those would have caught. Existing repo-root/docs audit reports were ignored.

---

### M-01 [CRITICAL] Every new POS/manual invoice is billed at 0% GST: `products.gst_rate` is 0 and 0 is treated as an explicit rate — `src/lib/invoice-math.ts:241`

- **What the code does:**
  - `src/lib/invoice-math.ts:240-243` — `if (typeof explicitRate === 'number' && explicitRate >= 0) return explicitRate; if (typeof productRate === 'number' && productRate >= 0) return productRate;`
  - `src/app/invoices/create/page.tsx:239-241` — `const effectiveGstRate = isGstRegistered ? (productFields.gst_rate ?? GST_RATES.JEWELRY) : 0;`
  - `src/lib/invoice.ts:1291-1296` — the POS→invoice path calls `resolveLineGstRate(item.gst_rate, product?.gst_rate, isGstRegistered, GST_RATES.JEWELRY)`.
  - `src/app/inventory/page.tsx:733-753` — the product create/update payload contains `hsn_code` but **no `gst_rate`**; no other product writer in `src/` sets it (`src/lib/purchase.ts:1132-1141`, `src/lib/excel-import.ts`, `src/lib/whatsapp-crm.ts`, `src/lib/chat-inventory.ts` all omit it).
  - `pocketbase/pb_migrations/1792774203_products_craft_and_gst_rate.js:16` — `products.fields.add(new NumberField({ name: "gst_rate", min: 0, max: 28 }));` (no default, but PocketBase stores numbers as `NOT NULL DEFAULT 0`).
  - `src/lib/pos-sales.ts:291-292` — the POS tries to carry the per-line rate: `gst_rate: item.gst_rate ?? null`. `sale_items` has **no `gst_rate` column** (verified with `pragma table_info(sale_items)`), and PocketBase silently drops unknown fields (verified against a throw-away PocketBase: a create with `{"name":"x","bogus":"y","gst_rate":0}` returned `{"name":"x"}` and no error). So the line rate is lost.

- **Why it is wrong:** The live DB has `"gst_rate" NUMERIC DEFAULT 0 NOT NULL`, 13 products, and **all 13 rows have `gst_rate = 0`**. Because the resolver accepts `0` as an explicit rate, a 0% rate is used where the code intends the 3% jewelry default:
  - Manual invoice: product picked in `addItemFromProduct` gets `gst_rate: 0`; `calculateInvoiceTotals` uses `item.gst_rate ?? GST_RATES.JEWELRY` (= 0), so the invoice persists `taxable_value = gross`, `total_tax = 0`.
  - POS sale: `sale_items.gst_rate` cannot be stored, and the expanded product's `gst_rate` is 0, so `splitInclusiveLine(gross, 0, …)` short-circuits to `taxable = total, tax = 0` (`invoice-math.ts:149-151`).
  - Expected on a ₹700 inclusive sale at 3%: taxable ₹679.61 + CGST ₹10.19 + SGST ₹10.20 = ₹700.00. Actual: taxable ₹700, tax ₹0. At 18% (see M-02) the tax should be ₹106.78 instead of ₹20.39.
  - GSTR-1 then reports these lines at `rt: 0`, so output tax is understated by the full tax amount on every such invoice.

- **Evidence:**
  - Live invoice `INV/26-27/00001` (created 2026-11-14 14:40:04Z, **after** the Oct-23 migration): line `quantity 1, unit_price 700, taxable_amount 700, gst_rate 0, cgst_amount 0, sgst_amount 0, total_amount 700`; header `taxable_value 700, total_tax 0, grand_total 700`.
  - The `products` table holds 13 rows, all `gst_rate = 0` (`select gst_rate, count(*) from products group by gst_rate` → `[(0, 13)]`).
  - Executed proof: `npx tsx` → `resolveLineGstRate(undefined, 0, true, 3)` returns `0`; `splitInclusiveLine(100000, 0, '29','29')` returns `taxablePaise: 100000, taxPaise: 0`.
  - The POS path really does see the product: a throw-away PocketBase probe (`posts` → `authors` → `profiles`, query `expand=author,author.profile`) returned the nested relation inside the expanded record's own `expand` map (`expand.author.expand.profile`), which is the shape `variant?.expand?.product` reads. So `product.gst_rate = 0` reaches the resolver, and the POS invoice is 0% too.
  - Pre-migration invoices (Oct 7/19) carry 3% — the field did not exist then, so `product.gst_rate` was `undefined` and the fallback applied. After the Oct-23 migration every product reads 0.
  - Test gap: nothing covers `createInvoiceFromSale` (no test file references it), and no test creates a product with a GST rate.

- **Minimal fix:** Write the rate when a product is saved, e.g. in `src/app/inventory/page.tsx` payload add `gst_rate: getGSTRateForHSN(newProduct.hsn_code)` (or default 3 for chapter 71.13), and treat `0` as "unset" in `resolveLineGstRate` when the product's HSN/rate says otherwise. If per-line rates are intended, also add `gst_rate` to the `sale_items` schema.
- **Confidence:** confirmed

---

### M-02 [HIGH] The catalog's HSN maps to 18% but every invoice path uses the 3% jewelry default; `getGSTRateForHSN` is dead code — `src/lib/gst.ts:316`

- **What the code does:**
  - `src/lib/gst.ts:316-320` — `export function getGSTRateForHSN(hsn) { if (hsn.startsWith('7117')) return GST_RATES.IMITATION; if (hsn.startsWith('7113')) return GST_RATES.JEWELRY; … }`, with `GST_RATES.IMITATION = 18.0` (`gst.ts:15`). Nothing calls this function anywhere (`findstr /s "getGSTRateForHSN"` matches only its definition).
  - `src/app/invoices/create/page.tsx:239-240` and `src/lib/invoice.ts:1291-1296` use the per-product rate or `GST_RATES.JEWELRY` (3) — never the HSN.
  - `src/app/inventory/page.tsx:2181` labels the field `Statutory HSN Code (3% GST)`.

- **Why it is wrong:** All 13 live products use `hsn_code = 71179010` (imitation jewellery). The app's own statutory mapping says 7117 → 18%, yet invoices are issued at 0% (M-01) or 3%. Per ₹1,00,000 tax-inclusive:
  - 18%: taxable ₹84,745.76 + tax ₹15,254.24.
  - 3%: taxable ₹97,087.38 + tax ₹2,912.62.
  - The 15-point gap is ₹12,341.62 of output tax per ₹1 lakh of this catalog's sales, and the invoice/GSTR-1 rate (`rt: 3` or `0`) does not match the HSN summary's rate for the same goods.

- **Evidence:** live catalog query `select hsn_code,count(*) from products group by hsn_code` → `[('71179010', 13)]`; invoice items for that catalog carry `gst_rate 3` or `0`. `GST_RATES.IMITATION` exists and is used only by the never-called `getGSTRateForHSN`. The product form has no rate selector, so there is no way for an operator to correct the rate without a DB edit.
- **Minimal fix:** Derive the product's GST rate from its HSN on save (`getGSTRateForHSN(hsn_code)`), and use the same helper as the fallback in the invoice/POS rate resolution instead of `GST_RATES.JEWELRY`.
- **Confidence:** confirmed (code behaviour); the 18% figure is the app's own mapping for HSN 7117.

---

### M-03 [HIGH] Loyalty redemption is not re-capped after the bill changes; the sale commits, the redemption then fails and is swallowed — `src/app/pos/page.tsx:1627`

- **What the code does:**
  - `src/app/pos/page.tsx:1272` computes the slider cap from the current bill: `const maxPoints = await calculateMaxRedeemablePoints(subtotal - discountAmount, account.current_balance);`
  - `src/app/pos/page.tsx:1214-1215` fixes the redemption value in `total`: `const loyaltyDiscount = … redemptionValue …; const total = Math.max(0, … subtotal - discountAmount - loyaltyDiscount …);`
  - Changing the cart or applying a coupon recomputes `maxRedeemablePoints` but never clamps `pointsToRedeem`; `redemptionValue` depends only on `pointsToRedeem` (effect at `:1288-1301`).
  - `src/app/pos/page.tsx:1501-1518` (`validateLoyaltyRedemption`) checks only balance and minimum points — not the `max_redemption_percent` cap.
  - The sale is written at `:1584`, and only afterwards `:1627-1629` calls `redeemPoints(…, billAmount = Math.max(0, subtotal - discountAmount))`. `src/lib/loyalty.ts:495-499` re-checks the percentage cap against that (now smaller) bill and throws `At most N points can be redeemed on this bill`; the catch at `:1633-1636` only logs and shows a warning.

- **Why it is wrong:** The customer keeps the discounted total but the points are never debited. With the shipped defaults (`redemption_value 0.5`, `max_redemption_percent 50`, no `loyalty_settings` row in the DB → defaults apply):
  - Bill ₹1,000, customer 1,000 points. Set the slider to 1,000 (cap = 1,000; value ₹500), total ₹500.
  - Apply a 50% coupon (or delete half the cart): bill base becomes ₹500; total becomes `1000 − 500 − 500 = ₹0`, and `validateSaleTotals` accepts it (loyalty ≤ discounted subtotal, total = 0).
  - The sale is saved at ₹0. `redeemPoints` is then called with `billAmount = 500`, computes a cap of 500 points, throws, and the exception is swallowed. Goods worth ₹1,000 leave for ₹0 and the 1,000 points (₹500) remain on the account.
  - A smaller variant: ₹250 bill, 204 points, then a 50% coupon → total ₹23 and the 204 points are retained.

- **Evidence:** Caller trace above; `test-phase2-phase3.ts:1030-1040` tests only "more points than balance", not the percentage cap after a bill change. No test drives the POS component sequence. The POS UI still displays `Save {redemptionValue}` after the cap shrinks.
- **Minimal fix:** In `validateLoyaltyRedemption`, recompute `calculateMaxRedeemablePoints(subtotal - discountAmount, account.current_balance)` and refuse (or clamp `pointsToRedeem`) when it is exceeded — before `createPOSSale`. A redemption failure should never be downgraded to a post-commit warning.
- **Confidence:** confirmed

---

### M-04 [HIGH] `/invoices/create` can save a "Credit Note"/"Debit Note" as a positive sales invoice; it never reaches GSTR-1 and inflates the invoice register — `src/app/invoices/create/page.tsx:620`

- **What the code does:**
  - `src/app/invoices/create/page.tsx:620-629` offers `credit_note` and `debit_note` in the Invoice Type select; `:486` persists `invoice_type: invoiceType`; `:501-509` persist positive `taxable_value`, `total_tax` and `grand_total`.
  - `src/lib/invoice.ts:431-449` allocates the number from the `INV/…` sequence for every type, and `:646-649` writes it into `invoices`.
  - `src/lib/gstr1-report.ts:196-199` loads only `invoice_type="regular"` from `invoices`, and `:214` loads credit notes from the **separate** `credit_notes` collection (the one written by `src/lib/returns.ts:285-362`). The compiler's `credit_note` handling (`gstr1-engine.ts:295-296`) therefore never sees these rows.
  - `src/app/invoices/page.tsx:200` sums `invoices.reduce((sum, inv) => sum + inv.grand_total, 0)` over `getInvoices()`, which has no type filter (`invoice.ts:981-1013`), so the note is added as revenue.

- **Why it is wrong:** A "credit note" raised on this page is a positive ₹X invoice:
  - it is not reported as a credit note in GSTR-1 (output tax is not reduced; the return overstates sales by the note),
  - it is added to the invoices page's Total Value/Balance Due as if it were a sale,
  - it can be "paid" (`recordPayment`, `markInvoicePaid`) and cloned, and it carries an `INV/` number rather than a `CN/` number.
  Example: a ₹10,300 return entered here leaves GSTR-1 untouched (₹10,300 taxable and ₹300 tax still reported) and adds ₹10,300 to the register total. The real returns path (`/returns` → `createCreditNoteFromInvoice`) is the only one the filing builder reads.

- **Evidence:** Grep shows `invoice_type: 'credit_note'` is never set anywhere except the create page (and a test); the only `credit_notes` writers are in `returns.ts`. Existing test `test-gstr1-engine.ts` feeds a credit note directly to the compiler, so it does not cover the builder's source selection; no test covers `buildGstr1OfficialPayload` against the DB.
- **Minimal fix:** Remove credit/debit note from the invoice create page (route them to the returns flow), or include `invoice_type IN ("credit_note","debit_note")` rows in `buildGstr1OfficialPayload` and subtract them from the invoice list totals and the `INV` sequence.
- **Confidence:** confirmed

---

### M-05 [MEDIUM] Inter-state POS sales print CGST/SGST halves on the 80 mm tax receipt even though the invoice is IGST — `src/app/pos/page.tsx:696`

- **What the code does:**
  - `src/app/pos/page.tsx:696-698` — `const taxHalf = lastTransaction.gstIncluded ? Number((lastTransaction.gstIncluded / 2).toFixed(2)) : 0;`
  - `:723-724` passes `cgst: taxHalf, sgst: taxHalf` to `MobilePrinter.generate80mmReceiptHtml`.
  - `src/lib/mobile-printer.ts:154-155` prints `CGST:` and `SGST:` when non-zero; there is no IGST field in `ReceiptData`.

- **Why it is wrong:** `createInvoiceFromSale` derives the buyer state from the linked customer (`invoice.ts:1267-1274`) and issues IGST for an out-of-state customer. The customer's receipt (which carries the store GSTIN and invoice number) still shows the 3% split as 1.5% CGST + 1.5% SGST. Example: ₹5,000 inter-state sale → invoice IGST ₹145.63; receipt prints CGST ₹72.82 + SGST ₹72.82, which is the wrong tax head and not a valid credit for the buyer. The persisted invoice is correct; only the printed document is wrong.
- **Evidence:** The split is unconditional on `isInterState`; `invoice.gstIncluded` carries no state information. The only live inter-state invoice in the DB (`INV-1792431222736`, buyer GSTIN 27…, state 27) stores `igst_amount 149.97, cgst 0, sgst 0` — the 80 mm path would still print two halves. Reachability of an inter-state POS sale needs the linked customer to have `state_code`; no customer UI collects it, so today this comes from imported/edited customer rows (the POS-12 code reads it).
- **Minimal fix:** Pass the actual CGST/SGST/IGST amounts (from the sale's invoice or from `splitInclusiveLine` with the buyer state) into the 80 mm receipt instead of `gstIncluded / 2`.
- **Confidence:** confirmed (code); reachable when the linked customer has a state code.

---

### M-06 [MEDIUM] A coupon is recorded as used with the wrong amount (or ₹0) when its discount was replaced or cleared — `src/app/pos/page.tsx:1353`

- **What the code does:**
  - `src/app/pos/page.tsx:1353-1357` — selecting a tiered customer overwrites the bill discount: `setDiscountMode('percent'); setDiscount(tierDiscount);` without touching `appliedCoupon`.
  - `:1363-1369` — clearing the customer sets `setDiscount(0)` and leaves `appliedCoupon` set.
  - At checkout, `:1620-1626` records whatever coupon is still in state: `await recordDiscountUsage(appliedCoupon.discount.id, discountAmount, subtotal, …)`.
  - `src/lib/discounts.ts:442-507` increments `used_count` and writes `discount_amount: discountAmount` to `discount_usage`.

- **Why it is wrong:** The coupon consumed is not the discount the customer received:
  - Apply `ANNIV7` (7% = ₹70 on ₹1,000), then select a Silver customer (3% tier) → bill discount becomes ₹30; checkout burns one `ANNIV7` use and records savings of ₹30 although the coupon gave nothing.
  - Apply `CARE50` (₹500), then "Switch to Walk-in" → discount becomes ₹0 and the coupon is still consumed with `discount_amount: 0`.
  The bill total is not wrong, but the coupon's usage limit is burned, per-customer caps are consumed, and `getDiscountStats().totalSavings` / campaign ROI are wrong.
- **Evidence:** Caller trace above. No test covers the POS coupon/customer interaction (`test-phase2-phase3.ts:1176-1220` tests only the service's own increment).
- **Minimal fix:** Call `setAppliedCoupon(null)` in `handleSelectCustomer` and `handleClearCustomer` (and whenever `setDiscount` is overwritten), and record the coupon's actual applied amount rather than the whole bill discount.
- **Confidence:** confirmed

---

### M-07 [MEDIUM] A credit note approved after the month of its creation is never filed in any GSTR-1 — `src/lib/gstr1-report.ts:219`

- **What the code does:**
  - `src/lib/gstr1-report.ts:219-222` — `const periodNotes = allNotes.filter((note) => note.status !== 'draft' && note.status !== 'pending' && inRange(creditNoteDate(note), start, end));`
  - `:140-143` — `creditNoteDate` uses `note_date / credit_note_date / issue_date / document_date / date / created`; none of the first five columns exists on `credit_notes` (created at `returns.ts:295-316`), so it always uses `created`.
  - `src/lib/returns.ts:481` — approval only updates `status: 'approved'`; it writes no date.
- **Why it is wrong:** A note is numbered and created in month A (it is a document), but it is omitted from A's payload while pending. In month B it is approved; B's payload filters by `created` (month A), so it is omitted again. The credit note never reduces output tax in any period. Example: a ₹10,300 CN created 31 Oct, approved 2 Nov → no GSTR-1 for October (pending at build time) and none for November (created date outside the period), so ₹300 of CGST/SGST stays payable.
- **Evidence:** Status flow (`returns.ts:454-481`, `669`, `809`) and the date fields above; no test covers `buildGstr1OfficialPayload` (only the pure compiler).
- **Minimal fix:** File a note in the period of its issue (drop `status !== 'pending'` from the filter, keeping cancelled/draft excluded), or stamp an `issue_date/approved_at` on approval and use that in `creditNoteDate`.
- **Confidence:** confirmed

---

### M-08 [MEDIUM] Export invoice charges a hard-coded 3% IGST for every HSN, including 18% imitation jewellery — `src/lib/cross-border-engine.ts:174`

- **What the code does:**
  - `src/lib/cross-border-engine.ts:174-175` — `const gstRate = req.isLutExport ? 0 : 3.0; const gstAmtInr = req.isLutExport ? 0 : Math.round((lineTotalInr * (gstRate / 100)) * 100) / 100;`
  - `src/app/reports/export/page.tsx:42,85,127` — the operator can type any HSN per line (`EMPTY_ITEM.hsnCode = "7113"`), but no rate is captured.
- **Why it is wrong:** An IGST-paid export of an 18% good (HSN 7117, which this app's catalog uses) is invoiced at 3%: on ₹1,00,000 the document shows ₹2,912.62 IGST instead of ₹15,254.24, a ₹12,341.62 shortfall on a statutory export invoice. The LUT path is correctly zero-rated; only the paid path is wrong.
- **Evidence:** The rate is a literal in the engine; `hsnCode` is an input but is never mapped (`getGSTRateForHSN` is not imported here). `test-cross-border.ts:75-81` asserts the 3% behaviour, so the test locks in the defect for non-jewelry items rather than catching it.
- **Minimal fix:** Add a per-line `gstRate` (defaulting from `getGSTRateForHSN(hsnCode)`) and use it instead of the literal `3.0`.
- **Confidence:** confirmed

---

### M-09 [MEDIUM] Loyalty points accrue at 1/100 of the configured rate: the setting is labelled per ₹1 but the formula divides by 100 — `src/lib/loyalty.ts:337`

- **What the code does:** `src/lib/loyalty.ts:337` — `let points = Math.floor((purchaseAmount / 100) * settings.points_per_rupee);` The settings field is presented as `Points per ₹1 Spent` (`src/app/customers/page.tsx:2492`) and named `points_per_rupee`.
- **Why it is wrong:** With the shipped defaults (`points_per_rupee 0.1`, `redemption_value 0.5`), ₹1,000 earns `floor(10 × 0.1) = 1` point = ₹0.50 (0.05%). Read per ₹1, as the UI says, it should be `floor(1000 × 0.1) = 100` points = ₹50 (5%). The default redemption rate and the default earn rate are internally consistent only under the per-₹1 reading, so the formula accrues 100× less loyalty liability than the operator configures and the POS displays ("Points You'll Earn") — and the customer receives 1/100 of the promised value.
- **Evidence:** `calculatePointsToEarn` is the only earn formula (`:332-350`) and is used by both the POS preview (`pos/page.tsx:1271`) and `earnPoints` (`:426`); `test-phase2-phase3.ts:1030-1031` only asserts `pointsEarned > 0`. The comment above the line restates the same /100 formula, so code and label disagree rather than the maths being ambiguous.
- **Minimal fix:** Align the two: either `Math.floor(purchaseAmount * settings.points_per_rupee)` or relabel the setting as "points per ₹100" and keep the formula. (This changes customer liability 100×, so decide which is intended.)
- **Confidence:** likely (the code/label contradiction is confirmed; which side is intended needs the product owner).

---

### M-10 [MEDIUM] POS invoices default the seller's state to `'27'` (Maharashtra) instead of the GSTIN's state — `src/lib/invoice.ts:1262`

- **What the code does:** `src/lib/invoice.ts:1262` — `const sellerStateCode = storeSettings.store_state_code || '27';` when building the invoice from a sale. The settings page exposes `State Code` as an optional free-text 2-character field (`src/app/settings/page.tsx:995-1002`); nothing derives it from the GSTIN.
- **Why it is wrong:** A store outside Maharashtra with a blank `store_state_code` (only GSTIN filled, which is the normal setup) gets `seller_state_code = 27` and `place_of_supply = buyerStateCode`. A walk-in sale is then filed as POS 27 rather than the store's real state, and the inter-state test is wrong: for a Karnataka store (GSTIN 29…) with a Karnataka customer (state 29), `27 !== 29` makes `splitInclusiveLine` charge **IGST** on an intra-state sale; for a Maharashtra customer it charges CGST/SGST on an inter-state sale. The invoice header contradicts its own GSTIN.
- **Evidence:** `gst.ts:113-133` and `gstr1-report.ts:320` already fall back to the GSTIN prefix (`gstin.substring(0,2)`) — this one line does not. `store_state_code` is absent for a fresh install (`invoice.ts:252` REAL_STORE_DEFAULTS).
- **Minimal fix:** `const sellerStateCode = storeSettings.store_state_code || storeSettings.store_gstin.slice(0, 2) || '27';`
- **Confidence:** confirmed

---

### M-11 [LOW] Cancelled invoices still count as revenue and balance due on the invoices page — `src/app/invoices/page.tsx:200`

- **What the code does:** `src/app/invoices/page.tsx:200-202` — `const totalRevenue = invoices.reduce((sum, inv) => sum + inv.grand_total, 0); const pendingAmount = Math.max(0, totalRevenue - paidAmount);` over `getInvoices()`, whose filter (`invoice.ts:981-1013`) has no status condition; `getStatusBadge` (`:208-216`) only knows paid/partial/pending, so a cancelled invoice renders as "Pending".
- **Why it is wrong:** Cancelling an order sets its linked invoices to `status: 'cancelled'` (`src/lib/orders.ts:977-988`). Those invoices remain in the list and in Total Value / Balance Due, and are shown as pending — the register, and any operator chasing dues, treats a cancelled bill as receivable. The GSTR-1 builder and `reports.ts` do exclude cancelled invoices, so the app's own reports disagree with its invoice page.
- **Evidence:** `orders.ts:987` is the only writer of `status: 'cancelled'` for invoices; `getInvoices` has no status/isDeleted-excluded logic beyond trash. No test covers the page aggregate.
- **Minimal fix:** Filter `status != "cancelled"` in `getInvoices` (or exclude cancelled rows from `totalRevenue`/`pendingAmount` and badge them).
- **Confidence:** confirmed

---

### M-12 [LOW] A coupon whose expiry date is today is already expired from 05:30 IST — `src/lib/discounts.ts:356`

- **What the code does:** `src/lib/discounts.ts:356-358` — `if (discount.end_date && new Date(discount.end_date) < now) { return { valid: false, error: 'This discount has expired', … }; }`. The expiry is entered with an HTML date input (`src/app/customers/page.tsx:2406-2407`), i.e. `YYYY-MM-DD`.
- **Why it is wrong:** `new Date('2026-11-30')` is 2026-11-30T00:00:00Z = 05:30 IST. A coupon advertised "valid until 30 Nov" stops working at 05:30 on 30 Nov, so the whole expiry day is unusable. Expected: valid through 23:59:59 local on the end date.
- **Evidence:** The date-only input and `new Date()` comparison above; `validateDiscount` is called from the POS at `pos/page.tsx:1173`. `test-phase2-phase3.ts:1213` uses no date bounds.
- **Minimal fix:** Compare against `new Date(`${discount.end_date}T23:59:59`)`, or use the same end-of-day normalisation as `normalizeDateBounds`.
- **Confidence:** confirmed

---

### M-13 [LOW] A 0 redemption value is accepted: division by zero in the cap and points debited for ₹0 — `src/lib/loyalty.ts:369`

- **What the code does:** `src/lib/loyalty.ts:369-370` — `const maxValueFromBill = billAmount * (settings.max_redemption_percent / 100); const maxPointsFromBill = Math.floor(maxValueFromBill / settings.redemption_value);` `saveLoyaltySettings` (`:143-144`) only does `Number(settings.redemption_value ?? 0.5)` — no positivity check — and the settings input allows `min="0"` (`src/app/customers/page.tsx:2508-2520`).
- **Why it is wrong:** With `redemption_value = 0`, `maxPointsFromBill` is `Infinity`, so `maxRedeemablePoints` returns the whole balance and the POS shows a redemption slider; `calculateRedemptionValue` returns 0, so redeeming debits the points and applies no discount (the customer loses points for nothing). Expected: a zero/negative rate must be refused when saving.
- **Evidence:** The only guard is `Number.isFinite(pointsToRedeem)` in `redeemPoints`; `points * 0 = 0` is a valid `valueApplied`. No test covers a zero rate.
- **Minimal fix:** Clamp `redemption_value` to a positive minimum in `saveLoyaltySettings` (and guard the division in `calculateMaxRedeemablePoints`).
- **Confidence:** confirmed

---

## Checked and clean

Files read in full where no real money/tax defect was found:

- `src/lib/valuation.ts` — landed-cost allocation is exact to the paise (remainder forced onto the last active line), zero-quantity lines never absorb overhead, weighted average uses quantity × landed cost. Covered by `test-valuation.ts`.
- `src/lib/pricing-rules.ts` — override → rule → base precedence, gateway gross-up (`ceil(net/(1−fee))`), rounding modes and variant adjustment are coherent. `charm99` is correct nearest-x99.
- `src/lib/channel-pricing.ts` — price resolution and realised-margin maths (fee deducted, margins rounded to 0.1%) are correct; the UPI waiver helper matches its stated policy.
- `src/lib/server-pricing.ts` — tenant-scoped channel load; no arithmetic.
- `src/lib/jewelry-engine.ts` — net weight (gross − stone grams), wastage on net weight, per-gram making on net weight, percent making on metal, 3-decimal gram rounding all correct.
- `src/lib/imitation-jewelry-engine.ts` — wholesale tier selection is order-independent and clamps 0–100%; unit price and totals are paise-rounded.
- `src/lib/gstr1-engine.ts` — the compiler itself is correct: B2B/B2CL/B2CS classification by GSTIN and threshold, inter-state by POS, rate-grouped items, CDNR/CDNUR, HSN net of credit notes, doc-issue ranges, date/empty-line gates. Full table coverage in `test-gstr1-engine.ts`. (Its credit-note *source* in `gstr1-report.ts` is M-04/M-07.)
- `src/lib/item-cost.ts` — resolution order (landed weighted average → product cost → unknown) and tenant scoping are correct. Note: `quantity_received || quantity_ordered` deliberately falls back to ordered quantity; the same basis is used by `reports.ts:400-404`, so it is a shared valuation convention, not a one-sided bug.
- `src/components/pos/Receipt.tsx` and `src/components/pos/Cart.tsx` — display only; subtotal rounding is consistent with the POS page; no persisted money.
- `src/app/invoices/detail/page.tsx` — payment entry is guarded twice (client outstanding check and `recordPayment`'s ledger-aware overpayment refusal), balance is clamped at zero, and the UPI QR amount is the balance due.

Within the files that do carry a finding, these parts were verified correct and are not defects: `pos-sales.ts` `validateSaleQuantities`/`validateSaleTotals` (tamper, negative/zero qty, discount outside the bill, over-redemption; `getTodaysSalesSummary`/`getSalesByShift` are uncalled); `invoice-math.ts` inclusive/exclusive splits, cess, largest-remainder allocation and the taxable+tax=total invariant (`test-invoice-math.ts`); `invoice.ts` `createInvoice`'s line-to-header reconciliation (±5 paise) and payment guards; `gst.ts` `calculateGST`/`amountToWords`/GSTIN check digit; `discounts.ts` percentage/fixed maths, caps, usage reservation and rollback (the expiry boundary is M-12); `loyalty.ts` atomic balance operators, negative-balance compensation and the cap inside `redeemPoints`; `pos/page.tsx` `validateSaleTotals` usage, single rounding of the line subtotal and the idempotent transaction id.

Existing tests that already lock in the correct behaviours (and therefore are not findings): inclusive/exclusive GST splits and paise additivity, discount allocation exactness, zero-rate lines, inter-state IGST, rate-resolution precedence (`test-invoice-math.ts`); POS quantity/tamper/negative-total rejection (`test-pos-quantity.ts`); GSTR-1 tables 4/5/7/9B/12/13 and GSTIN/date/UQC (`test-gstr1-engine.ts`), MMYYYY/FY boundary (`test-gstr1-period.ts`); landed-cost allocation and weighted average (`test-valuation.ts`); export FX/LUT/IGST arithmetic (`test-cross-border.ts`); loyalty over-redeem and discount usage increment (`test-phase2-phase3.ts`).

Test gaps behind the findings: no test exercises `createInvoiceFromSale` or the POS checkout sequence, no test drives `buildGstr1OfficialPayload` against the DB (credit-note source selection), and no test creates a product with a GST rate — which is why M-01, M-03, M-04 and M-07 pass the current 30 suites.
