import { isValidGstin as isValidGstinChecksum } from './gstin';
/**
 * Reports Service Layer
 * Sales, GST (GSTR-1), Stock, and other report queries using PocketBase
 */

import { pb } from './pocketbase';
import { allocateLandedCosts, weightedAverageCost } from './valuation';
import { format } from 'date-fns';
import { normalizeDateRange, escapeHtml } from './utils';
import type { Customer } from './customers';
import type { Invoice } from './invoice';
import type { ProductVariant } from '../types/database';

// ===========================================
// TYPES
// ===========================================

export interface SalesReportRow {
    date: string;
    invoiceNumber: string;
    customerName: string;
    customerGstin?: string;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
    paymentMethod?: string;
    isPaid: boolean;
}

export interface GSTR1Row {
    invoiceNumber: string;
    invoiceDate: string;
    buyerName: string;
    buyerGstin: string;
    placeOfSupply: string;
    invoiceType: string;
    taxableValue: number;
    cgstRate: number;
    cgstAmount: number;
    sgstRate: number;
    sgstAmount: number;
    igstRate: number;
    igstAmount: number;
    invoiceValue: number;
    reverseCharge: string;
}

export interface StockReportRow {
    productId: string;
    productName: string;
    sku: string;
    variantName: string;
    category?: string;
    currentStock: number;
    reorderLevel: number;
    lastUpdated: string;
    /** Cost per unit used for valuation. */
    unitCost: number;
    /** `landed` when a received purchase contributed freight or duty. */
    costBasis: 'landed' | 'purchase';
    stockValue: number;
}

export interface ReportSummary {
    totalSales: number;
    totalTax: number;
    totalOrders: number;
    totalItems: number;
}

/**
 * Invoice fields as returned by raw PocketBase `invoices` records in report
 * queries: the app-level Invoice plus the relation id, the required
 * invoice_number column, the legacy `customer_name` fallback and the
 * `expand.customer` payload that only exist on the wire response.
 */
export type InvoiceReportRecord = Invoice & {
    id: string;
    invoice_number: string;
    customer_name?: string;
    expand?: {
        customer?: Customer;
    };
};

/**
 * Invoice item fields as stored in PocketBase `invoice_items`, including the
 * `invoice` relation id used by the chunked report item queries.
 */
interface InvoiceItemRecord {
    id: string;
    invoice: string;
    hsn_code: string;
    description: string;
    quantity: number;
    taxable_amount: number;
    cgst_amount: number;
    sgst_amount: number;
    igst_amount: number;
}

/** GSTR-1 period totals; fields are absent until the report loads or on error */
export interface GSTR1Summary {
    totalB2B?: number;
    totalB2C?: number;
    totalCGST?: number;
    totalSGST?: number;
    totalIGST?: number;
    invoiceCount?: number;
}

// GSTR-1 JSON export structures (GSTN offline tool schema)
export interface GSTR1JSONInvoiceItem {
    num: number;
    itm_det: {
        rt: number;
        txval: number;
        iamt: number;
        camt?: number;
        samt?: number;
        csamt?: number;
    };
}

export interface GSTR1JSONInvoice {
    inum: string;
    idt: string;
    val: number;
    pos?: string;
    rchrg?: string;
    etin: string;
    inv_typ?: string;
    itms: GSTR1JSONInvoiceItem[];
}

export interface GSTR1JSONB2BEntry {
    ctin: string;
    inv: GSTR1JSONInvoice[];
}

export interface GSTR1JSONB2CLEntry {
    pos: string;
    inv: GSTR1JSONInvoice[];
}

export interface GSTR1JSONB2CSEntry {
    sply_ty: string;
    rt: number;
    typ: string;
    pos: string;
    txval: number;
    iamt: number;
    camt: number;
    samt: number;
    csamt: number;
}

