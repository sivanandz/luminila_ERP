# App Code Logic Audit Report (ULTRATHINK)

Date: 2026-03-07
Repository: `E:\Local_GIT_2\luminila_inv_mgmt`
Scope: Full application logic audit (Next.js + PocketBase service layer)
Mode: Deep planning / orchestration

## Executive Summary

The codebase has multiple high-severity logic integrity defects concentrated in transactional workflows (POS, invoicing, returns, purchase receiving, banking, and document numbering). The dominant failure pattern is non-atomic multi-step writes with no compensation, plus schema/flow drift in several modules.

## Methodology (Deep Planning)

1. Architecture mapping
- Enumerated domain services (`src/lib/*`) and critical app flows (`src/app/*`).
- Identified write-critical domains: sales, invoicing, returns, purchase/GRN, register, banking, challans, auth/RBAC.

2. Signal collection
- Ran static lint sweep to surface suspicious state/data-flow hotspots.
- Performed manual cross-file trace of create/update pathways and status transitions.

3. Invariant checks
- Money invariants: totals, balances, sequence uniqueness, payment progression.
- Inventory invariants: stock movement parity, over/underflow protections.
- Workflow invariants: valid state transitions and referential consistency.
- Schema contract invariants: field-name alignment across creation/read/filter paths.

4. Validation pass
- Confirmed findings with direct line-level evidence.
- Removed low-confidence stylistic-only issues from report.

## Findings (Prioritized)

### 1) [P1] Opening balance is double-counted in shift reconciliation

Impact:
- Every shift’s expected cash balance is overstated by `opening_balance`, causing systematic variance errors during close.

Evidence:
- Shift starts with `opening_balance` and `cash_added: 0`: `src/lib/register.ts:89`, `src/lib/register.ts:98`.
- Immediately records opening balance via `addCashToDrawer(...)`, which increments `cash_added`: `src/lib/register.ts:103`, `src/lib/register.ts:254`.
- Reconciliation formula adds both `opening_balance` and `cash_added`: `src/lib/register.ts:170-174`.

Why this is a logic bug:
- Opening float should be represented once in expected balance.

Recommended fix:
- Do not call `addCashToDrawer` for opening float, or exclude opening-float operation from `cash_added` totals.
- Add reconciliation tests for open->close with no sales.

---

### 2) [P1] POS sale flow is non-atomic and can leave partial persisted state

Impact:
- If late-stage steps fail (e.g., invoice creation), sale + items + stock movement may already be committed while API throws error, inviting retries and duplicate financial/inventory effects.

Evidence:
- Sale persisted first: `src/lib/pos-sales.ts:68-84`.
- Sale items and stock movements persisted next: `src/lib/pos-sales.ts:90-111`.
- Invoice creation happens after writes: `src/lib/pos-sales.ts:131-133`.
- Any error throws from outer catch: `src/lib/pos-sales.ts:142-145`.
- Shift update failures are swallowed (sale still succeeds): `src/lib/pos-sales.ts:186-189`.

Why this is a logic bug:
- Multi-entity transaction has no rollback/compensation strategy.

Recommended fix:
- Introduce server-side transactional endpoint/hook for POS commit.
- Or stage operations with idempotency key + compensating rollback.
- Make retry-safe by storing and checking `channel_order_id` idempotently.

---

### 3) [P1] “Generate Invoice from Order” does not generate an invoice

Impact:
- Orders are marked `invoiced` without creating an invoice record, breaking downstream assumptions and auditability.

Evidence:
- Function only loads order and updates status: `src/lib/orders.ts:148-155`.
- No call to invoice service / no invoice persistence.
- UI treats success as invoice generated: `src/app/orders/detail/page.tsx:63-66`.

Why this is a logic bug:
- Status transition claims artifact creation that never happens.

Recommended fix:
- Create invoice + items in same flow and return `invoiceId`.
- Only set order status `invoiced` after successful invoice persistence.

---

### 4) [P1] Return processing misses core stock-restoration logic despite UI promise

Impact:
- Approved/refunded returns do not restore inventory; stock remains understated over time.

Evidence:
- Approval path only updates credit note status: `src/lib/returns.ts:267-269`.
- Refund path only updates credit note status/meta: `src/lib/returns.ts:271-281`.
- No stock movement or variant stock updates in returns service.
- UI explicitly claims approval restores stock: `src/app/returns/detail/page.tsx:406`.

Why this is a logic bug:
- Business invariant for product return is incomplete: financial reversal without inventory reversal.

Recommended fix:
- On approve/refund, create `stock_movements` with positive quantity and increment `product_variants.stock_level`.
- Make operation idempotent (prevent double-restock on repeated action).

---

### 5) [P1] GRN accepts unbounded receipts; PO received quantity can exceed ordered

Impact:
- Over-receipt can inflate stock and incorrectly close PO as fully received.

Evidence:
- Incoming GRN quantity accepted as provided: `src/lib/purchase.ts:404-411`.
- PO received quantity blindly incremented: `src/lib/purchase.ts:439-442`.
- No guard against exceeding `quantity_ordered`.

Why this is a logic bug:
- Violates procurement quantity invariants.

Recommended fix:
- Validate `item.quantity_received <= (quantity_ordered - quantity_received_existing)` per PO item.
- Reject or split excess quantity into explicit over-receipt workflow.

---

### 6) [P1] Banking ledger update is split-write and allows silent overdraft

