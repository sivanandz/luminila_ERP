# Wave 1 — Stock Integrity Audit

Scope: quantity mutations, returns, QC, packing, ledger, bundles, cycle count, multi-location.
Baseline: `tsc` clean, `eslint` clean, 30 logic suites passing — only defects not caught by those are reported.
Method: full file reads plus `findstr` / `git grep` caller traces; every claim below is derived from current source, not from older reports.

Severity key: CRITICAL = deterministic stock corruption in a normal flow; HIGH = stock corruption in a normal flow with one extra condition (retry, concurrency, bundle/draft, duplicate scan); MEDIUM = wrong stock/ledger under a supported but narrower flow; LOW = data loss limited to a transient feature.

---

### S-01 [CRITICAL] Draft/archived products lose their stock when edited, and tray audits re-add it as surplus — `src/lib/products.ts:483`, `src/app/inventory/page.tsx:623,802-808`
- What the code does:
  - Inventory lists every product: `getProducts({ activeOnly: false })` (`inventory/page.tsx:572`), but the variant summary used for stock/existence is filtered to active products: `filter: \`product.is_active = true${tenantClause()}\`` (`products.ts:483`). The list then does `stock: variantMap.get(p.id) || 0` (`inventory/page.tsx:623`).
  - New products are drafts (`is_active: false`, `inventory/page.tsx:748-750`; quick-product also writes `is_active: false`). Opening such a product for edit seeds the form with that zero (`stock: String(product.stock)`, line 996). On save the single-variant branch derives the delta from the *live* variant and writes the form value absolutely:
    ```ts
    const liveVariantStock = Number(variants[0].stock_level || 0);
    const stockDelta = parsedStock - liveVariantStock;
    ...
    await updateVariant(variants[0].id, { stock_level: Math.max(0, liveVariantStock + stockDelta) });
    ```
    (`inventory/page.tsx:802-808`)
- Why it is wrong:
  - Draft product created with stock 5: grid shows `Stock: 0` (excluded from `variantMap`). Open Edit, change only the price, Save → `parsedStock = 0`, `liveVariantStock = 5`, `stockDelta = -5`, variant is written to 0 and a `-5` movement is logged. Stock is destroyed with no warning.
  - The same zero is fed to the tray audit (`products={products}`, `inventory/page.tsx:2679`; diff line copies `stock: p.stock`). A draft/archived product physically on the tray has `expectedQuantity = 0`; scanning its 5 tags becomes surplus 5 and `acceptSurplus` adds `+5` to the variant (`cycle-count.ts:195-210`) → an existing 5 becomes 10.
  - Archiving an active product reproduces it: `handleArchiveToggle` sets `is_active:false`, and the next edit/audit sees zero stock.
- Evidence: caller trace `fetchProducts` → `getVariantStockSummary` → `openEditProduct`/`TrayCycleCountModal` → `handleAddProduct`/`commitTrayAudit`. No test covers `getVariantStockSummary` or the edit-stock path; `test-packing`/`test-cycle-count` only exercise pure functions with hand-made stock values.
- Minimal fix: remove `product.is_active = true` from `getVariantStockSummary` (scope by tenant only), so every product returned by `getProducts({activeOnly:false})` carries its real variant stock; callers that truly need only active products already filter themselves.
- Confidence: confirmed

---

### S-02 [HIGH] Returning a bundle restocks none of its component variants — `src/lib/returns.ts:374-400,592-601`, `src/lib/channel-stock.ts:212-233,442-459`
- What the code does:
  - A bundle sale deducts the component variants and writes the sale ledger rows against those components, referencing the sale/order id (`channel-stock.ts:212-233`, movement at 442-459).
  - The invoice/credit-note line still carries the bundle product's own variant (`orders.ts:567 variant_id: item.variant`; POS invoices map sale items the same way). On approval the restock is gated on evidence for that variant only:
    ```ts
    const deducted = await wasStockDeducted(item.variant, cn as {...});
    if (!deducted) { console.warn(... skipping restock to avoid minting stock ...); }
    else { await pb.collection('product_variants').update(item.variant, {'stock_level+': item.quantity}); ... }
    ```
    and `wasStockDeducted` queries `variant="<bundle variant>" && reference_id=... && movement_type="sale"` (`returns.ts:395`).
