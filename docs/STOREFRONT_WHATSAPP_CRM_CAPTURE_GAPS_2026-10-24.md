# Storefront & WhatsApp → CRM Order-Capture Gap Analysis

> **Update 2026-10-24 (later same day):** P1 + high-value P2 gaps **implemented**.
> New shared capture service `src/lib/channel-orders.ts` (customer upsert with profile
> merge + canonical `+91` phone, atomic lifetime aggregates `total_spent/total_orders/
> last_purchase_date`, tax-inclusive GST split on the post-discount base, idempotent
> order lookup). Storefront route now captures email, state, shipping charges (₹99/COD
> ₹99 previously charged but never booked), UTM campaign, DPDP consent, and awards
> loyalty on COD/concierge; retried submits return the original order. Chat orders
> (`createSaleFromChat`) now create a real `sales_orders` + items, link the originating
> chat, and write a `payment_links` row (payment ref in the customer message instead of
> the false "generating link" promise). Storefront checkout sends all of it and gained a
> consent checkbox + per-session idempotency key. Covered: A1, A2, A5, B1, B2, C1, D1
> (trail), E1, E2, F1, F2 (COD/concierge), F3, F4, F5, F6, F7 (variantId plumbing;
> page cart still product-level). **Still open:** A3/A4/A6, B3, B4, C2, C3, D2, D3,
> E3, E4, E5. Tests: `src/scripts/test-channel-orders.ts` (21 assertions) wired into
> `npm test`.

**Date:** 2026-10-24

> **Companion analysis:** `PROJECT_MASTER.md` §11.65 enumerates the full case matrix
> (32 cases), the ranked failure modes (F1–F6) behind the gaps above, and the
> pair-programming handoff for the parallel agent.
**Scope:** What data the two remote channels (web storefront, WhatsApp chat) actually capture into the CRM today, versus what the CRM schema can hold and what a jewelry e-commerce/WhatsApp commerce operation needs. Every gap below is verified against current code with file:line evidence.
**Method:** Full trace of `src/app/api/storefront/order/route.ts`, `src/lib/chat-sales.ts`, `src/lib/customer-lookup.ts` (`createCustomerFromChat`), `src/lib/razorpay-webhook-handler.ts`, the storefront checkout (`storefront/src/app/checkout/page.tsx`), and the live `customers` / `sales_orders` / `sales` schemas.

---

## 1. Baseline — what is captured today

### Web storefront (`/api/storefront/order`)
Customer name, phone, shipping address (flattened into one string with city+pincode), line items (price re-verified server-side from `channel_prices.website || base_price`), coupon code (recomputed server-side), payment method, `ORD-` txn id, Razorpay payment id (into a notes string only). Writes: `customers` (find-or-create), `sales_orders` + `sales_order_items`, mirrored `sales` row, stock movement + decrement (COD at once, online on paid webhook), loyalty points **only on the Razorpay paid webhook** (`razorpay-webhook-handler.ts:163-186`).

### WhatsApp chat (`createSaleFromChat`, `chat-sales.ts:26-63`)
Customer name, phone, cart lines (product, qty, base_price), total. Writes `sales` (status `pending`, `payment_method: 'upi'` hardcoded) + `sale_items`. Customer auto-created as lead (`createCustomerFromChat`, `customer-lookup.ts:196-234`): name, phone, source, `lead_status: new_lead` only.

### CRM capacity (exists but unfed)
`customers` has 38 fields — email, billing/shipping address, GSTIN, company, DOB/anniversary, ring/bangle size, preferred metal, tier, store_credit, total_spent/total_orders, lead_status, assigned_staff, opt_in_marketing, preferred_contact. `sales_orders` has `customer_email`, `billing_address`, `expected_delivery_date`, `internal_notes`, `tax_total`. `sales` has `campaign`. Almost none of these are written by either channel.

---

## 2. Missing components

### A. Contact & identity (checkout collects it, CRM never receives it)

| # | Gap | Evidence | Impact |
|---|---|---|---|
| A1 | **Email dropped between UI and API** — checkout collects `customerEmail` (`storefront/.../checkout/page.tsx:34`) but `StorefrontOrderPayload` has no email field; `customers.email` / `sales_orders.customer_email` never written | `order/route.ts:34-54` | No order confirmation email, no B2B invoices, no marketing list from web channel |
| A2 | **State captured, never sent** — `stateVal` (`checkout/page.tsx:37`) absent from payload; address string has no state | `order/route.ts:258` | IGST vs CGST/SGST cannot be determined for online invoices; place-of-supply unknown |
| A3 | **No billing address capture** — only shipping; `sales_orders.billing_address` and `customers.billing_address` always empty | schema vs `order/route.ts:258` | B2B/GST invoicing from web orders impossible |
| A4 | **No GSTIN/company fields in checkout** — `customers.gstin` only fillable manually | checkout form fields | B2B web buyers can't be invoiced correctly |
| A5 | **WhatsApp orders capture no address at all** — chat sale has neither shipping nor billing | `chat-sales.ts:18-41` | Chat orders are unfulfillable without manual follow-up |
| A6 | **Zero enrichment capture** — DOB, anniversary, ring/bangle size, preferred metal exist in CRM with no storefront/WhatsApp collection surface | `customers` schema | The CRM's jewelry-specific fields (the point of having them) can only be filled by hand |

### B. Commercial data

