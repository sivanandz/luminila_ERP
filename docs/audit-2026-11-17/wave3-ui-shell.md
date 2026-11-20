# Wave 3 — Shared client shell audit (components / hooks / contexts / data)

Date: 2026-11-17
Scope: `src/components/**`, `src/hooks/**`, `src/contexts/**`, `src/data/**` (repo `data/` is empty).
Method: full reads of every file in scope; callers and lib helpers traced with `findstr`; every claim below is derivable from the quoted lines. No app code was edited. Findings are ordered by severity.

Severity counts: **CRITICAL 0 · HIGH 6 · MEDIUM 8 · LOW 3**

---

### U-01 [HIGH] Quick-add creates the same product twice when Enter is pressed while a save is in flight — `src/components/inventory/QuickAddProductDialog.tsx:561`

- What the code does:
  ```ts
  463  const save = async (addAnother: boolean) => {
  464      if (!pieceName) { ... }
  468      if (effectiveSelling <= 0) { ... }
  473      setSaving(true);
  ...
  561  const saveRef = useRef(save);
  ...
  566  useEffect(() => {
  568      const handleKeyDown = (event: KeyboardEvent) => {
  574          const isTextInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  576          if (!isTextInput || inPopover) return;
  577          event.preventDefault();
  578          void saveRef.current(!(event.ctrlKey || event.metaKey));
  ```
  `save()` never checks `saving`. The buttons are disabled via `canSave` (`457: !saving`), but the window-level Enter handler calls `saveRef.current` unconditionally.
- Why wrong: Expected one draft per Enter. Actual: key auto-repeat (or Enter + a click in the same window) starts a second `save()` before the first request resolves. Both calls use the same fields and the same `finalSkuPreview`/`nextSku(category, existingSkus)` — `existingSkus` is a stale prop and the series sequence is only recomputed after success (`540 setSeqTick`). `createDraftProduct` neither de-duplicates nor derives a fresh SKU (`src/lib/quick-product.ts:205`), and the initial PB schema has no unique index on `products.sku` (`pocketbase/pb_migrations/1700000000_initial_schema.js`), so both products and their variants persist with the same SKU. `createDraftProduct` also writes initial stock movements per variant (`quick-product.ts:232-247`), so on-hand stock doubles.
- Evidence: keyboard path `QuickAddProductDialog.tsx:566-582` → `save()` (no guard) → `createDraftProduct` (`quick-product.ts:192-256`); button path does check `!saving` (`1374`, `1383`), proving the keyboard path is the only unguarded entry.
- Minimal fix: add `if (saving) return;` as the first statement of `save`, or guard in the key handler (`if (savingRef.current) return;`).
- Confidence: confirmed

### U-02 [HIGH] PhonePe retry never polls the new payment — `src/components/pos/PhonePePayment.tsx:61`

- What the code does:
  ```ts
  61   if (status !== 'pending' || !transactionId || completedRef.current) return;
  ...
  77   } else if (data.code === 'PAYMENT_ERROR' || data.code === 'PAYMENT_DECLINED') {
  78       completedRef.current = true;
  79       setStatus('failed');
  ...
  88   // Stop polling after 2 minutes (40 polls at 3s interval)
  89   if (pollCountRef.current >= 40) {
  90       completedRef.current = true;
  ...
  141  const handleRetry = () => {
  142      setStatus('input');
  143      setError(null);
  144      setTransactionId(null);
  145      setPollCount(0);
  146  };
  ```
  `completedRef` is reset only when the modal opens (`49`).
- Why wrong: Expected a retried payment to be verified like the first attempt. Actual: after any failure/timeout `completedRef.current` stays `true`; the retry starts a new transaction (`126 setTransactionId`, `127 setStatus('pending')`) but the polling effect immediately returns at line 61 and never starts an interval. The UI stays on “Complete payment in PhonePe” forever and `onSuccess` is never called. The customer can pay the second link while the POS sale is never marked paid.
- Evidence: state trace `handleRetry` (141-146) → `handleInitiatePayment` success (125-127) → effect re-runs with `completedRef.current === true` → returns at 61; only the `isOpen` reset (40-55) clears it.
- Minimal fix: `completedRef.current = false;` (and `pollCountRef.current = 0`) inside `handleRetry`, or in `handleInitiatePayment` before `setStatus('pending')`.
- Confidence: confirmed

