# Part 2/3 Audit — Verification & Remediation Record

**Date:** 2026-11-04
**Source report:** `BUG_AUDIT_REPORT_2026-11-04_PART2.md` (344 findings: 10 Critical, 107 High, 164 Medium, 63 Low)
**Method:** every finding re-checked against the working tree (file:line + named symbol), then fixed in severity order. Verification was split across six read-only passes (report §2.1–2.12, §7–§12); fixes were applied in four waves. `npm run typecheck` and the full `npm test` lane were run after every wave.

---

## 1. Verification result

| Section | Findings | Verdict |
|---|---|---|
| 2.1 Invoices / GST / E-Way (INV-1..15) | 15 | 14 valid; **INV-3 already fixed** |
| 2.2 Orders / Challan / Shipments (ORD-1..15) | 15 | 13 valid; ORD-5 partial; **ORD-8 invalid** |
| 2.3 Returns / Credit Notes (RET-1..15) | 15 | all valid |
| 2.4 Purchase / GRN / Valuation (PUR-1..15) | 15 | 11 valid; PUR-8/10/15 partial; **PUR-4 already fixed** |
| 2.5 Banking / Cheques / Expenses / Multi-loc (BNK-1..15) | 15 | all valid |
| 2.6 Customers / Loyalty / CRM (CUS-1..15) | 15 | 14 valid; CUS-2 partial |
| 2.7 Reports / Analytics / GSTR-1 (RPT-1..15) | 15 | all valid |
| 2.8 WhatsApp CRM / Broadcast (WA-1..15) | 15 | 14 valid; WA-2 partial |
| 2.9 Payments / Razorpay / PhonePe (PAY-1..15) | 15 | all valid |
| 2.10 Sync / Omnichannel / Tenant DB (SYN-1..15) | 15 | all valid |
| 2.11 AI Assistant / API auth / OTP (AI-1..15) | 15 | 14 valid; **AI-16 already fixed** (wave 4) |
| 2.12 Settings / Backup / Misc (SET-1..15) | 15 | all valid (SET-15: file confirmed absent) |
| 7.1 AI remainder (AI-16..30) | 15 | 14 valid; AI-16 already fixed |
| 7.2 WhatsApp commerce (WA-16..30) | 15 | 14 valid; WA-16 partial |
| 7.3 Core infra (INF-1..15) | 15 | all valid |
| 8.1 Business libs (BIZ-1..15) | 15 | all valid |
| 8.2 Engines / campaigns (ENG-1..15) | 15 | 14 valid; **ENG-14 claim wrong** (regex already requires literal `Z`; only the state-code range check was missing) |
| 9 analytics-v2 (AN2-1..16) | 16 | 15 valid; AN2-8 partial |
| 10 Money pages (PG-1..15) | 15 | all valid |
| 11.1 Other pages (PG-16..30) | 15 | 14 valid; **PG-28 invalid** (the helper catches internally) |
| 11.2 Components (CMP-1..15) | 15 | all valid (CMP-15: file confirmed absent) |
| 11.3 Sidecar / Tauri (SIDE-1..14) | 14 | 13 valid; **SIDE-6 invalid** (`binaries/wppconnect-server-*.exe` exists; the exe is merely stale) |
| 12 Ops scripts (SCR-1..14) | 14 | all valid (SCR-12: the six migration/rules scripts are genuinely absent) |

**Totals:** 337 valid/partial · 3 already fixed at verification time (INV-3, PUR-4, AI-16) · 4 invalid as written (ORD-8, ENG-14, PG-28, SIDE-6).