export interface GSTR1JSON {
    gstin: string;
    fp: string;
    gt: number;
    cur_gt: number;
    version: string;
    hash: string;
    b2b: GSTR1JSONB2BEntry[];
    b2cl: GSTR1JSONB2CLEntry[];
    b2cs: GSTR1JSONB2CSEntry[];
    hsn: {
        data: {
            num: number;
            hsn_sc: string;
            desc: string;
            uqc: string;
            qty: number;
            val: number;
            txval: number;
            iamt: number;
            camt: number;
            samt: number;
            csamt: number;
        }[];
    };
}

function formatDateSafe(dateStr?: string, fmt = 'dd/MM/yyyy'): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '-' : format(d, fmt);
}

// normalizeDateRange imported from utils.ts (single source of truth)

// ===========================================
// SALES REPORT
// ===========================================

export async function getSalesReport(
    startDate: string,
    endDate: string
): Promise<{ rows: SalesReportRow[]; summary: ReportSummary }> {
    try {
        const { start, end } = normalizeDateRange(startDate, endDate);
        const invoices = await pb.collection('invoices').getFullList<InvoiceReportRecord>({
            filter: `invoice_date>="${start}" && invoice_date<="${end}"`,
            sort: '-invoice_date',
            expand: 'customer',
        });

        const rows: SalesReportRow[] = invoices.map((inv) => ({
            date: formatDateSafe(inv.invoice_date, 'dd/MM/yyyy'),
            invoiceNumber: inv.invoice_number,
            customerName: inv.buyer_name || inv.customer_name || inv.expand?.customer?.name || 'Walk-in Customer',
            customerGstin: inv.buyer_gstin || '',
            taxableValue: inv.taxable_value || inv.subtotal || 0,
            cgst: inv.cgst_amount || 0,
            sgst: inv.sgst_amount || 0,
            igst: inv.igst_amount || 0,
            total: inv.grand_total || inv.total || 0,
            isPaid: Boolean(inv.is_paid || inv.status === 'paid'),
        }));

        const summary: ReportSummary = {
            totalSales: rows.reduce((sum, r) => sum + r.total, 0),
            totalTax: rows.reduce((sum, r) => sum + r.cgst + r.sgst + r.igst, 0),
            totalOrders: rows.length,
            totalItems: 0,
        };

        return { rows, summary };
    } catch (error) {
        console.error('Error fetching sales report:', error);
        return { rows: [], summary: { totalSales: 0, totalTax: 0, totalOrders: 0, totalItems: 0 } };
    }
}

// ===========================================
// GSTR-1 REPORT (B2B + B2C)
// ===========================================

export async function getGSTR1Report(
    startDate: string,
    endDate: string
): Promise<{ b2b: GSTR1Row[]; b2c: GSTR1Row[]; summary: GSTR1Summary }> {
    try {
        const { start, end } = normalizeDateRange(startDate, endDate);
        const invoices = await pb.collection('invoices').getFullList<InvoiceReportRecord>({
            filter: `invoice_date>="${start}" && invoice_date<="${end}" && invoice_type="regular"`,
            sort: 'invoice_date',
        });

        const b2b: GSTR1Row[] = [];
        const b2c: GSTR1Row[] = [];

        invoices.forEach((inv) => {
            const invTaxable = inv.taxable_value || inv.subtotal || 0;
            const invCgst = inv.cgst_amount || 0;
            const invSgst = inv.sgst_amount || 0;
            const invIgst = inv.igst_amount || 0;

            const row: GSTR1Row = {
                invoiceNumber: inv.invoice_number,
                invoiceDate: formatDateSafe(inv.invoice_date, 'dd-MMM-yyyy'),
                buyerName: inv.buyer_name || inv.customer_name || 'Walk-in Customer',
                buyerGstin: inv.buyer_gstin || '',
                placeOfSupply: inv.place_of_supply || inv.buyer_state_code || '',
                invoiceType: 'Regular B2B',
                taxableValue: invTaxable,
                cgstRate: invCgst > 0 ? (invTaxable > 0 ? Number(((invCgst / invTaxable) * 100).toFixed(2)) : 1.5) : 0,
                cgstAmount: invCgst,
                sgstRate: invSgst > 0 ? (invTaxable > 0 ? Number(((invSgst / invTaxable) * 100).toFixed(2)) : 1.5) : 0,
                sgstAmount: invSgst,
                igstRate: invIgst > 0 ? (invTaxable > 0 ? Number(((invIgst / invTaxable) * 100).toFixed(2)) : 3) : 0,
                igstAmount: invIgst,
                invoiceValue: inv.grand_total || inv.total || 0,
                reverseCharge: inv.is_reverse_charge ? 'Y' : 'N',
            };

            if (inv.buyer_gstin && isValidGstinChecksum(inv.buyer_gstin)) {
                b2b.push(row);
            } else {
                row.invoiceType = 'B2C Large';
                b2c.push(row);
            }
        });

        const summary = {
            totalB2B: b2b.reduce((sum, r) => sum + r.invoiceValue, 0),
            totalB2C: b2c.reduce((sum, r) => sum + r.invoiceValue, 0),
            totalCGST: [...b2b, ...b2c].reduce((sum, r) => sum + r.cgstAmount, 0),
            totalSGST: [...b2b, ...b2c].reduce((sum, r) => sum + r.sgstAmount, 0),
            totalIGST: [...b2b, ...b2c].reduce((sum, r) => sum + r.igstAmount, 0),
            invoiceCount: b2b.length + b2c.length,
        };

        return { b2b, b2c, summary };
    } catch (error) {
        console.error('Error fetching GSTR-1:', error);
        return { b2b: [], b2c: [], summary: {} };
    }
}