### U-03 [HIGH] “Accept & Receive Stock” has no in-flight guard and double-credits destination inventory — `src/components/inventory/StockTransferModal.tsx:205`

- What the code does:
  ```ts
  205  const handleReceive = async (trfId: string) => {
  206      try {
  207          await receiveStockTransfer(trfId);
  208          toast.success("Stock received and verified into destination inventory!");
  209          await loadData();
  ...
  490  onClick={() => handleReceive(trf.id)}
  ```
  There is no `submitting`/`receiving` state, no `disabled` on the row button, and no confirmation.
- Why wrong: Expected a transfer to be credited exactly once. `receiveStockTransfer` reads the transfer, checks `status === "received"`, then writes `status: "received"` and afterwards loops `adjustLocationStock(..., +receivedQty)` (`src/lib/multi-location.ts:625-690`). Two clicks dispatched before the first status write lands both read `dispatched` and both add the full quantity at the destination — duplicate stock, and the source was debited once. The action is also immediately irreversible (no confirm dialog).
- Evidence: `StockTransferModal.tsx:490` has no guard; `multi-location.ts:629-643` (read/check) and `662-690` (status write, then additive stock) run per invocation.
- Minimal fix: add a `receivingId` state; `if (receivingId) return;` at the top of `handleReceive`, set it before the await, clear it in `finally`, and `disabled={!!receivingId}` on the button.
- Confidence: likely (double credit is timing-dependent but the guard is provably absent)

### U-04 [HIGH] Quarantining stock from a scanned product can deduct a different product's variant — `src/components/inventory/DiscrepancyModal.tsx:93`

- What the code does:
  ```ts
  88   const handleScannedItem = (payload: ScannedItemPayload) => {
  89       if (payload.product) {
  90           setSku(payload.product.sku);
  91           setProductName(payload.product.name);
  92           setProductId(payload.product.id);
  93           if (payload.variant?.id) {
  94               setVariantId(payload.variant.id);
  95           }
  96           setCurrentAvailableStock(payload.product.stock ?? 0);
  ```
  `variantId` is only overwritten when the scan resolves a variant; it is never cleared.
- Why wrong: `QuickBarcodeScanModal` resolves the product first by `products.sku` or `products.barcode`; when that matches, `variantRecord` is `undefined` (payload.variant absent) — see `QuickBarcodeScanModal.tsx:118-156` and `src/lib/products.ts` `findProductBySkuOrBarcode`. Scanning a product SKU is the normal path (labels encode SKUs), so after any earlier scan/preselection the previous `variantId` survives. `handleFlagSubmit` then calls `markStockDiscrepancy({ product_id: productId, variant_id: variantId, ... })` (211-221) and `markStockDiscrepancy` deducts `stock_level-` from `input.variant_id` only (`src/lib/discrepancies.ts:80-131`), while recording `product: input.product_id`. Scenario: open the modal for product A, scan product B by SKU, flag 1 damaged → product A's variant loses a unit and a quarantine record claims product B. If A's variant has less stock than requested the user gets a confusing “Only N units available” error instead.
- Evidence: `DiscrepancyModal.tsx:93-95` (conditional assignment) → `204-206` (only checks non-empty) → `discrepancies.ts:115` (deducts `input.variant_id`).
- Minimal fix: in `handleScannedItem`, always assign: `setVariantId(payload.variant?.id || "");` (and keep the `!variantId` submit guard).
- Confidence: confirmed

### U-05 [HIGH] Product broadcast auto-selects every channel/community and sends with one unguarded click; the sibling composer requires a permission — `src/components/whatsapp/ProductBroadcastModal.tsx:134`

- What the code does:
  ```ts
  134  // Auto-select all channels & communities by default if any exist
  135  if (channels.length > 0) {
  136      setSelectedChannels(channels.map((c) => c.id));
  137  }
  138  if (communities.length > 0) {
  139      setSelectedCommunities(communities.map((c) => c.id));
  140  }
  ...
  245  const handleBroadcast = async () => {
  ...
  263      setBroadcasting(true);
  ```
  and the footer button:
  ```ts
  816  disabled={broadcasting || selectedProducts.length === 0}
  ```
  There is no `window.confirm`, no permission check (`ProductBroadcastModal` does not import `usePermissions`), and `sendToStatus` defaults to `true` (`83`).
