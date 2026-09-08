# Luminila Inventory Management — Features Specification

This document provides a comprehensive specification of all functional capabilities, business modules, workflows, and technical features implemented across the Luminila Inventory Management System.

---

## 1. Point of Sale (POS) & Retail Terminal

Designed for high-speed retail checkout in jewelry showrooms and retail counters:

- **Touch & Keyboard Optimized UI**: Fast item selection via grid view, category filtering, or instant keyboard-driven search.
- **Integrated Barcode Scanning**:
  - Direct hardware wedge scanner support (USB / Bluetooth barcode guns).
  - Built-in camera scanner via `html5-qrcode` for mobile or tablet terminals.
- **Variant Selector**: Seamless variant modal to select ring sizes, metal colors (Rose Gold, Yellow Gold, Silver), and stone materials.
- **Cart Management**: Real-time recalculation of item subtotal, item-level discounts, order-level percentage or flat discounts, and applicable GST.
- **Split & Multi-Tender Payments**:
  - Cash (with change due calculation).
  - Credit/Debit Cards.
  - UPI / QR code payment.
  - Integrated **PhonePe** dynamic QR generation.
  - Split tender transactions across multiple payment modes.
- **Receipt & Invoice Generation**: Immediate generation of thermal POS receipts or official A4/A5 GST tax invoices with auto-generated document numbers.
- **Active Shift Association**: Every POS sale is linked to the cashier’s currently open cash register shift.

---

## 2. Cash Drawer & Shift Management

Ensures physical cash accountability and prevents cashier discrepancy:

- **Shift Opening Float**: Cashiers record physical opening cash before initiating checkout.
- **Mid-Shift Cash Operations**:
  - **Cash In (Pay In)**: Adding cash to the drawer with mandatory reason notes.
  - **Cash Out (Drop / Pay Out)**: Petty cash withdrawals or midday bank drops.
- **Continuous Expected Balance**: Tracks expected drawer balance in real time based on opening float, cash sales, cash refunds, and manual cash adjustments.
- **Blind Shift Closing**: Cashiers count physical denominations and enter actual cash count without seeing the expected total beforehand.
- **Variance Tracking**: Automatic calculation of drawer discrepancy (`actual_balance - expected_balance`) with variance notes and manager approval tracking.

---

## 3. Product Catalog & Variant Matrix

Structured catalog modeling designed specifically for fashion jewelry:

- **Base Product Hierarchy**: Name, main SKU, category, base price, cost price, description, images, and base barcode.
- **Multi-Dimensional Variant Matrix**:
  - Multiple variants per base product (e.g., Size: 6/7/8/9, Color: Rose Gold/Silver/Yellow Gold, Material: Sterling Silver/Brass/Stainless Steel).
  - Custom SKU suffixing (e.g., `RNG-001-RG-7`).
  - Variant-specific price adjustments (delta over base price).
- **Independent Stock Tracking**: Each variant maintains its own `stock_level` and `low_stock_threshold`.
- **Low Stock Notification Engine**: Color-coded visual badges and dashboard alerts when stock drops below threshold.
- **Immutable Inventory Audit Trail (`stock_movements`)**: Every stock addition, POS deduction, GRN receipt, return restock, or manual count adjustment is permanently logged with timestamps, source, and user reference.

---

## 4. Barcode Generation & Batch Label Printing

Hardware-agnostic barcode generation engine for tagging physical jewelry inventory:

- **Vector Code128 Rendering**: Barcodes generated crisply via `jsbarcode` in SVG/Canvas formats.
- **Customizable Label Layouts**:
  - Single roll thermal printer tags (jewelry dumbbell / butterfly barbell labels).
  - Multi-column sticker sheets (A4 sheet labels with configurable rows and columns).
- **Dynamic Tag Fields**: Display Product Name, SKU, Variant specifications, MRP / Selling Price, Barcode, and Brand Logo.
- **Batch Printing Queue**: Select multiple products or newly received purchase items and print batches of physical tags in one click.

---

## 5. GST Invoicing Engine

Complete Indian Goods and Services Tax (GST) compliant invoicing system:

- **Dual Tax Structure**:
  - **Intra-State Supply**: Automatically splits tax into CGST (Central Tax) and SGST (State Tax) based on buyer state code vs seller state code.
  - **Inter-State Supply**: Calculates integrated tax (IGST) for out-of-state deliveries.
- **HSN Code Management**: Item-level HSN tracking (e.g., HSN 7113 / 7117 for imitation and precious jewelry).
- **Reverse Charge Mechanism**: Explicit toggle and reporting for Reverse Charge invoices.
- **Amount in Words Generator**: Automatically converts financial figures to Indian English word format (e.g., *"Rupees Twelve Thousand Four Hundred Fifty Only"*).
- **Document Number Sequences**: Safe auto-incrementing serial numbering (`INV-2026-0001`, `CN-2026-0001`) via `number_sequences`.
- **PDF Export & Thermal Formatting**: Clean, printable tax invoices with company GSTIN, bank details, and terms & conditions.

---

## 6. Delivery Challans & E-Way Bills

Logistical document generation for goods movement without immediate sale:

- **Multiple Challan Categories**:
  - **Job Work**: Sending raw metal/stones to artisans, goldsmiths, or platers.
  - **Stock Transfer**: Moving goods between multiple stores or warehouse locations.
  - **Exhibition / Trade Fair**: Transporting display pieces to pop-up stores or exhibitions.
  - **On Approval**: Lending jewelry pieces to clients or stylists on approval.
- **Transport & Vehicle Tracking**: Records transporter name, mode of transport (road/air/rail), vehicle number, and dispatch timestamps.
- **E-Way Bill Ready**: Pre-formats data into standard NIC E-Way Bill JSON payloads for direct filing on the Govt portal when consignment value exceeds statutory limits (₹50,000).

---

## 7. Sales Orders, Estimates & Quotations

End-to-end B2B and wholesale workflow:

- **Quotations / Estimates**: Issue formal price estimates with validity expiration dates.
- **Order Conversion**: Convert an approved estimate into an active Sales Order with one click without retyping line items.
- **Status Lifecycle**: Tracks progression through `draft` → `sent` → `confirmed` → `shipped` → `delivered` → `invoiced`.
- **Down Payment / Advance Tracking**: Record customer advances before fulfilling custom jewelry orders.

---

## 8. Customer Returns & Credit Notes

Structured return management ensuring financial and inventory balance:

- **Return Categorization**: Log returns with specific business reasons (`defective`, `wrong_item`, `damaged`, `size_exchange`, `customer_request`).
- **GST Credit Notes**: Issues formal credit notes referencing original invoice numbers to reverse tax liability legally.
- **Restocking Control**: Option to mark returned items as restored to sellable inventory, quarantined for inspection, or scrapped.
- **Refund Settlement**: Issue refunds via original payment method, cash, bank transfer, or store credit vouchers.

---

## 9. Procurement & Goods Received Notes (GRN)

Supply chain tracking from purchase order to stock receipt:

- **Vendor Database**: Store supplier contact details, GSTIN, payment terms, and lead times.
- **Purchase Order (PO) Authoring**: Itemize variants, agreed purchase unit costs, expected arrival dates, and tax rates.
- **Warehouse Receiving (GRN)**:
  - Generates official Goods Received Notes upon shipment arrival.
  - Line-by-line inspection recording: accepted quantity vs rejected quantity.
  - Mandatory rejection reason logging (e.g., poor finish, plating discoloration, stone missing).
- **Automated Stock Increment**: Accepted GRN items automatically update variant stock levels and log stock movements.

---

## 10. Customer CRM & Tiered Loyalty Engine

Customer relationship and retention management:

- **Customer Directory**: Central customer profile storing phone, email, delivery addresses, GSTIN, and total lifetime spend.
- **Interaction Log**: Record customer preferences, ring sizes, anniversary dates, and communication history.
- **Configurable Loyalty Program**:
  - **Points Accrual**: Configurable points earned per rupee spent (e.g., 1 point per ₹100).
  - **Redemption Rules**: Configurable point value (e.g., 1 point = ₹1), minimum redemption thresholds, and max discount percentage caps.
  - **Tier Progression**: Multi-tiered system (`Bronze` → `Silver` → `Gold` → `Platinum`) with automatic tier upgrade rules and multiplier bonuses.
- **Point Ledger (`loyalty_transactions`)**: Full audit trail of every point earned, redeemed, expired, or manually adjusted.

---

## 11. Vendor Management & Supply Matrix

- Supplier directory with vendor ratings, contact points, and billing addresses.
- Vendor catalog mapping linking internal variants to vendor SKU codes.
- Complete purchase order and payment history per vendor.

---

## 12. Banking & Treasury Management

- **Account Registry**: Track balances across multiple business accounts (Current Account, Cash Drawer, UPI Settlement Account, Savings).
- **Double-Entry Transactions**: Record deposits, bank withdrawals, and inter-account transfers.
- **Real-Time Balances**: Continuous balance tracking preventing blind account depletion.

---

## 13. Expense Tracking & Categorization

- **Expense Vouchers**: Issue sequential vouchers for operational showroom and business overheads.
- **Taxonomy Categories**: Categorize expenses by Rent, Electricity, Salaries, Packaging Materials, Advertising, Travel, and Maintenance.
- **Payment Method & Proof**: Record payee, payment mode, reference numbers, and upload receipt images.

---

## 14. Reports & Business Analytics

Comprehensive analytical dashboards and reports:

- **Executive KPI Dashboard**: Today’s gross sales, invoice counts, active cashier shifts, open orders, and low-stock warnings.
- **Visual Charts**: Revenue over time, sales by channel (POS vs WhatsApp vs E-Commerce), top-selling jewelry categories.
- **Financial & Tax Summaries**: Monthly GST liability summaries (CGST, SGST, IGST totals).
- **Inventory Valuation**: Current asset value calculation based on cost prices and current stock levels.
- **System Audit Log (`activity_logs`)**: Detailed change logs showing before-and-after JSON snapshots for critical records.

---

## 15. WhatsApp Automation (WPPConnect Integration)

- **Local Sidecar**: Communicates with a local WPPConnect Node.js service running Puppeteer.
- **QR Pairing**: Displays WhatsApp Web QR code directly in the Luminila UI for quick smartphone pairing.
- **Automated Alerts**: Pre-built message templates for order confirmations, digital invoice links, and shipping updates.
- **Inbound Message Parsing**: Detects customer order inquiries directly from chat threads.