- Why it is wrong:
  - No `sale` movement exists for the bundle's own variant; only its components were decremented. The guard therefore reports "never deducted" and skips the restock even for QC grade `restock_grade_a`.
  - Concrete: bridal set = choker ×1 + bangle pair ×2. Sale deducts 3 components. Customer returns the set Grade A, approval restocks 0. The goods are physically back, the customer is refunded, and stock stays 3 units low forever. The UI still toasts "restored to available stock" (`returns/detail/page.tsx:204-208`).
  - The same happens to a bundle line in a POS sale because the invoice line's `variant` is the bundle's variant while the movements are on the components.
- Evidence: `wasStockDeducted` trace; `resolveStockTargets` bundle branch (`channel-stock.ts:212-235`); `createReturnFromInvoice` copies `invoice_items.variant` unchanged (`returns.ts:914-929`). No test covers a bundle return; `test-packing` only covers packing explosion.
- Minimal fix: in approval, when the item's product `is_bundle`, explode `bundle_items` and call `wasStockDeducted`/restock per component variant (or record a `sale` movement on the bundle variant when selling the bundle).
- Confidence: confirmed

---

### S-03 [HIGH] Cancelling an order after a return restocks the returned units a second time — `src/lib/orders.ts:914-919`, `src/lib/channel-stock.ts:529-541`, `src/lib/returns.ts:610-618`
- What the code does:
  - Order cancellation restores every `sale` movement for the order that has no reversal marker: `restoreChannelStockForReference(... referenceId: orderId ...)` (`orders.ts:914-919`). The marker search only considers `movement_type="return"` rows whose `reference_id` is the same order id and whose notes contain `[reversal-of:<movement>]` (`channel-stock.ts:529-541`).
  - Return approval writes its restock as `movement_type: 'return'`, `reference_id: id` (the credit-note id), with no marker (`returns.ts:610-618`).
  - `canCancelSalesOrder` allows `invoiced` orders (`orders.ts:830-832`), and returns do not change the order status.
- Why it is wrong:
  - Order for 2 units: sale `-2`. A 1-unit return is approved → `+1` with a credit-note reference. The order is then cancelled pre-dispatch → the cancel sees no reversal marker for the order's sale rows and restores `+2`. Net across sale/return/cancel = `+1` over the original stock for a sale that actually shipped 0 of the returned unit.
  - The reverse order is equally broken: a pending credit note created before the cancellation can be approved afterwards, because cancellation restores the sale but leaves the credit note pending; approval then restocks the same line again.
  - Both actions are exposed in the UI (returns/detail "Approve"; orders/detail Cancel for non-dispatched invoiced orders).
- Evidence: sequence trace over `createReturnFromInvoice` → `approveCreditNote` → `cancelSalesOrder`; marker format in `channel-stock.ts:509`; no test covers cancel-after-return.
- Minimal fix: before restoring a sale movement, also treat a `return` movement from any credit note whose `original_invoice`/`original_sale` matches the order as a reversal (or mark the sale movement reversed from `approveCreditNote`).
- Confidence: confirmed

---

### S-04 [HIGH] Credit-note approval half-applies its restocks; retry restocks the already-applied lines again — `src/lib/returns.ts:549-637`
- What the code does:
  - Approval loops items and writes `stock_level+` per line, then a movement. If any later line throws, the catch only reverts the note status:
    ```ts
    } catch (itemErr) {
        ...
        await pb.collection('credit_notes').update(id, { status: 'pending' }).catch(...);
        throw new Error(`Inventory update failed ... the note was returned to pending.`);
    }
    ```
    (`returns.ts:624-637`). There is no compensation for lines already restocked.