- Why wrong: Expected that a customer-facing, unrecoverable mass message is deliberate and authorized. Actual: opening the modal from the inventory bulk bar pre-targets every detected channel + every community announcement + WhatsApp Status; one click delivers to all of them. The other WhatsApp broadcast surface in this cluster explicitly does the opposite: `BroadcastComposerModal.tsx:95` gates on `isAdmin || hasPermission("customers","update")` and `150-154` notes “do not pre-select destinations — one click must not message every community and channel.” Sibling path skips both protection layers.
- Evidence: caller `src/app/inventory/page.tsx:2497-2510` opens this modal from `InventoryBulkActionBar`; the component has no permission gate; `broadcastProductsToDestinations` is called directly at 266.
- Minimal fix: do not pre-select on load (start empty like the composer), require `window.confirm` before `setBroadcasting(true)`, and gate on `isAdmin || hasPermission("customers","update")` as the composer does.
- Confidence: confirmed

### U-06 [HIGH] A price ≥ ₹1,00,000 that is a multiple of 1,000 is displayed and adopted as 1/1000 of its value — `src/components/whatsapp/WhatsAppCatalogEditorModal.tsx:90`

- What the code does:
  ```ts
  85  function normalizePrice(val: unknown): number {
  ...
  90      if (num >= 100000 && num % 1000 === 0) {
  91          return num / 1000;
  92      }
  93      return num;
  ```
  This value becomes the catalog price shown in the list/inspector (`item.price`) and is written into inventory by “Adopt Catalog Prices” → `setWhatsAppCatalogPrice(item.linkedProduct.id, item.price)` (`227`) and by the `syncInventoryPriceToPB` path (`400`).
- Why wrong: the heuristic has no unit marker and a hard discontinuity. A ₹1,50,000 piece (150000) renders as ₹150, while a ₹1,50,001 piece renders as ₹1,50,001 — a 1000× difference for a one-rupee change. Adopting catalog prices would then overwrite the linked product's WhatsApp price with ₹150/₹100. Even under the documented micro-unit assumption, `150000` (₹1,500 in paise) is misread as ₹150.
- Evidence: `normalizePrice` used for `waPrice` at `284`; mismatch calculation at `302`; adopt path at `212-245` and `399-401`.
- Minimal fix: convert only when the source field is known to be minor units (use the API/`currency` metadata or a configured scale), never by numeric magnitude; otherwise treat the value as rupees.
- Confidence: likely (the discontinuity is certain; the intended unit needs one runtime catalog sample)

---

### U-07 [MEDIUM] “Also update PocketBase price” sticks to the next selected catalog item — `src/components/whatsapp/WhatsAppCatalogEditorModal.tsx:125`

- What the code does: `const [syncInventoryPriceToPB, setSyncInventoryPriceToPB] = useState(false);` (125). The selection-change effect resets `editForm` and `linkingProductId` but not this checkbox (333-344):
  ```ts
  333  useEffect(() => {
  334      if (selectedItem) {
  335          setEditForm({ ... });
  342          setLinkingProductId(selectedItem.linkedProduct?.id || "");
  343      }
  344  }, [selectedItem]);
  ...
  399      if (syncInventoryPriceToPB && selectedItem.linkedProduct) {
  400          await setWhatsAppCatalogPrice(selectedItem.linkedProduct.id, Number(editForm.price));
  ```
- Why wrong: check the box for item A, switch to item B to edit only its title, press Save → item B's inventory WhatsApp price is overwritten with B's catalog price without the user asking. Silent cross-product price write.
- Evidence: state persists because `selectedItem` change only resets `editForm`/`linkingProductId`; the write at 399 has no per-item association.
- Minimal fix: `setSyncInventoryPriceToPB(false);` inside the `selectedItem` effect.
- Confidence: confirmed

### U-08 [MEDIUM] WhatsApp “shipped” message is sent before the shipment/status guard can reject the dispatch — `src/components/orders/BarcodeScanDispatchModal.tsx:262`