Impact:
- Transaction record may be saved even if account balance update fails, causing ledger/balance divergence.
- Withdrawals/transfers can push balances below zero without validation.

Evidence:
- Transaction is created before balance mutation: `src/lib/banking.ts:145` then `151`.
- Balance calculation subtracts without funds check: `src/lib/banking.ts:167-169`.
- No rollback of created transaction if balance update fails.

Why this is a logic bug:
- Financial write path lacks atomicity and business-rule guards.

Recommended fix:
- Execute both operations in a single server-side transaction/hook.
- Enforce `amount > 0` and insufficient-funds validation for debit types.

---

### 7) [P1] Document number sequencing is race-prone across core documents

Impact:
- Concurrent requests can generate duplicate invoice/PO/GRN/challan/credit-note/expense numbers.

Evidence pattern:
- Read current sequence -> increment -> update in separate calls (non-atomic).
- Example in invoice: `src/lib/invoice.ts:240-246`.
- Same pattern in purchase: `src/lib/purchase.ts:95-100`, `124-129`.
- Same pattern in returns/challan/expenses: `src/lib/returns.ts:75-80`, `src/lib/challan.ts:114-119`, `src/lib/expenses.ts:54-59`.

Why this is a logic bug:
- Parallel clients/tabs can read same current value before either update commits.

Recommended fix:
- Move sequence increment to atomic server primitive (PocketBase hook/endpoint with mutex or DB-level lock).
- Add unique index and retry logic on number collisions.

---

### 8) [P2] Challan service has schema-contract drift causing broken list/generation behavior

Impact:
- Challan filtering/listing and order-to-challan item fetch can fail or return empty/incorrect data depending on active schema.

Evidence:
- `getChallans` filters/mapping use `delivery_date`: `src/lib/challan.ts:313`, `316`, `331`.
- `createChallan` writes `challan_date`: `src/lib/challan.ts:150`.
- `generateChallanFromOrder` filters order items by `sales_order` relation: `src/lib/challan.ts:401`.
- Order item schema defines relation field `order`: `src/scripts/init-pocketbase.ts:698`.
- Delivery challan schema in initializer defines `challan_date`: `src/scripts/init-pocketbase.ts:626`.

Why this is a logic bug:
- Internal producer/consumer field contracts are inconsistent; one or more paths must be wrong.

Recommended fix:
- Canonicalize schema field names and regenerate a strict typed DTO layer.
- Add integration tests for create->list->detail and order->challan generation.

---

### 9) [P2] Login flow bypasses AuthContext account-state safeguards

Impact:
- `is_active` enforcement and default-role assignment logic in `AuthContext` is bypassed by login/register page logic.

Evidence:
- Login page authenticates directly with PocketBase: `src/app/login/page.tsx:32-35`.
- AuthContext login enforces inactive-account block: `src/contexts/AuthContext.tsx:55-59`.
- AuthContext register assigns Viewer role: `src/contexts/AuthContext.tsx:82-88`.

Why this is a logic bug:
- Two divergent auth pathways produce inconsistent authorization state.

Recommended fix:
- Route all login/register actions through AuthContext methods.
- Keep a single source of auth truth and add E2E tests for inactive-user login denial.

---

### 10) [P2] Unescaped dynamic PocketBase filters remain in multiple user-input paths

Impact:
- Search inputs containing quotes/backslashes can break filter parsing or alter query semantics.

Evidence:
- Unsanitized search interpolation in products: `src/lib/products.ts:75`.
- Unsanitized search interpolation in expenses: `src/lib/expenses.ts:104`.
- A sanitization helper exists: `src/lib/pocketbase.ts:18-20`.

Why this is a logic bug:
- Query behavior becomes input-dependent and brittle; malformed input can return wrong results or errors.

Recommended fix:
- Standardize `sanitizeFilter()` across all dynamic filter interpolations.
- Add tests with inputs containing `"`, `\\`, and control tokens.

## Additional Risk Notes

- Lint run shows extensive type/React-effect debt (`430` errors, `227` warnings). While not all are logic defects, they increase regression probability and hide real control-flow errors.
- Many write-heavy flows rely on client-side orchestration against PocketBase without transactional safety.

## Recommended Remediation Order

1. Financial/inventory integrity first:
- Fix shift opening-balance accounting.
- Make POS commit atomic/idempotent.
- Fix GRN bounds validation.
- Add return stock-restoration logic.
- Harden banking debit path + split-write handling.

2. Document correctness:
- Implement real order->invoice generation.
- Replace race-prone numbering with atomic server-side sequencing.

3. Contract hardening:
- Resolve challan schema field drift and enforce typed contracts.
- Unify auth flow through AuthContext.
- Sanitize all filter interpolation sites.

## Verification Checklist After Fixes

- Shift open/close without sales should show zero variance when counted cash equals opening float.
- Simulated failure after sale creation should not leave orphaned partial sale artifacts.
- “Generate Invoice” must create invoice + items and return invoice ID every time.
- Approving/refunding return should create positive stock movement and update variant stock exactly once.
- GRN reject when cumulative receipt exceeds PO ordered quantity.
- Withdrawal/transfer blocked on insufficient funds.
- Parallel document creation should never produce duplicate numbers.
- Challan create/list/detail and order->challan item mapping must pass integration tests.
- Inactive user must be denied via login UI path.
- Search with special characters should return deterministic results and no parser errors.

## Audit Status

- Audit completed: Yes
- Scope covered: Core app logic and critical transactional modules
- Confidence: High (line-verified findings)