- Why it is wrong:
  - CN with two lines, qty 1 each. Line 1 restocks (+1). Line 2 fails (variant deleted, `assertVariantOwned` 404, network/PB error, or a quarantine-branch discrepancy create failing). The note returns to `pending`. The operator retries as instructed; the idempotency guard only skips `approved/refunded/exchanged`, so line 1 is restocked again → stock is `+1` above reality.
  - If the status revert itself fails, the note stays `approved` and the retry is skipped by the guard, leaving the remaining lines unrestocked — the same missing/extra split, opposite direction.
- Evidence: catch trace; `test-enhancements.ts` exercises only the happy path against a live DB and is not one of the logic suites. No test injects a mid-loop failure.
- Minimal fix: track applied `{variant, qty}` and, in the catch, decrement them and delete their movements before reverting to pending.
- Confidence: confirmed

---

### S-05 [HIGH] Receiving a transfer double-adds destination stock when the manifest repeats a SKU — `src/lib/multi-location.ts:649-690`, `src/components/inventory/StockTransferModal.tsx:148-157`
- What the code does:
  - The manifest appends every scan without deduplication (`setTransferItems((prev) => [...prev, {...}])`, modal lines 148-157).
  - On receive, quantities are collapsed into a map keyed by variant/product, then the map is applied once per manifest line:
    ```ts
    const requested = receivedItems?.find((r) => r.variantId === item.variant_id)?.quantity;
    ...
    receivedQuantities.set(item.variant_id || item.product_id, receivedQty);
    ...
    for (const item of transfer.items) {
        const receivedQty = receivedQuantities.get(item.variant_id || item.product_id) ?? 0;
        ...
        await adjustLocationStock(idToAdd, transfer.destination_location_id, receivedQty, ...);
    }
    ```
    (`multi-location.ts:649-657, 678-690`)
- Why it is wrong:
  - Add the same SKU twice (qty 2 and qty 3). Dispatch subtracts 5 from the source. Receive builds `map[A] = 3` (last write wins) and then executes the loop twice: destination `+3 +3 = +6`. The location ledger gains one unit that never existed; both stored `received_quantity` values also say 3.
  - The receipt has no UI dedupe or warning, so this is reachable by scanning a piece twice or adding a second line while the first is still in the manifest.
- Evidence: modal append path; dispatch deduction loop (`multi-location.ts:570-591`); receive loop above. No test covers multi-location at all.
- Minimal fix: key the received quantities by line identity (index or a per-line id) instead of variant id, or merge+reject duplicate manifest lines before dispatch.
- Confidence: confirmed

---

### S-06 [HIGH] Editing a single-variant product overwrites stock with the stale value captured when the dialog opened — `src/app/inventory/page.tsx:996,800-818`
- What the code does:
  - The edit form is seeded with the product's stock at open time (`stock: String(product.stock)`, line 996). On save, the single-variant branch computes `stockDelta` against the *live* variant but writes the form value back:
    ```ts
    const liveVariantStock = Number(variants[0].stock_level || 0);
    const stockDelta = parsedStock - liveVariantStock;
    ...
    await updateVariant(variants[0].id, { stock_level: Math.max(0, liveVariantStock + stockDelta) });
    ```
    The multi-variant matrix does the opposite and only writes when the user actually changed the row (`ev.stock_level - ev.original_stock`).
- Why it is wrong:
  - Stock 10; manager opens Edit; a cashier sells 1 unit (stock 9); manager changes the name and saves. `parsedStock = 10`, `liveVariantStock = 9`, `stockDelta = +1`, variant is written to 10 and a `+1` "manual stock increase" movement is logged. The sale is silently undone. A restock in the same window is silently erased the other way.
  - Nothing on the form indicates it will overwrite the stock; the user never touched the stock field.