| # | Gap | Evidence | Impact |
|---|---|---|---|
| B1 | **Shipping charges hardcoded to 0** — checkout checks Shiprocket serviceability (`checkout/page.tsx:58`) but the order persists `shipping_charges: 0`; courier name goes into a notes string | `order/route.ts:263,268` | Free shipping on every web order whether intended or not; no margin accounting |
| B2 | **No tax computation on web orders** — `tax_total` never written; storefront totals carry no GST breakdown | `order/route.ts:252-271` | Web-order invoices either invent tax later or file 0% — a statutory exposure |
| B3 | **WhatsApp sales: no discount/coupon support, payment method hardcoded `upi`** | `chat-sales.ts:38-40` | Chat price negotiated off-system is unverifiable; payment intent wrong |
| B4 | **Coupon usage not recorded** — discount recomputed server-side but `discount_usage` row never created for web orders; coupon code lives only in the notes string | `order/route.ts:217-244,270` | Usage limits unenforceable on the web channel (D-21 fix incomplete for storefront) |

### C. Fulfilment

| # | Gap | Evidence | Impact |
|---|---|---|---|
| C1 | **Chat orders create no `sales_orders` record** — they go straight to `sales` with no shipping address, no courier, no expected date | `chat-sales.ts:31` | Chat channel has no fulfilment pipeline at all |
| C2 | **Nothing writes `shipments`** — the collection now exists (post-phantom-collections migration) but no order path creates a shipment row or links an AWB | `order/route.ts`, `chat-sales.ts` (absent) | Dispatch station and ST-Courier tracking have no order-linked feed |
| C3 | **`expected_delivery_date` never set** by either channel | `sales_orders` schema vs writers | Promise dates / late-order reports impossible |

### D. Payment

| # | Gap | Evidence | Impact |
|---|---|---|---|
| D1 | **Chat "payment link" is a lie** — the confirmation message says "generating your payment link now" but nothing creates a link or stores any payment reference on the sale | `whatsapp/page.tsx:1252`, `chat-sales.ts` | No payment trail for chat orders; manual UPI verification only |
| D2 | **COD settlement lifecycle missing** — COD starts `UNPAID`; no component ever marks COD paid on delivery | `order/route.ts:249` | COD revenue stays unbanked in reports unless edited by hand |
| D3 | **No channel-facing cancel/refund path** — returns/credit notes exist only for ERP-side invoices | storefront app (absent) | Customer-initiated cancellations invisible to CRM |

### E. Marketing, attribution & consent

| # | Gap | Evidence | Impact |
|---|---|---|---|
| E1 | **`sales.campaign` never written; no UTM capture** — storefront records nothing about where the buyer came from | schema vs `order/route.ts` | Campaign ROI unmeasurable on web sales |
| E2 | **No marketing consent capture** — `customers.opt_in_marketing` exists; checkout has no consent checkbox | checkout form | Compliance + can't build the list you're allowed to build |
| E3 | **No abandoned-cart capture** — `CartContext` is localStorage-only; nothing persists a stalled checkout | `storefront/src/context/CartContext.tsx` | The highest-converting retargeting channel (WhatsApp nudge) has no trigger data |
| E4 | **Reviews are static** — `ReviewsCarousel` is hardcoded content; no review capture tied to orders/customers | storefront components | Social proof not accumulated |
| E5 | **No wishlist** | — | Standard jewelry-ecommerce retention feature absent |

### F. CRM integrity & lifecycle

| # | Gap | Evidence | Impact |
|---|---|---|---|
| F1 | **Customer lifetime aggregates never written** — `total_spent`, `total_orders`, `last_purchase_date`, `tier` are read in 10+ places, written by zero order paths (all grep hits are mappers/displays) | `customer-lookup.ts:150-152`, `customers/page.tsx:657` | CRM "top customers", tier benefits, and reports show zeros forever |
| F2 | **Loyalty asymmetry** — points awarded only on Razorpay paid webhook; COD, concierge and chat orders award nothing | `razorpay-webhook-handler.ts:163-186` | Most WhatsApp/COD buyers silently earn no loyalty |
| F3 | **No order↔chat linkage** — sales created from chat carry no chat/message reference; `whatsapp_messages` has no order ref | `chat-sales.ts:31-41` | "Which conversation produced this order" is unrecoverable |
| F4 | **Repeat customers never updated** — web order finds customer by phone and keeps the stale address/profile; new address is not merged | `order/route.ts:129-150` | CRM rots as customers move |
| F5 | **Phone format split-brain** — chat stores `+91XXXXXXXXXX`, web stores bare digits; matching relies on LIKE-last-10 | `customer-lookup.ts:208-213` vs `order/route.ts:126` | Duplicate-customer risk under any exact-match flow |
| F6 | **No idempotency key on web orders** — `txnId` is random per attempt; a retried submit double-orders (rate limiter is the only guard) | `order/route.ts:56-61` | Double revenue + double stock decrement on flaky networks |
| F7 | **Chat orders pick `variants.items[0]` blindly** — size/variant never captured from the conversation despite the spec's variant-hint extraction (§2) | `chat-sales.ts:45-48` | Wrong-variant shipments for sized jewelry |

---

## 3. Priority order

**P1 — money & fulfilment correctness:** B1 (shipping charges), B2 (web tax), C1+A5 (chat order = real sales_order + address), D1 (chat payment link), F1 (aggregates), F6 (idempotency), F7 (variant pick).
**P2 — CRM value:** A1 (email), A2 (state), E1 (attribution), F2 (loyalty parity), F3 (chat linkage), C2 (shipments), D2 (COD settle), F4 (profile update), F5 (phone canonicalization).
**P3 — growth features:** A3/A4/A6 (B2B + enrichment), B4 (coupon usage), E2 (consent), E3 (abandoned carts), E4 (reviews), E5 (wishlist), D3 (self-serve cancel).

The schema is largely ready — this is a capture-layer problem, not a modeling problem. The single highest-leverage change is unifying both channels on one order-intake service that validates and writes the full field set (email, state, billing, shipping charges, tax, campaign, consent) and one customer-upsert service that merges profile data and keeps the phone canonical.