- What the code does:
  ```ts
  262  // 1. Dispatch VIP WhatsApp notification with live link
  263  const waRes = await dispatchOrderMilestoneWhatsApp({ ... milestone: "shipped" ... });
  275  // 2. Register the shipment and move the order to shipped through
  276  // the canonical path, which enforces the paid/COD and status guards
  278  const shipment = await createShipmentForOrder(pb, getCurrentTenantEmail(), { ... });
  ...
  285  if (!shipment.success) {
  286      throw new Error(shipment.error || "Could not create the shipment.");
  ```
- Why wrong: expected notify-after-state-change. If `createShipmentForOrder` rejects (unpaid order, wrong status — exactly the guards the comment cites), the customer has already received “your order is shipped, track here”, the order is not shipped, and the operator sees only “Dispatch failed”. The rapid-manifest panel does it in the correct order (`RapidManifestPanel.tsx:110-135`: shipment first, WhatsApp after).
- Evidence: sequential awaits above; the catch only toasts (`308-310`).
- Minimal fix: move the `dispatchOrderMilestoneWhatsApp` call after `if (!shipment.success) throw ...`.
- Confidence: confirmed

### U-09 [MEDIUM] Failed quarantine fetch renders “All Clear — No Active Discrepancies” — `src/components/inventory/DiscrepancyModal.tsx:175`

- What the code does:
  ```ts
  170  const loadDiscrepancies = async () => {
  ...
  173          const list = await getStockDiscrepancies("active");
  174          setDiscrepancies(list);
  175      } catch (err) {
  176          console.error("Failed to load discrepancies:", err);
  ...
  568  <p ...>All Clear • No Active Discrepancies</p>
  570  No items currently damaged, missing, or awaiting vendor replacement.
  ```
  `getStockDiscrepancies` itself also swallows errors and returns `[]` (`src/lib/discrepancies.ts:356-359`).
- Why wrong: expected an error state. Actual: any tenant/network/server failure shows the green “All Clear” panel, telling staff there is no quarantine ledger when the list simply failed to load. In an inventory-control screen this can hide damaged/missing stock from the person who must act on it.
- Evidence: error path leaves `discrepancies` at `[]` (initial state 60) and `loadingList` false; the render at 565-572 keys off `filteredDiscrepancies.length === 0`.
- Minimal fix: keep a `loadError` state and render “Could not load quarantine ledger — retry” instead of the all-clear block.
- Confidence: confirmed

### U-10 [MEDIUM] A partially failed bulk percentage price change keeps the modal open, so a retry compounds the percentage on updated rows — `src/components/inventory/InventoryBulkActionBar.tsx:139`

- What the code does:
  ```ts
  102  async function batchProcess<T>(items: T[], batchSize: number, fn: (item: T) => Promise<unknown>) {
  104      for (let i = 0; i < items.length; i += batchSize) {
  105          const chunk = items.slice(i, i + batchSize);
  106          await Promise.all(chunk.map(fn));       // throws on first rejected chunk
  ...
  139  await batchProcess(selectedProducts, 15, (p) => {
  140      let nextPrice = p.price;
  141      if (!isNaN(pct)) { nextPrice = Math.round(nextPrice * (1 + pct / 100)); }
  145      nextPrice = Math.max(0, nextPrice + fixed);
  147      return pb.collection("products").update(p.id, { base_price: nextPrice });
  150  toast.success(...); setPriceAdjustModalOpen(false); ...   // success only
  157  toast.error("Failed to adjust prices.");                  // modal stays open
  ```
- Why wrong: expected an all-or-nothing adjustment or a per-item report. Chunks already committed are not rolled back and the table is not refreshed on failure (no `onRefresh` in the catch). If the operator presses “Apply” again, the already-updated products get the same percentage applied a second time (e.g. +10% twice = +21%), silently changing prices beyond the requested adjustment.
- Evidence: `batchProcess` has no compensation and stops at the first failing chunk; success-only close at 152; retry button at 382.
- Minimal fix: on failure, `await onRefresh()` and report which rows were skipped, or make the adjustment idempotent by computing from the values captured before the first attempt.
- Confidence: confirmed

### U-11 [MEDIUM] Bulk “Move to Draft” unpublishes every selected product with a single unconfirmed click — `src/components/inventory/InventoryBulkActionBar.tsx:268`

