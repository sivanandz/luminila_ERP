/**
 * Luminila Mobile Printing Service
 * Handles Android Print Spooler (PDF / system printer dialog)
 * and ESC/POS thermal receipt formatting for 58mm / 80mm POS printers.
 */

export interface ReceiptItem {
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
    sku?: string;
}

export interface ReceiptData {
    storeName: string;
    storeAddress?: string;
    storeGstin?: string;
    storePhone?: string;
    invoiceNo: string;
    date: string;
    cashierName?: string;
    customerName?: string;
    customerPhone?: string;
    items: ReceiptItem[];
    subtotal: number;
    discountTotal: number;
    cgst: number;
    sgst: number;
    grandTotal: number;
    paymentMethod: string;
    footerMessage?: string;
}

export class MobilePrinter {
    /**
     * Trigger Android System Print Spooler
     * In Android Webview, window.print() opens the native Print Dialog
     * allowing the user to print to paired Bluetooth/Wi-Fi printers or save as PDF.
     */
    static printViaSystemSpooler(contentHtml: string) {
        if (typeof window === 'undefined') return;

        const printFrame = document.createElement('iframe');
        printFrame.style.position = 'fixed';
        printFrame.style.right = '0';
        printFrame.style.bottom = '0';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = '0';
        document.body.appendChild(printFrame);

        const frameDoc = printFrame.contentWindow?.document || printFrame.contentDocument;
        if (!frameDoc) return;

        frameDoc.open();
        frameDoc.write(`
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>Print Receipt</title>
                    <style>
                        @page {
                            margin: 0;
                            size: 80mm auto;
                        }
                        body {
                            font-family: monospace;
                            margin: 0;
                            padding: 8px;
                            width: 76mm;
                            font-size: 12px;
                            line-height: 1.3;
                            color: #000;
                            background: #fff;
                        }
                        .text-center { text-align: center; }
                        .text-right { text-align: right; }
                        .font-bold { font-weight: bold; }
                        .border-b { border-bottom: 1px dashed #000; margin: 6px 0; }
                        .border-t { border-top: 1px dashed #000; margin: 6px 0; }
                        .flex { display: flex; justify-content: space-between; }
                        .my-1 { margin: 4px 0; }
                    </style>
                </head>
                <body>
                    ${contentHtml}
                </body>
            </html>
        `);
        frameDoc.close();

        setTimeout(() => {
            printFrame.contentWindow?.focus();
            printFrame.contentWindow?.print();
            setTimeout(() => {
                document.body.removeChild(printFrame);
            }, 1000);
        }, 300);
    }

    /**
     * Format thermal receipt HTML for 80mm POS printers
     */
    static generate80mmReceiptHtml(data: ReceiptData): string {
        return `
            <div class="text-center font-bold" style="font-size: 15px;">${data.storeName}</div>
            ${data.storeAddress ? `<div class="text-center" style="font-size: 10px;">${data.storeAddress}</div>` : ''}
            ${data.storePhone ? `<div class="text-center" style="font-size: 10px;">Tel: ${data.storePhone}</div>` : ''}
            ${data.storeGstin ? `<div class="text-center font-bold" style="font-size: 10px;">GSTIN: ${data.storeGstin}</div>` : ''}
            
            <div class="border-b"></div>
            
            <div class="flex"><span>Invoice:</span><span class="font-bold">${data.invoiceNo}</span></div>
            <div class="flex"><span>Date:</span><span>${data.date}</span></div>
            ${data.cashierName ? `<div class="flex"><span>Cashier:</span><span>${data.cashierName}</span></div>` : ''}
            ${data.customerName ? `<div class="flex"><span>Customer:</span><span>${data.customerName}</span></div>` : ''}

            <div class="border-b"></div>

            <div class="flex font-bold" style="font-size: 11px;">
                <span style="flex: 2;">Item</span>
                <span style="flex: 1; text-align: center;">Qty</span>
                <span style="flex: 1; text-align: right;">Amount</span>
            </div>
            
            <div class="border-b"></div>

            ${data.items
                .map(
                    (it) => `
                <div class="my-1">
                    <div class="font-bold">${it.name}</div>
                    <div class="flex" style="font-size: 11px; opacity: 0.9;">
                        <span>${it.sku || ''}</span>
                        <span>${it.quantity} x ₹${it.unitPrice.toFixed(2)}</span>
                        <span class="text-right">₹${it.total.toFixed(2)}</span>
                    </div>
                </div>
            `
                )
                .join('')}

            <div class="border-t"></div>

            <div class="flex"><span>Subtotal:</span><span>₹${data.subtotal.toFixed(2)}</span></div>
            ${data.discountTotal > 0 ? `<div class="flex"><span>Discount:</span><span>-₹${data.discountTotal.toFixed(2)}</span></div>` : ''}
            ${data.cgst > 0 ? `<div class="flex"><span>CGST:</span><span>₹${data.cgst.toFixed(2)}</span></div>` : ''}
            ${data.sgst > 0 ? `<div class="flex"><span>SGST:</span><span>₹${data.sgst.toFixed(2)}</span></div>` : ''}
            
            <div class="border-b"></div>

            <div class="flex font-bold" style="font-size: 14px;">
                <span>GRAND TOTAL:</span>
                <span>₹${data.grandTotal.toFixed(2)}</span>
            </div>
            <div class="flex font-bold"><span>Payment:</span><span>${data.paymentMethod.toUpperCase()}</span></div>

            <div class="border-t"></div>
            <div class="text-center font-bold" style="margin-top: 8px;">${data.footerMessage || 'Thank you for shopping with Luminila!'}</div>
            <div class="text-center" style="font-size: 9px; opacity: 0.8; margin-top: 4px;">Fashion Jewelry ERP Powered by Luminila</div>
        `;
    }
}