// ===========================================
// STOCK REPORT
// ===========================================

interface LandedPurchaseOrder {
    id: string;
    order_date?: string;
    shipping_cost?: number;
    discount_amount?: number;
}

interface LandedPurchaseItem {
    purchase_order?: string;
    variant?: string;
    quantity_ordered?: number;
    quantity_received?: number;
    unit_price?: number;
}

/**
 * Weighted-average landed unit cost per variant.
 *
 * Overhead is shipping minus discount from each purchase order, spread over its
 * received lines by value. Receipts are then averaged by quantity, which is the
 * standard valuation basis and does not let the newest invoice alone decide the
 * value of all older stock. A variant with no received purchase keeps its bare
 * purchase price and is reported as such.
 */
async function buildLandedCostMap(): Promise<Map<string, number>> {
    const landed = new Map<string, number>();
    const receiptsByVariant = new Map<string, Array<{ quantity: number; landedUnitCost: number }>>();

    try {
        const orders = await pb.collection('purchase_orders').getFullList<LandedPurchaseOrder>({
            filter: 'status="received" || status="partial"',
            sort: 'order_date',
        });
        if (orders.length === 0) return landed;

        const itemsByOrder = new Map<string, LandedPurchaseItem[]>();
        for (let i = 0; i < orders.length; i += 30) {
            const ids = orders.slice(i, i + 30).map((order) => order.id);
            const filter = ids.map((id) => `purchase_order="${id}"`).join(' || ');
            const items = await pb.collection('purchase_order_items').getFullList<LandedPurchaseItem>({
                filter,
                batch: 500,
            }).catch(() => []);
            for (const item of items) {
                const orderId = item.purchase_order || '';
                const list = itemsByOrder.get(orderId) || [];
                list.push(item);
                itemsByOrder.set(orderId, list);
            }
        }

        for (const order of orders) {
            const lines = (itemsByOrder.get(order.id) || [])
                .filter((item) => item.variant && (item.quantity_received || item.quantity_ordered || 0) > 0)
                .map((item) => ({
                    key: item.variant as string,
                    quantity: Number(item.quantity_received || item.quantity_ordered || 0),
                    unitCost: Number(item.unit_price || 0),
                }));

            if (lines.length === 0) continue;

            const overhead = Number(order.shipping_cost || 0) - Number(order.discount_amount || 0);
            for (const line of allocateLandedCosts(lines, overhead)) {
                const receipts = receiptsByVariant.get(line.key) || [];
                receipts.push({ quantity: line.quantity, landedUnitCost: line.landedUnitCost });
                receiptsByVariant.set(line.key, receipts);
            }
        }

        for (const [variantId, receipts] of receiptsByVariant) {
            const average = weightedAverageCost(receipts);
            if (average > 0) landed.set(variantId, average);
        }
    } catch (error) {
        console.warn('Landed cost valuation unavailable, falling back to purchase price:', error);
    }

    return landed;
}