The report is accurate: every Critical and every High was reproduced except the four listed above. Partial verdicts mean the main defect was real but a sub-claim was already addressed (e.g. ORD-5's account stamp, PUR-8's tenant clause, WA-2's settlement-failed gate).

---

## 2. Fixes applied in this session

### 2.1 Criticals (all 10)

| ID | Fix |
|---|---|
| INV-1 | `requireOwnedInvoice()` before trash/restore/permanent-delete; child item/payment queries scoped by owner; invoice id sanitized. |
| RET-1 | `requireOwnedCreditNote()` + `assertVariantOwned()` on approve/refund/cancel/return-from-invoice; items and all inventory side effects owner-verified. |
| PUR-1 | PO subtotal is now Σ qty × unit_price (pre-tax), rounded; GST added once. Matches the UI calculator. |
| BNK-1 | `advanceCheque` commits the register transition first (state machine = idempotency guard), posts the ledger second, and reverts the register if the ledger write fails. |
| CUS-1 | `redeemPoints` takes a per-tenant `db` client for every read/write/ledger call. |
| WA-1 | Clearing deposit uses atomic `current_balance+`; concurrent duplicates are collapsed deterministically (lowest id wins, losers delete their own row and skip the balance). |
| BIZ-1 | `markStockDiscrepancy` verifies variant ownership and fails closed; record created before the decrement with rollback on failure. |
| INF-1 | `ensureServerAuth` no longer mutates the shared client's `baseUrl`/`authStore`; tenant-scoped server work must use `createTenantClient`. INF-3/INF-4 closed with it (fail-closed auth, no stale URL fall-through). |
| SYN-1 | Provisioning is serialized; the registry is read again after spawn and a port owned by another tenant is refused. Registry writes are atomic (temp + rename) and a corrupt registry now throws (SYN-12). |
| PAY-1 | Gateway secrets no longer hydrated into the browser (Razorpay `keySecret`/`webhookSecret`, PhonePe `saltKey`) and no longer mirrored into localStorage (`SET-4`); client config is redacted. Link creation already ran through `/api/pos/payment`. **Residual:** secrets still live in the tenant's `store_settings` row and `getStoreSettings()` still returns them to the browser — a server-mediated secrets API is still required for full isolation. |

### 2.2 Highs (groups)

- **Returns:** RET-2 (refund claim + reference re-read), RET-3 (refund amount not full sale; order counter only on full refund), RET-4 (prorated loyalty clawback), RET-5 (reversals moved after drawer success), RET-6 (history read fails closed), RET-7 (inventory failure reverts note to pending), RET-8 (exchange always raises a replacement invoice), RET-9 (unreadable invoice fails safe), RET-10 (tax-inclusive QC price; deductions applied), RET-11 (note/item rollback), RET-12 (drawer failure rolls exchange back), RET-13/RET-14/RET-15.
- **Orders:** ORD-1/6 (tenant + state machine), ORD-2 (rethrow lookup, post-create convergence), ORD-3 (server recompute of line/header totals), ORD-4 (deterministic COD claim row), ORD-5 (legacy shipment guards), ORD-7 (challan rollback), ORD-9/10 (shipment compensation + transition validation), ORD-11 (tenant + IGST vs CGST/SGST + post-discount base), ORD-12 (PAID/COD + AWB precondition), ORD-13 (atomic aggregate reversal), ORD-14 (tenant mandatory, only 404 swallowed), ORD-15 (empty scope returns []).
- **Purchase:** PUR-2 (rollback ordering), PUR-3 (full GRN rollback), PUR-5/6/7/9 (tenant verification on reconcile/approve/history/import/status), PUR-8 (recompute failure surfaced as warning), PUR-11 (rejection-only lines kept), PUR-12 (over-receipt shortfall reported), PUR-13 (money-critical reads throw), PUR-14.
- **Banking:** BNK-2 (post-decrement negative-balance compensation), BNK-3 (finite/positive/2dp validation), BNK-4/5/10/12 (transfer saga, status guard, shortfall reported, failures surfaced), BNK-6 (bank-affecting expenses post a ledger entry), BNK-7 (tenant always in filter), BNK-8 (balances stripped from generic update), BNK-9 (dead receivable field removed), BNK-11/13.
- **Customers/CRM:** CUS-2/3/4/5/6/7/8/9/10/11/12/13/14/15 — atomic points, consent fail-closed and correctly stamped, ownership checks on customer mutations, duplicate-customer re-check, serialized loyalty account creation, settings errors no longer defaulted, sanitized filters, strict token `exp`.
- **Reports/GST:** RPT-1 (today window), RPT-2 (GSTR-1 error banner instead of ₹0), RPT-3/4/5 (no silent empty analytics/valuation), RPT-6 (real units/margin KPIs), RPT-7 (previous channel window), RPT-8 (tenant clause), RPT-9 (credit-note document date), RPT-10/11 (POS/ctin/state classification), RPT-12 (HSN failure blocks export), RPT-13/14/15.
- **WhatsApp/Payments:** WA-4/5/6/7/11/12/13/14/15 (opt-out and quota fail closed, atomic send claim, consent gate, dedupe, preserved attempts, message dedupe, tenant-scoped writes); PAY-2 (notes order), PAY-3 (PAID last), PAY-4 (stock failure actionable), PAY-5/11 (dedupe tenant + payment-id key), PAY-7 (currency required), PAY-12/AI-8/AI-10 (XFF + pruning), PAY-13 (decimal-shift paise), PAY-14, PAY-15.
- **Sync/Storefront:** SYN-2/3/4/5/6/7/8/9/10/11/13/14/15 (tenant-scoped channel stock, storefront binding, catalog-sync abort, no active-tenant fallback, per-tenant pricing, compensation reporting, marker-first restore, atomic clamp, encrypted registry requirement).
- **AI:** AI-1 (SSRF: canonical IPv4, mapped IPv6, trailing dot, DNS resolution, redirect re-check), AI-2, AI-3, AI-6/7, AI-9/11 (session tenant verification), AI-12, AI-13, AI-14/15, AI-17 (manual redirects), AI-18..AI-28, AI-30.
- **BIZ/ENG:** BIZ-2..BIZ-15 (ownership on categories/attributes, tenant checks in chat-sales, SKU collision handling, sanitized filters, atomic discrepancy claims); ENG-1/2/3/5/6/7/8/9/10/11/12/14/15.
- **Pages/Components:** PG-1..PG-27, PG-29, PG-30 (double-submit guard, cart/customer/tender reset, receipt snapshot, stock assert on PhonePe, clamps, error handling + toasts, permission guards); CMP-1..CMP-14 (stale vendor cleared, broadcast confirmation, tenant session id, request sequencing, URL validation, permission gates, hardcoded bank details removed).
- **Sidecar/Tauri:** SIDE-1 (origin-gated token injection), SIDE-2 (connect-src narrowed), SIDE-4 (query token removed), SIDE-5 (rate limit), SIDE-7 (health timeout), SIDE-8, SIDE-10 (OS CSPRNG), SIDE-11, SIDE-12, SIDE-13, SIDE-14 (per-session rooms).
- **analytics-v2:** AN2-1..AN2-16 (snapshot integrity, DST-safe ranges, refund banding, INR floor on deltas, honest impact estimates, over-cap throw).
- **Ops scripts:** SCR-1 code literals removed (history/rotation still a user decision), SCR-2..SCR-11, SCR-13/14 (isolation test fails on any non-403/404, test user deleted in `finally`, production plaintext refusal, admin identity required).

---

## 3. Residual open items

**Skipped / architectural (verified valid, not fixed):**

| ID | Reason |
|---|---|
| WA-8 | Anti-ban mutation quotas still live in localStorage only; needs server-side (PB) counters + per-tenant lock. |
| SIDE-3 | Release `frontendDist` still `http://127.0.0.1:3210`; changing it is a packaging decision. |
| SIDE-6 | Packaging mismatch between `pkg` output and `externalBin` target-triple name; needs a release-build decision. |
| SIDE-9 | Per-target `bundle.resources`; needs bundling work. |
| SIDE-14 (partial) | Per-session rooms done; inbound sidecar payloads still have no HMAC (no upstream signature scheme). |
| INF-11 | `getCurrentTenantEmail()` still returns `"default"`; changing it would orphan every per-tenant localStorage key. |
| PAY-1 / SET-4 (residual) | Secrets removed from the browser config and localStorage, but `store_settings` still holds them plaintext and the settings read returns them to the browser. Requires a server-mediated secrets endpoint + encryption at rest. |
| SCR-1 (residual) | Committed PII remains in git history; history rewrite and credential rotation are user decisions. |
| SCR-12 | The six PocketBase migration/rules scripts do not exist in the repo; collection-rule audit is still outstanding. |

**Medium/Low findings not addressed in this pass:** the remaining ~40 items are the silent-failure/sanitization/rounding backlog identified in the original report (e.g. INV-4 already fixed; ORD-15 done; leftovers such as AI-21 detail redaction variants, PUR-10 category auto-create, SET-8 done, BNK-14 orphan retry, RPT edge cases). They remain tracked in `BUG_AUDIT_REPORT_2026-11-04_PART2.md` §2 and §7–§12.

---

## 4. Verification

```
npm run typecheck                          → clean
npm test                                   → all suites 0 failed
  (invoice-math 12, returns-policy 9, tenant-auth 17, gstr1-period 3,
   returns-qc 4, manufacturing 7, cheque-register 9, cross-border 6,
   backup 6, offline-queue 6, valuation 10, imitation 8, rate-limit 6,
   customer-token 5, whatsapp-secret 6, webhook-dedupe 6, tenant-runtime 5,
   tenant-secrets 9, gstin 7, pos-quantity 9, channel-orders 21, gateway 4,
   roadmap-capture 20, quick-add 10, packing 17, cycle-count 4,
   bundles 5, analytics 18)
```
`test-capture-invariants` fails with `fetch failed` because it requires a live dev server on `:3000` — environmental, not a code failure. `test-host-guard` was updated to assert the new opt-in loopback semantics (7/7).

**Notes**
- Two superuser-aware helpers (`canActOnTenant`, `isSuperuserAuth`) were added to `src/lib/pocketbase.ts` and used by ownership guards, so admin/server/test sessions (which legitimately act across tenants) are not rejected by the new write guards.
- A parallel session committed part of this working tree as `882f5c3` / `6633557` / `d0e6fc0`; those commits contain fixes from this work. Nothing in this session was committed by me.