- Evidence: form seeding at 996; save path above; live subscription updates `products`, not `newProduct` (`fetchProducts` / `subscribeInventoryChanges`), so the form cannot see the change. No test covers this UI path.
- Minimal fix: keep `original_stock` for the single-variant case and only apply the stock change when `parsedStock !== original_stock`, exactly as the variant matrix does.
- Confidence: confirmed (logic); requires a sale/restock between dialog open and save

---

### S-07 [HIGH] Tray cycle count deducts/adjusts an arbitrary "primary" variant and silently reports success when that adjustment fails — `src/lib/cycle-count.ts:174-216,256-262`, `src/lib/products.ts:494-496`, `src/app/inventory/page.tsx:636`
- What the code does:
  - The audit is product-level: `expectedQuantity` is the product's aggregate stock, and the line carries one `variant_id` copied from `primaryVariantByProduct` — the first variant returned by an unsorted query (`products.ts:494-496`), wired at `inventory/page.tsx:636`.
  - Missing items are quarantined at that variant: `markStockDiscrepancy({ variant_id: item.variantId, quantity: missingQty, ... })` (`cycle-count.ts:174-186`), and surplus increments the same variant (`cycle-count.ts:198-202`). Per-item failures are only warned:
    ```ts
    } catch (e) {
        console.warn(`Failed to quarantine missing item ${item.sku}:`, e);
    }
    ```
    and the commit still creates the audit row and returns `success: true` (`cycle-count.ts:235-262`).
- Why it is wrong:
  - Quick-add rings create size variants 10-18 with stock only on 14 (`quick-product.ts:83-104`). The first variant is size 10 with 0. A ring tray with expected 5 and scanned 4 produces `markStockDiscrepancy(size 10, qty 1)`; `markStockDiscrepancy` re-reads that variant's stock (0) and throws `Cannot flag 1 units. Only 0 units available` (`discrepancies.ts:85-91`). The catch swallows it: the shortage is never recorded, stock stays 5, and the toast says "audit completed".
  - A surplus on the same tray is added to size 10 even though the extra pieces are another size, so per-size stock is wrong in the opposite direction.
- Evidence: `getVariantStockSummary` order and `primaryVariantByProduct` map; diff line construction (`cycle-count.ts:84-101`); commit loop; `test-cycle-count.ts` tests only the pure diff with one variant per product.
- Minimal fix: scan the variant suffix (or let staff pick the size) and reconcile per variant; if any adjustment fails, return `success:false` instead of a completed audit.
- Confidence: confirmed

---

### S-08 [HIGH] A product-level tag on a multi-variant product resolves to an arbitrary variant, defeating the packing ambiguity guard — `src/lib/products.ts:644-649`, `src/lib/packing.ts:534-556`
- What the code does:
  - `resolvePOSBarcodeVariant` tries exact suffix/barcode/`parent-suffix`, then falls back to any variant of the parent SKU:
    ```ts
    const byParentSku = await pb.collection('product_variants').getList(1, 1, {
        filter: `product.sku="${safe}" && product.is_active=true${tenantFilter}`,
        expand: 'product',
        sort: 'sku_suffix',
    });
    return byParentSku.items[0] || null;
    ```
    (`products.ts:644-649`). It never returns "ambiguous".
  - `resolveScannedCode` then always returns `variantId` when a variant is found (`packing.ts:540-550`), so `matchResolvedToLine` takes the strict-variant branch and its product-level `ambiguous` branch (`packing.ts:231-238`) is unreachable from any real scan.
- Why it is wrong:
  - Labels print the parent SKU only (`labels/page.tsx:733-744` passes `product.sku`), so every tag for a multi-variant product is a product-level tag. Scanning it picks the alphabetically first suffix. For quick-add rings that is size 10 with 0 stock: POS/checkout then attempts to sell size 10, and packing reports `not_in_order` for a size-14 line ("This piece is not on this order"), even though the tag belongs to the order's product. Conversely, if the order line is the first-suffix variant, any physical size scans as that variant.
  - The UI's "scan the item tag with the variant suffix" error (`packing/page.tsx:352-357`) can never fire, because no scan resolves without a variant.
