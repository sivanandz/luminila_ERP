/**
 * Reports Service Layer
 * Sales, GST (GSTR-1), Stock, and other report queries
 */

import { supabase } from './supabase';
import { format } from 'date-fns';
import { formatINR } from './gst';

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
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('*')
        .gte('invoice_date', startDate)
        .lte('invoice_date', endDate)
        .order('invoice_date', { ascending: false });

    if (error) {
        console.error('Error fetching sales report:', error);
        return { rows: [], summary: { totalSales: 0, totalTax: 0, totalOrders: 0, totalItems: 0 } };
    }

    const rows: SalesReportRow[] = (invoices || []).map((inv: any) => ({
        date: format(new Date(inv.invoice_date), 'dd/MM/yyyy'),
        invoiceNumber: inv.invoice_number,
        customerName: inv.buyer_name,
        customerGstin: inv.buyer_gstin,
        taxableValue: inv.taxable_value,
        cgst: inv.cgst_amount,
        sgst: inv.sgst_amount,
        igst: inv.igst_amount,
        total: inv.grand_total,
        isPaid: inv.is_paid,
    }));

    const summary: ReportSummary = {
        totalSales: rows.reduce((sum, r) => sum + r.total, 0),
        totalTax: rows.reduce((sum, r) => sum + r.cgst + r.sgst + r.igst, 0),
        totalOrders: rows.length,
        totalItems: 0, // Could be calculated from invoice_items if needed
    };

    return { rows, summary };
}

// ===========================================
// GSTR-1 REPORT (B2B + B2C)
// ===========================================

export async function getGSTR1Report(
    startDate: string,
    endDate: string
): Promise<{ b2b: GSTR1Row[]; b2c: GSTR1Row[]; summary: any }> {
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select(`
            *,
            items:invoice_items(*)
        `)
        .gte('invoice_date', startDate)
        .lte('invoice_date', endDate)
        .eq('invoice_type', 'regular')
        .order('invoice_date', { ascending: true });

    if (error) {
        console.error('Error fetching GSTR-1:', error);
        return { b2b: [], b2c: [], summary: {} };
    }

    const b2b: GSTR1Row[] = [];
    const b2c: GSTR1Row[] = [];

    (invoices || []).forEach((inv: any) => {
        const row: GSTR1Row = {
            invoiceNumber: inv.invoice_number,
            invoiceDate: format(new Date(inv.invoice_date), 'dd-MMM-yyyy'),
            buyerName: inv.buyer_name,
            buyerGstin: inv.buyer_gstin || '',
            placeOfSupply: inv.place_of_supply || inv.buyer_state_code,
            invoiceType: 'Regular B2B',
            taxableValue: inv.taxable_value,
            cgstRate: inv.cgst_amount > 0 ? 1.5 : 0,
            cgstAmount: inv.cgst_amount,
            sgstRate: inv.sgst_amount > 0 ? 1.5 : 0,
            sgstAmount: inv.sgst_amount,
            igstRate: inv.igst_amount > 0 ? 3 : 0,
            igstAmount: inv.igst_amount,
            invoiceValue: inv.grand_total,
            reverseCharge: inv.is_reverse_charge ? 'Y' : 'N',
        };

        // B2B if buyer has GSTIN, else B2C
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
}

// ===========================================
// STOCK REPORT
// ===========================================

export async function getStockReport(): Promise<{
    rows: StockReportRow[];
    summary: { totalProducts: number; lowStock: number; totalValue: number };
}> {
    const { data, error } = await supabase
        .from('product_variants')
        .select(`
            id,
            variant_name,
            sku_suffix,
            stock_level,
            cost_price,
            selling_price,
            updated_at,
            product:products(
                id,
                name,
                sku,
                category
            )
        `)
        .order('stock_level', { ascending: true });

    if (error) {
        console.error('Error fetching stock report:', error);
        return { rows: [], summary: { totalProducts: 0, lowStock: 0, totalValue: 0 } };
    }

    const rows: StockReportRow[] = (data || []).map((v: any) => ({
        productId: v.product?.id,
        productName: v.product?.name || 'Unknown',
        sku: v.product?.sku + (v.sku_suffix ? `-${v.sku_suffix}` : ''),
        variantName: v.variant_name || 'Default',
        category: v.product?.category,
        currentStock: v.stock_level || 0,
        reorderLevel: 10, // Default, could be from settings
        lastUpdated: v.updated_at ? format(new Date(v.updated_at), 'dd/MM/yyyy') : '-',
        stockValue: (v.stock_level || 0) * (v.cost_price || 0),
    }));

    const summary = {
        totalProducts: rows.length,
        lowStock: rows.filter((r) => r.currentStock < r.reorderLevel).length,
        totalValue: rows.reduce((sum, r) => sum + r.stockValue, 0),
    };

    return { rows, summary };
}

// ===========================================
// HSN SUMMARY (for GST filing)
// ===========================================

export async function getHSNSummary(
    startDate: string,
    endDate: string
): Promise<{ hsnCode: string; description: string; quantity: number; taxableValue: number; tax: number }[]> {
    const { data, error } = await supabase
        .from('invoice_items')
        .select(`
            hsn_code,
            description,
            quantity,
            taxable_amount,
            cgst_amount,
            sgst_amount,
            igst_amount,
            invoice:invoices!inner(invoice_date)
        `)
        .gte('invoice.invoice_date', startDate)
        .lte('invoice.invoice_date', endDate);

    if (error) {
        console.error('Error fetching HSN summary:', error);
        return [];
    }

    // Group by HSN
    const byHSN = new Map<string, { description: string; quantity: number; taxableValue: number; tax: number }>();

    (data || []).forEach((item: any) => {
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
                // Escape commas and quotes
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
