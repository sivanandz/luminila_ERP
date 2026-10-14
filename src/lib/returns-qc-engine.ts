/**
 * Reverse Logistics, Customer Returns & Inward QC Engine
 * Reverse-engineered from Vasy.ai Omnichannel Return Management features.
 * 
 * Supports:
 * - Return Merchandise Authorization (RMA) & Courier RTO intake
 * - Multi-tier Inward Quality Control (QC) grading
 * - Automated inventory routing (Grade A Restock, Karigar Repair, Damaged Write-off)
 * - Restocking fee & reverse logistics deductions
 * - Credit Note / refund payload compilation
 */

export type ReturnReason =
    | 'transit_damage'
    | 'size_fit_issue'
    | 'manufacturing_defect'
    | 'customer_remorse'
    | 'rto_undelivered';

export type QcDispositionGrade =
    | 'restock_grade_a'   // Pristine condition -> Return to sellable stock
    | 'karigar_repair'    // Minor defect -> Send to artisan for replating/stone reset
    | 'damaged_writeoff'; // Total loss -> Scrap recovery / expense write-off

export interface ReturnedItemInput {
    variantId: string;
    productName: string;
    quantityReturned: number;
    unitPrice: number;
    taxRate: number;
    returnReason: ReturnReason;
}

export interface InwardQcInspectionRequest {
    returnNumber: string;
    originalInvoiceNumber: string;
    customerName: string;
    customerGstin?: string;
    returnedItems: ReturnedItemInput[];
    dispositionGrade: QcDispositionGrade;
    reverseShippingFeeDeduction?: number;
    restockingFeePercent?: number; // e.g. 5% or 10% for non-defect returns
    inspectorNotes?: string;
    repairCostEstimate?: number;
}

export interface QcInspectionResult {
    success: boolean;
    returnNumber: string;
    dispositionGrade: QcDispositionGrade;
    grossReturnAmount: number;
    totalDeductions: number;
    netRefundCreditAmount: number;
    inventoryActions: Array<{
        variantId: string;
        action: 'restock' | 'route_to_karigar' | 'write_off_scrap';
        quantity: number;
        targetLocation: string;
    }>;
    creditNotePayload: {
        creditNoteNumber: string;
        originalInvoiceNumber: string;
        customerName: string;
        taxableValue: number;
        taxAmount: number;
        grandTotal: number;
    };
    inspectorSummary: string;
}

/**
 * Executes inward QC inspection on returned goods and determines inventory & financial routing
 */
export function executeInwardQcInspection(
    req: InwardQcInspectionRequest,
    seqNumber: number = 1
): QcInspectionResult {
    let grossTotal = 0;
    let taxableTotal = 0;
    let taxTotal = 0;

    for (const itm of req.returnedItems) {
        const lineTotal = itm.quantityReturned * itm.unitPrice;
        grossTotal += lineTotal;
        const taxVal = Math.round((lineTotal / (1 + itm.taxRate / 100)) * 100) / 100;
        taxableTotal += taxVal;
        taxTotal += Math.round((lineTotal - taxVal) * 100) / 100;
    }

    grossTotal = Math.round(grossTotal * 100) / 100;

    // Deductions (only applied if not manufacturing defect / transit damage)
    let deductions = 0;
    const isStoreFault = req.returnedItems.some(
        i => i.returnReason === 'manufacturing_defect' || i.returnReason === 'transit_damage'
    );

    if (!isStoreFault) {
        const reverseShipping = Math.max(0, req.reverseShippingFeeDeduction || 0);
        const restockPercent = Math.min(50, Math.max(0, req.restockingFeePercent || 0));
        const restockFee = Math.round((grossTotal * (restockPercent / 100)) * 100) / 100;
        deductions = Math.round((reverseShipping + restockFee) * 100) / 100;
    }

    const netRefund = Math.max(0, Math.round((grossTotal - deductions) * 100) / 100);

    // Determine inventory actions based on QC Grade
    const inventoryActions = req.returnedItems.map(itm => {
        let action: 'restock' | 'route_to_karigar' | 'write_off_scrap';
        let targetLocation: string;

        switch (req.dispositionGrade) {
            case 'restock_grade_a':
                action = 'restock';
                targetLocation = 'Main Showroom Inventory';
                break;
            case 'karigar_repair':
                action = 'route_to_karigar';
                targetLocation = 'Karigar Workshop Buffer';
                break;
            case 'damaged_writeoff':
                action = 'write_off_scrap';
                targetLocation = 'Damaged Scrap Bin (Write-off)';
                break;
        }

        return {
            variantId: itm.variantId,
            action,
            quantity: itm.quantityReturned,
            targetLocation,
        };
    });

    const dateStr = new Date().toISOString().substring(0, 10).replace(/-/g, '');
    const creditNoteNumber = `CN-${dateStr}-${String(seqNumber).padStart(3, '0')}`;

    let summary = '';
    if (req.dispositionGrade === 'restock_grade_a') {
        summary = `QC PASSED: Restocked ${req.returnedItems.length} SKU(s) into primary inventory. Credit Note ₹${netRefund} issued.`;
    } else if (req.dispositionGrade === 'karigar_repair') {
        summary = `QC REPAIR: Sent to artisan for reconditioning (Est. repair: ₹${req.repairCostEstimate || 0}). Credit Note ₹${netRefund} issued.`;
    } else {
        summary = `QC SCRAP WRITE-OFF: Items damaged beyond recovery. Written off to shrinkage expense. Credit Note ₹${netRefund} issued.`;
    }

    return {
        success: true,
        returnNumber: req.returnNumber,
        dispositionGrade: req.dispositionGrade,
        grossReturnAmount: grossTotal,
        totalDeductions: deductions,
        netRefundCreditAmount: netRefund,
        inventoryActions,
        creditNotePayload: {
            creditNoteNumber,
            originalInvoiceNumber: req.originalInvoiceNumber,
            customerName: req.customerName,
            taxableValue: Math.round((netRefund / 1.03) * 100) / 100,
            taxAmount: Math.round((netRefund - netRefund / 1.03) * 100) / 100,
            grandTotal: netRefund,
        },
        inspectorSummary: summary,
    };
}