- Evidence: resolver and match trace; `test-packing.ts` tests `matchResolvedToLine({productId})` directly but never the resolver, so the gap is not covered.
- Minimal fix: when `resolvePOSBarcodeVariant` can only match the parent SKU and the product has more than one variant, return `null` (or a product-only match); let `resolveScannedCode` fall through to `productId` so packing shows the ambiguity instead of guessing.
- Confidence: confirmed

---

### S-09 [MEDIUM] Scanner "+ Add / - Remove" changes stock with no stock movement — `src/app/inventory/page.tsx:499`, `src/lib/products.ts:311-338`
- What the code does: `handleScanStockUpdate` calls `await updateStock(variant.id, change)` (`inventory/page.tsx:499`), and `updateStock` only writes `stock_level+` / `stock_level-`; it never creates a `stock_movements` row (`products.ts:311-338`).
- Why it is wrong: A normal inventory action (+1 receipt or −1 shrink) is invisible in the Stock Ledger modal and in movement-based analytics. A product with one such change has no record of where the extra/missing unit came from, so the next cycle-count variance cannot be explained. No PB hooks exist to backfill the row.
- Evidence: caller trace; grep shows `updateStock` has exactly this one production caller; no test asserts a movement for it.
- Minimal fix: write the movement inside `updateStock` (or at this call site) using `recordManualIntakeMovement` for adds and a negative `adjustment` for removals.
- Confidence: confirmed

---

### S-10 [MEDIUM] A chat-created product's initial stock has no ledger receipt — `src/lib/chat-inventory.ts:132-143`
- What the code does:
  ```ts
  const initialStock = Number(input.initialStock) || 0;
  if (initialStock > 0) {
      await pb.collection('product_variants').create({ ... stock_level: initialStock ... });
  }
  ```
  No `stock_movements` create follows.
- Why it is wrong: The WhatsApp Add Product form passes `initial_stock` (`src/app/whatsapp/page.tsx:3126`). The product starts with e.g. 5 units and an empty ledger; the Stock Ledger modal shows "No stock movement transactions recorded yet" while "Current Balance" says 5 (`ProductStockLedgerModal`), and movement-based turnover sees no opening receipt. Compare quick-product/excel-import, which both log a restock.
- Evidence: caller trace; no movement create in `chat-inventory.ts`; no test covers it.
- Minimal fix: create a `restock` movement with the new variant id before returning.
- Confidence: confirmed

---

### S-11 [MEDIUM] A defective-return quarantine movement is written with a positive quantity, inverting the ledger balance — `src/lib/returns.ts:558-566`, `src/lib/discrepancies.ts:138-146`, `src/lib/stock-ledger.ts:96-98`
- What the code does:
  - Return approval quarantines without touching sellable stock, but logs `quantity: item.quantity` (positive) for `movement_type: 'quarantine'` (`returns.ts:558-566`).
  - Every other quarantine writer is negative: `markStockDiscrepancy` logs `quantity: -input.quantity` for the units it deducted (`discrepancies.ts:141-142`).
  - `getProductStockLedger` sums every movement into the running balance: `runningBalance += qty` (`stock-ledger.ts:96-98`).
- Why it is wrong: Sale −1 (stock 10 → 9), defective return logs +1 quarantine, so the ledger balance returns to 10 while sellable stock is 9. If the discrepancy is later resolved as repaired, `stock_level+` 1 and a `restock` +1 movement are added → ledger 11, stock 10. The ledger's central column is off by the returned quantity on every defective/repair/write-off return, and the modal presents it as "Bal:" next to a different Current Balance.
- Evidence: writer comparison; `TYPE_CONFIG` treats quarantine as a normal movement; no test covers approveCreditNote ledger rows.
- Minimal fix: use `quantity: 0` for the return quarantine movement (the sale already removed the unit), matching the write-off adjustment convention in `discrepancies.ts:297-307`.
- Confidence: confirmed