export async function getStockReport(): Promise<{
    rows: StockReportRow[];
    summary: { totalProducts: number; lowStock: number; totalValue: number; landedCount: number };
}> {
    try {
        const [data, landedCostByVariant] = await Promise.all([
            pb.collection('product_variants').getFullList<ProductVariant>({
                sort: 'stock_level',
                expand: 'product',
            }),
            buildLandedCostMap(),
        ]);

        const rows: StockReportRow[] = data.map((v) => {
            const product = v.expand?.product;
            const costPrice = (product?.cost_price && product.cost_price > 0)
                ? product.cost_price
                : (product?.base_price || 0);
            const stockLevel = v.stock_level || 0;
            const landedCost = landedCostByVariant.get(v.id);

            return {
                productId: product?.id || '',
                productName: product?.name || 'Unknown',
                sku: (product?.sku || '') + (v.sku_suffix ? `-${v.sku_suffix}` : ''),
                variantName: v.variant_name || 'Default',
                category: product?.category,
                currentStock: stockLevel,
                reorderLevel: v.low_stock_threshold || 10,
                lastUpdated: formatDateSafe(v.updated),
                unitCost: landedCost ?? costPrice,
                costBasis: landedCost !== undefined ? 'landed' : 'purchase',
                stockValue: stockLevel * (landedCost ?? costPrice),
            };
        });

        const summary = {
            totalProducts: rows.length,
            lowStock: rows.filter((r) => r.currentStock < r.reorderLevel).length,
            totalValue: rows.reduce((sum, r) => sum + r.stockValue, 0),
            landedCount: rows.filter((r) => r.costBasis === 'landed').length,
        };

        return { rows, summary };
    } catch (error) {
        console.error('Error fetching stock report:', error);
        return { rows: [], summary: { totalProducts: 0, lowStock: 0, totalValue: 0, landedCount: 0 } };
    }
}

// Helper to fetch invoice items in chunks to avoid URL length limit overflow (HTTP 414 / 400)
export async function fetchInvoiceItemsForInvoices(invoiceIds: string[]): Promise<InvoiceItemRecord[]> {
    if (!invoiceIds || invoiceIds.length === 0) return [];
    const CHUNK_SIZE = 25; // max 25 IDs per query keeps URL length ~700 chars, well below 2KB/4KB proxy limits
    const chunks: string[][] = [];
    for (let i = 0; i < invoiceIds.length; i += CHUNK_SIZE) {
        chunks.push(invoiceIds.slice(i, i + CHUNK_SIZE));
    }
    const results = await Promise.all(
        chunks.map(chunk => {
            const filter = chunk.map(id => `invoice="${id}"`).join(' || ');
            return pb.collection('invoice_items').getFullList<InvoiceItemRecord>({ filter });
        })
    );
    return results.flat();
}

// ===========================================
// HSN SUMMARY (for GST filing)
// ===========================================