- What the code does:
  ```ts
  164  const handleToggleActive = async (setActive: boolean) => {
  167      await batchProcess(selectedIds, 15, (id) =>
  168          pb.collection("products").update(id, { is_active: setActive })
  ...
  268  onClick={() => void handleToggleActive(false)}
  271  <EyeOff size={12} className="mr-1.5" /> Move to Draft
  ```
- Why wrong: expected a confirm for a destructive bulk action. A single menu click hides every selected product from the storefront/catalog; there is no confirmation, no undo, and on partial failure the error toast does not say which products were hidden. (Publish All is equally unguarded but harmless.)
- Evidence: dropdown item at 267-272 calls the handler directly; only the trigger is `disabled={busy}` (254-256), not the items.
- Minimal fix: wrap `handleToggleActive(false)` in `window.confirm(\`Move ${selectedIds.length} products to draft?\`)`.
- Confidence: confirmed

### U-12 [MEDIUM] PhonePe timeout leaves an unclosable “pending” modal with no retry — `src/components/pos/PhonePePayment.tsx:89`

- What the code does:
  ```ts
  88   // Stop polling after 2 minutes (40 polls at 3s interval)
  89   if (pollCountRef.current >= 40) {
  90       completedRef.current = true;
  91       clearInterval(pollInterval);
  92       setError('Payment verification timed out. Please check your payment status manually.');
  93   }
  ...
  164  {status === 'input' && (
  165      <button onClick={onClose} ...>      // only close control in the modal
  ```
- Why wrong: the timeout sets `error` but leaves `status === 'pending'`; the render for that status (228-249) has no close, retry, or “Check status” control, so after two minutes the cashier is stuck on a spinner. If the customer completes the payment after the last poll, `onSuccess` never fires and the sale is not recorded.
- Evidence: status never leaves `'pending'` in the timeout branch; the failed-stage Cancel/Retry (268-291) is unreachable.
- Minimal fix: on timeout set `setStatus('failed')` (which renders Try Again / Cancel) or add a Close button to the pending stage.
- Confidence: confirmed

### U-13 [MEDIUM] Draft PO order date is the UTC date — `src/components/inventory/SmartReplenishmentModal.tsx:77`

- What the code does:
  ```ts
  77  const todayStr = new Date().toISOString().split("T")[0];
  ...
  97  const created = await createPurchaseOrder({ ... order_date: todayStr, ... });
  ```