---

### S-12 [MEDIUM] Flagging damage on a multi-variant product deducts the stockiest variant, not the piece in hand — `src/components/inventory/DiscrepancyModal.tsx:159-163`, `src/lib/products.ts:597-607`
- What the code does: The inventory card's "Flag Discrepancy" passes only `{id,name,sku,stock}` (no variant, `inventory/page.tsx:1539-1546`). The modal resolves the deduction target with:
  ```ts
  getVariantForProduct(preselectedProduct.id).then(applyVariant)
  ```
  and `getVariantForProduct` sorts by `-stock_level` (`products.ts:599-602`), i.e. the stockiest variant.
- Why it is wrong: A bangle product has 2.4 = 5 and 2.6 = 0; the physically damaged piece is 2.6, but the flag deducts 2.4. The 2.6 stock remains sellable-on-paper and the 2.4 stock is understated; neither matches the tray. The modal never shows which variant it will deduct, and the quantity check uses that variant's stock.
- Evidence: caller trace and modal preset logic; no variant selector exists in the flag form.
- Minimal fix: resolve/require the exact variant (scan the tag or select the variant) before allowing the deduction; do not fall back to the stockiest variant.
- Confidence: confirmed

---

### S-13 [MEDIUM] Credit-note approval's "claim" is not atomic; two concurrent approvals both restock — `src/lib/returns.ts:467-481`
- What the code does:
  ```ts
  if (cn.status === 'approved' || cn.status === 'refunded' || cn.status === 'exchanged') return;
  ...
  await pb.collection('credit_notes').update(id, { status: 'approved' });
  ```
  The status is read, then written unconditionally; PocketBase has no compare-and-set here and the collection's update rule does not require `status = "pending"` (the comment in the code says the rule serializes only the full-resolve discrepancy case, not this one).
