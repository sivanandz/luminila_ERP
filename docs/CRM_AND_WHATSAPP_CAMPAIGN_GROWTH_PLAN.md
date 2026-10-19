# Luminila CRM Enhancement & WhatsApp Campaign Growth Engine
**Architectural Blueprint & Implementation Plan**

---

## 1. Executive Summary

This enhancement elevates Luminila's CRM from a static customer address book into an **active revenue-generating engine**. By combining **dynamic RFM customer segmentation**, **deep WhatsApp campaign performance analytics**, **hybrid conversion attribution** (7-day window + promo code tracking), and an **automated milestone lifecycle engine** (birthdays, anniversaries, lapsed VIP win-back), the showroom can proactively drive repeat sales, recover inactive clients, and track exact revenue generated per marketing rupee.

---

## 2. Core Pillars & Architectural Decisions

### Pillar 1: Dynamic RFM & Cohort Segmentation Engine (`src/lib/crm-rfm.ts`)
Calculates real-time Recency, Frequency, and Monetary scores across all customers:
- **Champions & VIPs**: Recent purchases (<45 days), high frequency (≥3 orders), high LTV (>₹25,000).
- **Loyal Shoppers**: Regular repeat buyers across counter POS and WhatsApp.
- **At-Risk Clients**: Lapsed (60–120 days since last purchase) who previously purchased.
- **Hibernating / Dormant**: Inactive (>120 days without purchase).
- **Upcoming Milestone Celebrations**: Customers with verified birthdays or anniversaries in the next 7 days.
- **WhatsApp Inquirers**: Contacts who messaged on WhatsApp or received quotes but haven't converted yet.
- **One-Click Target Campaign**: Every segment features an instant "Launch Campaign to this Cohort" action.

### Pillar 2: Hybrid Campaign Conversion & Revenue Attribution Engine (`src/lib/campaign-attribution.ts`)
Tracks campaign performance beyond message delivery to actual monetary return:
- **Hybrid Attribution Model**:
  - **Phone + 7-Day Window**: Any sale created in `sales` or `sales_orders` within 7 days of campaign dispatch to that customer phone number is credited.
  - **Campaign Promo Code Matching**: Direct credit if an order applies the campaign's specific coupon code.
- **Performance Funnel Metrics**:
  - `Queued` → `Sent` → `Delivered` → `Read` → `Replied` → `Orders Converted` → `Attributed Revenue (INR)`.
  - **ROI & Conversion Rate**: Real-time calculation of conversion rate (`orders / sent * 100`) and average order value (AOV) per campaign.

### Pillar 3: Automated Milestone & Lifecycle Trigger Engine (`src/lib/crm-lifecycle-triggers.ts`)
Automated daily scanner that queues personalized messages into the existing anti-ban staggered dispatcher:
1. **Birthday Rewards**: 3 days prior to customer's birthday, sends birthday wishes + exclusive personalized voucher.
2. **Anniversary Elegance Drops**: 3 days prior to wedding anniversary, sends couple's jewelry curation + discount perk.
3. **Lapsed VIP Win-Back**: Automatically nudges high-tier customers who haven't shopped in 60 days with a VIP concierge preview.
4. **Post-Delivery Care & Review Request**: 5 days after order delivery, sends jewelry care instructions and requests Google / WhatsApp feedback.
- Each flow has an independent **Enable/Disable toggle**, editable message template, and pre-dispatch preview.

### Pillar 4: Multi-Tab CRM & Growth Suite UI (`src/app/customers/page.tsx` & `/customers/detail/page.tsx`)
Replaces the basic table on `/customers` with a cohesive 4-tab control center:
- **Tab 1: Customers Directory & 360° Profile**:
  - Direct display of ring size, bangle size, metal preference, lead status, total orders, and total spent.
  - One-click "Chat on WhatsApp" button that deep-links directly into the `/whatsapp` hub with this contact selected.
  - Quick action: "Send Direct Promotion".
- **Tab 2: RFM Segments & Cohorts**:
  - Interactive distribution cards with customer counts and total cohort LTV.
  - Filterable list of members per segment with bulk broadcast action.
- **Tab 3: WhatsApp Campaigns & Attribution Analytics**:
  - Aggregate performance KPI strip: Total Attributed Revenue, Overall Conversion Rate, Active Campaigns, Messages Delivered.
  - Visual conversion funnel chart/progress.
  - Campaign history table with status, sent/delivered/read counts, converted orders, revenue, and ROI.
  - "New Campaign" composer trigger with audience segment selector and promo code generator.
- **Tab 4: Automated Lifecycle Triggers**:
  - Status cards for Birthday, Anniversary, Re-engagement, and Review flows.
  - Master auto-run switch, send preview drawer, and execution logs.
- **Customer Detail Upgrade (`/customers/detail/page.tsx`)**:
  - Replaces "Integration pending with order table" with live query to `sales` and `sales_orders` collections.
  - Displays customer's actual jewelry specifications (ring size, bangle size, metal preferences, lead stage).

---

## 3. Implementation Steps & File Modifications

| Step | Component / Service | File Path | Scope |
| :--- | :--- | :--- | :--- |
| **Step 1** | RFM Segmentation Engine | `src/lib/crm-rfm.ts` | New service calculating RFM segments, cohort stats, and milestone lookups. |
| **Step 2** | Campaign Attribution Engine | `src/lib/campaign-attribution.ts` | New service managing campaign registry, 7-day order attribution, funnel analytics, and ROI. |
| **Step 3** | Automated Lifecycle Engine | `src/lib/crm-lifecycle-triggers.ts` | New service for scheduled birthday, anniversary, win-back, and review auto-dispatch. |
| **Step 4** | Order Attribution Hook | `src/lib/orders.ts` & `src/lib/whatsapp-order-ingestion.ts` | Wire attribution check when orders are created or paid. |
| **Step 5** | Multi-Tab CRM Hub UI | `src/app/customers/page.tsx` | Rewrite page into 4-tab dashboard (Directory, RFM Segments, Campaign Analytics, Auto-Triggers). |
| **Step 6** | Real Purchase History on Detail | `src/app/customers/detail/page.tsx` | Wire live sales history, jewelry specs, and WhatsApp interaction timeline. |
| **Step 7** | Verification & Validation | Typecheck & Dev Audit | Run `npx tsc --noEmit` and verify end-to-end functionality. |
