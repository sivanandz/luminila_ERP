/**
 * Reports Service Layer
 * Sales, GST (GSTR-1), Stock, and other report queries using PocketBase
 */

import { pb } from './pocketbase';
import { format } from 'date-fns';

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
    stockValue: number;
}

export interface ReportSummary {
    totalSales: number;
    totalTax: number;
    totalOrders: number;
    totalItems: number;
}

// ===========================================
// SALES REPORT
// ===========================================

export async function getSalesReport(
    startDate: string,
    endDate: string
): Promise<{ rows: SalesReportRow[]; summary: ReportSummary }> {
    try {
        const invoices = await pb.collection('invoices').getFullList({
            filter: `invoice_date>="${startDate}" && invoice_date<="${endDate}"`,
            sort: '-invoice_date',
        });

        const rows: SalesReportRow[] = invoices.map((inv: any) => ({
            date: format(new Date(inv.invoice_date), 'dd/MM/yyyy'),
            invoiceNumber: inv.invoice_number,
            customerName: inv.buyer_name,
            customerGstin: inv.buyer_gstin,
            taxableValue: inv.taxable_value || 0,
            cgst: inv.cgst_amount || 0,
            sgst: inv.sgst_amount || 0,
            igst: inv.igst_amount || 0,
            total: inv.grand_total || 0,
            isPaid: inv.is_paid || false,
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
): Promise<{ b2b: GSTR1Row[]; b2c: GSTR1Row[]; summary: any }> {
    try {
        const invoices = await pb.collection('invoices').getFullList({
            filter: `invoice_date>="${startDate}" && invoice_date<="${endDate}" && invoice_type="regular"`,
            sort: 'invoice_date',
        });

        const b2b: GSTR1Row[] = [];
        const b2c: GSTR1Row[] = [];

        invoices.forEach((inv: any) => {
            const row: GSTR1Row = {
                invoiceNumber: inv.invoice_number,
                invoiceDate: format(new Date(inv.invoice_date), 'dd-MMM-yyyy'),
                buyerName: inv.buyer_name,
                buyerGstin: inv.buyer_gstin || '',
                placeOfSupply: inv.place_of_supply || inv.buyer_state_code,
                invoiceType: 'Regular B2B',
                taxableValue: inv.taxable_value || 0,
                cgstRate: inv.cgst_amount > 0 ? 1.5 : 0,
                cgstAmount: inv.cgst_amount || 0,
                sgstRate: inv.sgst_amount > 0 ? 1.5 : 0,
                sgstAmount: inv.sgst_amount || 0,
                igstRate: inv.igst_amount > 0 ? 3 : 0,
                igstAmount: inv.igst_amount || 0,
                invoiceValue: inv.grand_total || 0,
                reverseCharge: inv.is_reverse_charge ? 'Y' : 'N',
            };

            if (inv.buyer_gstin && inv.buyer_gstin.length === 15) {
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

export async function getStockReport(): Promise<{
    rows: StockReportRow[];
    summary: { totalProducts: number; lowStock: number; totalValue: number };
}> {
    try {
        const data = await pb.collection('product_variants').getFullList({
            sort: 'stock_level',
            expand: 'product',
        });

        const rows: StockReportRow[] = data.map((v: any) => ({
            productId: v.expand?.product?.id || '',
            productName: v.expand?.product?.name || 'Unknown',
            sku: (v.expand?.product?.sku || '') + (v.sku_suffix ? `-${v.sku_suffix}` : ''),
            variantName: v.variant_name || 'Default',
            category: v.expand?.product?.category,
            currentStock: v.stock_level || 0,
            reorderLevel: v.low_stock_threshold || 10,
            lastUpdated: v.updated ? format(new Date(v.updated), 'dd/MM/yyyy') : '-',
            stockValue: (v.stock_level || 0) * (v.cost_price || 0),
        }));

        const summary = {
            totalProducts: rows.length,
            lowStock: rows.filter((r) => r.currentStock < r.reorderLevel).length,
            totalValue: rows.reduce((sum, r) => sum + r.stockValue, 0),
        };

        return { rows, summary };
    } catch (error) {
        console.error('Error fetching stock report:', error);
        return { rows: [], summary: { totalProducts: 0, lowStock: 0, totalValue: 0 } };
    }
}

// ===========================================
// HSN SUMMARY (for GST filing)
// ===========================================

export async function getHSNSummary(
    startDate: string,
    endDate: string
): Promise<{ hsnCode: string; description: string; quantity: number; taxableValue: number; tax: number }[]> {
    try {
        // Fetch invoice items with date filter through invoice
        const invoices = await pb.collection('invoices').getFullList({
            filter: `invoice_date>="${startDate}" && invoice_date<="${endDate}"`,
        });

        const invoiceIds = invoices.map(inv => inv.id);
        if (invoiceIds.length === 0) return [];

        const filter = invoiceIds.map(id => `invoice="${id}"`).join(' || ');
        const items = await pb.collection('invoice_items').getFullList({
            filter,
        });

        // Group by HSN
        const byHSN = new Map<string, { description: string; quantity: number; taxableValue: number; tax: number }>();

        items.forEach((item: any) => {
            const hsn = item.hsn_code || '7113';
            const existing = byHSN.get(hsn) || {
                description: item.description?.split(' - ')[0] || 'Jewelry',
                quantity: 0,
                taxableValue: 0,
                tax: 0,
            };

            byHSN.set(hsn, {
                description: existing.description,
                quantity: existing.quantity + (item.quantity || 0),
                taxableValue: existing.taxableValue + (item.taxable_amount || 0),
                tax: existing.tax + (item.cgst_amount || 0) + (item.sgst_amount || 0) + (item.igst_amount || 0),
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

export function exportToCSV(data: any[], filename: string): void {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map((row) =>
            headers.map((h) => {
                const value = row[h];
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value ?? '';
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
): Promise<any> {
    try {
        const invoices = await pb.collection('invoices').getFullList({
            filter: `invoice_date>="${startDate}" && invoice_date<="${endDate}" && invoice_type="regular"`,
            sort: 'invoice_number',
        });

        // Fetch items for all invoices
        const invoiceIds = invoices.map(inv => inv.id);
        let allItems: any[] = [];
        if (invoiceIds.length > 0) {
            const filter = invoiceIds.map(id => `invoice="${id}"`).join(' || ');
            allItems = await pb.collection('invoice_items').getFullList({ filter });
        }

        // Group items by invoice
        const itemsByInvoice = new Map<string, any[]>();
        allItems.forEach(item => {
            if (!itemsByInvoice.has(item.invoice)) {
                itemsByInvoice.set(item.invoice, []);
            }
            itemsByInvoice.get(item.invoice)!.push(item);
        });

        const hsnData = await getHSNSummary(startDate, endDate);

        const b2b: any[] = [];
        const b2cl: any[] = [];
        const b2cs: any[] = [];

        const getInvoiceItemsByRate = (inv: any) => {
            const items = itemsByInvoice.get(inv.id) || [];
            const rates = new Map<number, { txval: number; iamt: number; camt: number; samt: number; csamt: number }>();

            items.forEach((item: any) => {
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

        invoices.forEach((inv: any) => {
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
                    iamt: 0,
                    camt: h.tax / 2,
                    samt: h.tax / 2,
                    csamt: 0
                }))
            }
        };
    } catch (error) {
        console.error('Error generating GSTR1 JSON:', error);
        throw error;
    }
}

export function exportToJSON(data: any, filename: string): void {
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
            <title>${title}</title>
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

export function downloadInvoicePDF(invoiceId: string): void {
    window.print();
}