- Why it is wrong: Two terminals (or a double-submitted approval) both read `pending`, both write `approved`, and both execute the restock/quarantine loop. A one-line CN ends with `+2` units restocked and two `return` movements. The code comment claims the claim "shrinks the race window", but it does not close it.
- Evidence: read-then-write trace; no conditional update or transaction; `test-enhancements.ts` is single-threaded and does not test concurrency.
- Minimal fix: make the status write conditional (PB update rule `status = "pending"`, or re-read `updated`/status immediately after the write and abort if another writer's claim won).
- Confidence: likely (needs two concurrent requests)

---

### S-14 [MEDIUM] Tray-audit adjustments are applied before the audit row; a late failure returns `success:false` and a retry applies them again — `src/lib/cycle-count.ts:169-271`
- What the code does: Missing quarantines and surplus increments run first (169-217), then the `inventory_audits` row is created (235-254). If that create throws, the outer catch returns `{success:false}` (263-271) without undoing the stock changes; `inventory_audits.account_email` is `required` (`pb_migrations/1793002000_inventory_packing_v2.js:82`), so an empty/tenant-rule rejection is enough to trigger it.
- Why it is wrong: A tray audit that adjusted `+2` surplus then failed to write its audit row leaves the stock adjusted and tells the operator it failed. The user retries the same audit (the modal stays open) and the `+2` is applied again — duplicate stock with no audit trail tying either adjustment to a completed record.
- Evidence: ordering in `commitTrayAudit`; no rollback and no idempotency key; `test-cycle-count.ts` only tests the pure diff.
- Minimal fix: create the audit row first (in_progress) and update it to completed after the adjustments, or compensate the applied adjustments in the catch.
- Confidence: likely (needs a failing audit write)

---

### S-15 [LOW] The label print queue is consumed on mount, before anything is printed — `src/lib/label-queue.ts:78-84`, `src/app/labels/page.tsx:437`
- What the code does: `consumeLabelQueue()` reads the tenant localStorage key and immediately removes it, returning the items; `/labels` calls it in its mount effect and keeps them only in React state.
- Why it is wrong: The handover is destructive before the print job exists. Reloading or closing `/labels` before pressing Print (or a crash during the effect) permanently loses every queued label; there is no copy in PocketBase (`label_print_queue` exists but is not used by this path) and no toast/undo. The doc comment calls it an "atomic handover", but a read-then-remove localStorage pair is neither atomic nor recoverable.
- Evidence: queue module and labels mount effect; no test covers the queue.
- Minimal fix: peek on mount and only remove the consumed SKUs after `window.print()` succeeds (or keep a `printed` snapshot until the user confirms).
- Confidence: confirmed

---

## Checked and clean

Files fully read and found to contain no real defect in this cluster (stock-quantity integrity):

- `src/lib/returns-policy.ts` — quantity policy is correct (cumulative cap, whole numbers, positive ordered/prior). Covered by `test-returns-policy.ts`.
- `src/lib/returns-qc-engine.ts` — routing/deduction maths is pure and consistent with its interface (financial, not stock mutation). Covered by `test-returns-qc.ts`.
- `src/lib/replenishment.ts` — grouping/formatting and pending-PO math are read-only; no stock writes. Covered by `test-bundles-replenishment.ts` for grouping/formatting.
- `src/lib/inventory-feed.ts` — subscription wiring only; no stock writes.
- `src/lib/omnichannel-buffer-engine.ts` — allocation math and process-local reservations are documented limitations, not silent stock mutations; no write path. Covered by `test-sprint3-features.ts` / `test-vasy-omnichannel-engines.ts`.
- `src/lib/attributes.ts` — CRUD only, tenant-scoped.
- `src/lib/categories.ts` — CRUD only, tenant-scoped.
- `src/lib/tray-locations.ts` — read/label helpers only.
- `src/lib/barcode-generator.ts` — URL/HTML helpers and SKU parsing; no stock writes. (`parseSKUFromBarcode` is not covered by tests.)
- `src/lib/quick-product.ts` — draft creation and per-variant initial stock both log `restock` movements correctly.
- `src/components/inventory/ProductForm.tsx` — presentational, no persistence.
- `src/components/inventory/QuickReceivePOModal.tsx` — read-only PO list.
- `src/components/inventory/BulkInventoryImportModal.tsx` — delegates to `excel-import.ts`, which logs a `restock` movement per imported variant.
- `src/components/inventory/MidPackDamageModal.tsx` — delegates to `handleMidPackDamage`; the spare/shortage accounting is consistent with the order already having deducted its own units.
- `src/components/common/QuickBarcodeScanModal.tsx` — resolution payload only.
- `src/app/returns/page.tsx`, `src/app/returns/create/page.tsx` — list/form only; creation is delegated to the validated `createReturnFromInvoice`.
- `src/components/inventory/BundleComposerSection.tsx` — composer input handling; its availability display uses the aggregate stock supplied by the caller (reported as part of S-01's stock source, not a separate stock mutation).

Behaviour already covered by tests (so omitted from findings):

- Packing line building, strict variant matching, over-scan guard, completion gating, queue derivation, slip exact match, bundle explosion, wave pick — `test-packing.ts`.
- Tray diff buckets and totals — `test-cycle-count.ts` (pure diff only; IO commit is untested).
- Bundle availability/explode and replenishment vendor grouping/WhatsApp text — `test-bundles-replenishment.ts`.
- Channel-stock resolve/apply/rollback/restore idempotency, clamp and tenant gates on single variants — `test-channel-stock.ts` (no bundle-component or duplicate-target case).
- Return quantity caps — `test-returns-policy.ts`; QC routing/deduction amounts — `test-returns-qc.ts`.

No logic suite covers: `approveCreditNote`/`processExchange` inventory effects (only the DB-dependent `test-enhancements.ts` happy path), bundle returns, order-cancel vs return interaction, multi-location transfers, cycle-count commit, discrepancy IO, stock-ledger sign, label queue, or the inventory page's stock edit/scan paths.