export async function getHSNSummary(
    startDate: string,
    endDate: string
): Promise<{ hsnCode: string; description: string; quantity: number; taxableValue: number; tax: number; igst: number; cgst: number; sgst: number }[]> {
    try {
        const { start, end } = normalizeDateRange(startDate, endDate);
        // Fetch invoice items with date filter through invoice
        const invoices = await pb.collection('invoices').getFullList({
            filter: `invoice_date>="${start}" && invoice_date<="${end}"`,
        });

        const invoiceIds = invoices.map(inv => inv.id);
        if (invoiceIds.length === 0) return [];

        const items = await fetchInvoiceItemsForInvoices(invoiceIds);

        // Group by HSN
        const byHSN = new Map<string, { description: string; quantity: number; taxableValue: number; tax: number; igst: number; cgst: number; sgst: number }>();

        items.forEach((item) => {
            const hsn = item.hsn_code || '7113';
            const existing = byHSN.get(hsn) || {
                description: item.description?.split(' - ')[0] || 'Jewelry',
                quantity: 0,
                taxableValue: 0,
                tax: 0,
                igst: 0,
                cgst: 0,
                sgst: 0,
            };

            const itemIgst = item.igst_amount || 0;
            const itemCgst = item.cgst_amount || 0;
            const itemSgst = item.sgst_amount || 0;

            byHSN.set(hsn, {
                description: existing.description,
                quantity: existing.quantity + (item.quantity || 0),
                taxableValue: existing.taxableValue + (item.taxable_amount || 0),
                tax: existing.tax + itemCgst + itemSgst + itemIgst,
                igst: existing.igst + itemIgst,
                cgst: existing.cgst + itemCgst,
                sgst: existing.sgst + itemSgst,
            });
        });

        return Array.from(byHSN.entries()).map(([hsnCode, data]) => ({
            hsnCode,
            ...data,
        }));
    } catch (error) {
        console.error('Error fetching HSN summary:', error);
        return [];
    }
}

// ===========================================
// EXPORT UTILITIES
// ===========================================

export function exportToCSV(data: object[], filename: string): void {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map((row) =>
            headers.map((h) => {
                const value = (row as Record<string, unknown>)[h];
                let strVal = value === null || value === undefined ? '' : String(value);
                if (/^[=+@-|\t\r]/.test(strVal)) {
                    strVal = `'${strVal}`;
                }
                if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n') || strVal.includes('\r')) {
                    return `"${strVal.replace(/"/g, '""')}"`;
                }
                return strVal;
            }).join(',')
        ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
}

// ===========================================
// GST JSON EXPORT (GSTR-1)
// ===========================================