- Why wrong: `toISOString()` is UTC. Between 00:00 and 05:30 IST (the store's business hours for early dispatch) the PO is persisted with yesterday's `order_date`, so the purchase document date disagrees with the local business day and with other documents created from local dates.
- Evidence: value flows straight into `createPurchaseOrder` (97-108).
- Minimal fix: build the local date (`const d = new Date(); const todayStr = \`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}\`;`).
- Confidence: confirmed

### U-14 [MEDIUM] Changing the courier to DTDC/Other keeps the previous carrier's tracking URL in the WhatsApp message — `src/components/orders/OrderMilestoneBar.tsx:232`

- What the code does:
  ```ts
  52  const handleTrackingNumberChange = (val: string) => {
  56      if (/^\d{11}$/.test(clean)) { setCourierName("ST Courier"); setTrackingUrl("/tracking/st-courier?awb="); }
  ...
  232  <select value={courierName} onChange={(e) => {
  234      const c = e.target.value;
  235      setCourierName(c);
  237      if (c === "ST Courier") { setTrackingUrl("/tracking/st-courier?awb="); }
  239      } else if (c === "Delhivery Express") { ... }
  241      } else if (c === "Shiprocket") { ... }
  243      } else if (c === "Blue Dart") { ... }
  246  }}>
  253  <option value="DTDC Express">DTDC Express</option>
  254  <option value="Other Courier">Other Courier</option>
  ```
- Why wrong: pick an 11-digit AWB (auto-detects ST Courier), then switch the dropdown to DTDC or Other: `trackingUrl` remains the ST Courier route, and the shipped message builds `${trackingUrl}${trackingNumber}` (102-106), sending the customer an ST Courier tracking page for a DTDC parcel. The scan modal has a DTDC URL (`BarcodeScanDispatchModal.tsx:257-259`), so this panel's omission is the outlier.
- Evidence: no `else` branch after 243; initial `trackingUrl` is the ST route (46).
- Minimal fix: add the DTDC branch (`https://www.dtdc.in/tracking/shipment-tracking.asp?awb=`) and clear `trackingUrl` for “Other Courier”.
- Confidence: confirmed

### U-15 [LOW] Printed 4×6 label falls back to a UTC date — `src/components/shipping/ShippingLabelPrintModal.tsx:300`

- What the code does:
  ```ts
  300  <div>Date: <strong>{labelData.orderDate || new Date().toISOString().slice(0, 10)}</strong></div>
  ```
- Why wrong: when `orderDate` is absent, the printed label carries the UTC day, i.e. the previous day for prints made before 05:30 IST. The label is a physical courier document whose date is read against the local dispatch day.
- Evidence: single fallback expression; no local-time formatting elsewhere in the label.
- Minimal fix: fall back to `new Date().toLocaleDateString("en-CA")` (or explicit local Y-M-D) instead of the ISO slice.
- Confidence: confirmed

### U-16 [LOW] Stock-ledger fetch failure is shown as “no movements” — `src/components/inventory/ProductStockLedgerModal.tsx:45`

- What the code does:
  ```ts
  45  const data = await getProductStockLedger(product!.id);
  46  if (!cancelled) setEntries(data);
  47  } catch (err) {
  48      console.error("Failed to load ledger:", err);
  49  } finally { ... }
  ...
  89  ) : entries.length === 0 ? (
  91  <div ...>No stock movement transactions recorded yet for this piece.</div>
  ```
- Why wrong: a failed read (network/tenant/permission) is rendered as an authoritative statement that the piece has no ledger history.
- Evidence: error path leaves `entries` at `[]`; empty state keys off `entries.length`.
- Minimal fix: store an `error` flag and render “Could not load ledger” with a retry.
- Confidence: confirmed

### U-17 [LOW] Customer search failure leaves “Searching...” forever — `src/components/customer/CustomerPicker.tsx:41`

- What the code does:
  ```ts
  34  const handleSearch = async () => {
  ...
  41      setLoading(true);
  42      const data = await searchCustomers(query, 8);   // no try/catch
  43      setResults(data);
  44      setLoading(false);
  45  };
  ```
- Why wrong: if `searchCustomers` rejects (offline/server error), the rejection is unhandled and `loading` stays true, so the dropdown shows “Searching...” indefinitely and the operator cannot pick a customer or see an error.
- Evidence: only the debounce is cleaned up (47-48); no `finally`.
- Minimal fix: wrap in `try { ... } catch { setResults([]); } finally { setLoading(false); }`.
- Confidence: confirmed

---

## Checked and clean

Files read in full during this audit. Files with a finding are annotated with its id; every other file is clean:

- `src/components/ErrorBoundary.tsx`
- `src/components/auth/AuthGate.tsx`
- `src/components/auth/ProtectedRoute.tsx`
- `src/components/layout/AppChrome.tsx`
- `src/components/layout/Header.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/MobileDrawer.tsx`
- `src/components/layout/MobileBottomNav.tsx`
- `src/components/layout/index.ts`
- `src/components/pos/BarcodeScanner.tsx`
- `src/components/pos/Cart.tsx`
- `src/components/pos/PhonePePayment.tsx` (defects U-02, U-12)
- `src/components/pos/POSWhatsAppWidget.tsx`
- `src/components/pos/Receipt.tsx`
- `src/components/pos/index.ts`
- `src/components/inventory/ProductForm.tsx`
- `src/components/inventory/ProductPhotoTaggingModal.tsx`
- `src/components/inventory/QuickAddProductDialog.tsx` (defect U-01)
- `src/components/inventory/BulkInventoryImportModal.tsx`
- `src/components/inventory/BundleComposerSection.tsx`
- `src/components/inventory/DiscrepancyModal.tsx` (defects U-04, U-09)
- `src/components/inventory/InventoryBulkActionBar.tsx` (defects U-10, U-11)
- `src/components/inventory/PasteProductsDialog.tsx`
- `src/components/inventory/ProductPurchaseHistoryModal.tsx`
- `src/components/inventory/ProductStockLedgerModal.tsx` (defect U-16)
- `src/components/inventory/QuickProductModal.tsx`
- `src/components/inventory/QuickReceivePOModal.tsx`
- `src/components/inventory/SmartReplenishmentModal.tsx` (defect U-13)
- `src/components/inventory/StockTransferModal.tsx` (defect U-03)
- `src/components/inventory/TrayCycleCountModal.tsx`
- `src/components/inventory/index.ts`
- `src/components/ui/alert-dialog.tsx`
- `src/components/ui/avatar.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/checkbox.tsx`
- `src/components/ui/combobox.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/dock-inset.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/field.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/input-group.tsx`
- `src/components/ui/label.tsx`
- `src/components/ui/marquee-text.tsx`
- `src/components/ui/scroll-area.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/switch.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/ui/textarea.tsx`
- `src/components/common/QuickBarcodeScanModal.tsx`
- `src/components/invoice/InvoicePrint.tsx`
- `src/components/invoices/InvoiceTemplateRenderer.tsx`
- `src/components/vendor/VendorForm.tsx`
- `src/components/settings/AiProvidersSettings.tsx`
- `src/components/settings/EwayBillSettings.tsx`
- `src/components/settings/LogoUpload.tsx`
- `src/components/settings/SKUTaxonomySettings.tsx`
- `src/components/settings/SalesChannelsSettings.tsx`
- `src/components/settings/ServerConfigModal.tsx`
- `src/components/dashboard/ChannelBreakdown.tsx`
- `src/components/dashboard/KPICards.tsx`
- `src/components/dashboard/RecentActivity.tsx`
- `src/components/dashboard/SalesChart.tsx`
- `src/components/dashboard/TopProducts.tsx`
- `src/components/customer/CustomerPicker.tsx` (defect U-17)
- `src/components/whatsapp/AdminApprovalModal.tsx`
- `src/components/whatsapp/BroadcastComposerModal.tsx`
- `src/components/whatsapp/ChatContextMenu.tsx`
- `src/components/whatsapp/FlashDropModal.tsx`
- `src/components/whatsapp/GroupInfoModal.tsx`
- `src/components/whatsapp/MessageActionMenu.tsx`
- `src/components/whatsapp/ProductBroadcastModal.tsx` (defect U-05)
- `src/components/whatsapp/RazorpayPaymentModal.tsx`
- `src/components/whatsapp/SlashCommandPalette.tsx`
- `src/components/whatsapp/VendorIngestionModal.tsx`
- `src/components/whatsapp/WhatsAppCatalogSyncModal.tsx`
- `src/components/whatsapp/WhatsAppCatalogEditorModal.tsx` (defects U-06, U-07)
- `src/components/whatsapp/WhatsAppDrawer.tsx`
- `src/components/whatsapp/WhatsAppEventSyncProvider.tsx`
- `src/components/analytics/InsightsTab.tsx`
- `src/components/analytics/CategoriesTab.tsx`
- `src/components/analytics/InventoryTab.tsx`
- `src/components/analytics/ProfitabilityTab.tsx`
- `src/components/analytics/SalesTab.tsx`
- `src/components/analytics/shared.tsx`
- `src/components/assistant/ApprovalCard.tsx`
- `src/components/assistant/ChatMessage.tsx`
- `src/components/assistant/Markdown.tsx`
- `src/components/assistant/ToolActivity.tsx`
- `src/components/orders/BarcodeScanDispatchModal.tsx` (defect U-08)
- `src/components/orders/OrderMilestoneBar.tsx` (defect U-14)
- `src/components/packing/PackingSlip.tsx`
- `src/components/packing/WavePickListModal.tsx`
- `src/components/packing/MidPackDamageModal.tsx`
- `src/components/packing/RapidManifestPanel.tsx`
- `src/components/pricing/ChannelPricingInput.tsx`
- `src/components/pricing/PricingRulesBootstrap.tsx`
- `src/components/shipping/ShippingLabelPrintModal.tsx` (defect U-15)
- `src/components/storefront-control/NiththigalEditor.tsx`
- `src/components/system/OfflineSync.tsx`
- `src/hooks/use-ai-chat.ts`
- `src/hooks/use-inventory-shortcuts.ts`
- `src/hooks/use-long-press.ts`
- `src/hooks/use-pos-shortcuts.ts`
- `src/hooks/use-viewport.ts`
- `src/hooks/usePermissions.ts`
- `src/contexts/AuthContext.tsx`
- `src/data/.gitkeep` (empty)