export async function generateGSTR1JSON(
    startDate: string,
    endDate: string,
    gstin: string
): Promise<GSTR1JSON> {
    try {
        const { start, end } = normalizeDateRange(startDate, endDate);
        const invoices = await pb.collection('invoices').getFullList<InvoiceReportRecord>({
            filter: `invoice_date>="${start}" && invoice_date<="${end}" && invoice_type="regular"`,
            sort: 'invoice_number',
        });

        // Fetch items for all invoices in safe URL-length chunks
        const invoiceIds = invoices.map(inv => inv.id);
        let allItems: InvoiceItemRecord[] = [];
        if (invoiceIds.length > 0) {
            allItems = await fetchInvoiceItemsForInvoices(invoiceIds);
        }

        // Group items by invoice
        const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
        allItems.forEach(item => {
            if (!itemsByInvoice.has(item.invoice)) {
                itemsByInvoice.set(item.invoice, []);
            }
            itemsByInvoice.get(item.invoice)!.push(item);
        });

        const hsnData = await getHSNSummary(startDate, endDate);

        const b2b: GSTR1JSONB2BEntry[] = [];
        const b2cl: GSTR1JSONB2CLEntry[] = [];
        const b2cs: GSTR1JSONB2CSEntry[] = [];

        const getInvoiceItemsByRate = (inv: InvoiceReportRecord) => {
            const items = itemsByInvoice.get(inv.id) || [];
            const rates = new Map<number, { txval: number; iamt: number; camt: number; samt: number; csamt: number }>();

            items.forEach((item) => {
                let rate = 0;
                if (item.taxable_amount > 0) {
                    const tax = (item.cgst_amount || 0) + (item.sgst_amount || 0) + (item.igst_amount || 0);
                    rate = Math.round((tax / item.taxable_amount) * 100);
                }

                if (!rates.has(rate)) rates.set(rate, { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
                const r = rates.get(rate)!;
                r.txval += item.taxable_amount || 0;
                r.iamt += item.igst_amount || 0;
                r.camt += item.cgst_amount || 0;
                r.samt += item.sgst_amount || 0;
            });

            return Array.from(rates.entries()).map(([rt, val]) => ({ rt, ...val }));
        };

        invoices.forEach((inv) => {
            const invDate = format(new Date(inv.invoice_date), 'dd-MM-yyyy');
            const pos = inv.place_of_supply?.substring(0, 2) || inv.buyer_state_code || '';
            const isInterState = pos !== gstin.substring(0, 2);
            const invValue = inv.grand_total;
            const items = getInvoiceItemsByRate(inv);

            if (inv.buyer_gstin && inv.buyer_gstin.length >= 15) {
                const existingBuyer = b2b.find(b => b.ctin === inv.buyer_gstin);
                const invDetail = {
                    inum: inv.invoice_number,
                    idt: invDate,
                    val: invValue,
                    pos: pos,
                    rchrg: inv.is_reverse_charge ? 'Y' : 'N',
                    etin: '',
                    inv_typ: 'R',
                    itms: items.map(item => ({
                        num: 1,
                        itm_det: {
                            rt: item.rt,
                            txval: item.txval,
                            iamt: item.iamt,
                            camt: item.camt,
                            samt: item.samt,
                            csamt: 0
                        }
                    }))
                };

                if (existingBuyer) {
                    existingBuyer.inv.push(invDetail);
                } else {
                    b2b.push({ ctin: inv.buyer_gstin, inv: [invDetail] });
                }
            } else if (isInterState && invValue > 250000) {
                const existingPos = b2cl.find(b => b.pos === pos);
                const invDetail = {
                    inum: inv.invoice_number,
                    idt: invDate,
                    val: invValue,
                    etin: '',
                    itms: items.map(item => ({
                        num: 1,
                        itm_det: {
                            rt: item.rt,
                            txval: item.txval,
                            iamt: item.iamt,
                            csamt: 0
                        }
                    }))
                };

                if (existingPos) {
                    existingPos.inv.push(invDetail);
                } else {
                    b2cl.push({ pos: pos, inv: [invDetail] });
                }
            } else {
                items.forEach(item => {
                    const type = inv.buyer_gstin ? 'E' : 'OE';
                    const entry = b2cs.find(b => b.pos === pos && b.rt === item.rt && b.typ === type);

                    if (entry) {
                        entry.txval += item.txval;
                        entry.iamt += item.iamt;
                        entry.camt += item.camt;
                        entry.samt += item.samt;
                    } else {
                        b2cs.push({
                            sply_ty: isInterState ? 'INTER' : 'INTRA',
                            rt: item.rt,
                            typ: type,
                            pos: pos,
                            txval: item.txval,
                            iamt: item.iamt,
                            camt: item.camt,
                            samt: item.samt,
                            csamt: 0
                        });
                    }
                });
            }
        });

        const fp = format(new Date(endDate), 'MMyyyy');

        return {
            gstin: gstin,
            fp: fp,
            gt: 0,
            cur_gt: 0,
            version: "GST3.0.4",
            hash: "hash",
            b2b: b2b,
            b2cl: b2cl,
            b2cs: b2cs,
            hsn: {
                data: hsnData.map(h => ({
                    num: 1,
                    hsn_sc: h.hsnCode,
                    desc: h.description,
                    uqc: 'GMS',
                    qty: h.quantity,
                    val: h.taxableValue + h.tax,
                    txval: h.taxableValue,
                    iamt: h.igst,
                    camt: h.cgst,
                    samt: h.sgst,
                    csamt: 0
                }))
            }
        };
    } catch (error) {
        console.error('Error generating GSTR1 JSON:', error);
        throw error;
    }
}

export function exportToJSON(data: unknown, filename: string): void {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${format(new Date(), 'yyyy-MM-dd')}.json`;
    link.click();
}

export function printReport(elementId: string, title: string): void {
    const element = document.getElementById(elementId);
    if (!element) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${escapeHtml(title)}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background: #f5f5f5; }
                .text-right { text-align: right; }
                .summary { background: #f9f9f9; padding: 15px; margin-bottom: 20px; }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <h2>${title}</h2>
            <p>Generated: ${format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
            ${element.innerHTML}
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 250);
}

export function printInvoice(invoiceId: string): void {
    printReport('invoice-preview', `Invoice #${invoiceId}`);
}

export function downloadInvoicePDF(_invoiceId: string): void {
    window.print();
}
