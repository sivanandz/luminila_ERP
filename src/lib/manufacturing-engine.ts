/**
 * Karigar & Artisan BOM & Manufacturing Assembly Engine
 * Reverse-engineered from Vyapar BizLogic (ItemManufactureTransaction.js,
 * ManufacturingRawMaterial.js, ManufacturingAdditionalCost.js)
 * and tailored for High-Purity Indian Jewelry Manufacturing (BIS / Legal Metrology).
 */

import { validateHUID, roundGrams } from './jewelry-engine';

export type RawMaterialType =
    | 'gold_bullion'
    | 'gold_scrap'
    | 'silver'
    | 'alloy'
    | 'diamond'
    | 'gemstone'
    | 'solder'
    | 'other';

export interface RawMaterialInput {
    id?: string;
    variantId: string;
    name: string;
    materialType: RawMaterialType;
    quantity: number; // in grams for metals, carats for gems/diamonds, pcs for solder
    unit: 'g' | 'ct' | 'pcs';
    purityKarat?: string; // '24K', '22K', '18K', '999', '916' etc.
    unitCostPrice: number; // cost per gram or per carat
    totalCost?: number; // quantity * unitCostPrice (calculated)
}

/**
 * Direct 1:1 mapping of Vyapar Additional Costs (ac1..ac5)
 * ac1: Labour / Karigar Making Charges
 * ac2: Hallmarking & Refining Cost
 * ac3: Finishing & Packaging Charges
 * ac4: Logistics & Transit Insurance
 * ac5: Certification (IGI/GIA) & Other Charges
 */
export interface ManufacturingAdditionalCosts {
    ac1_labour: number;
    ac2_hallmarking: number;
    ac3_finishing: number;
    ac4_logistics: number;
    ac5_certification_other: number;
    paymentType?: string; // 'cash' | 'bank' | 'karigar_ledger'
    referenceNumber?: string;
}

export interface ScrapRecoveryOutput {
    variantId?: string;
    name: string;
    recoveredWeightGrams: number; // 3 decimal places
    purityKarat: string;
    valuationRatePerGram: number; // credit per gram
    totalRecoveryValue?: number; // calculated
}

export interface FinishedItemOutput {
    productId?: string;
    variantId: string;
    productName: string;
    quantityProduced: number; // e.g. 1 ring, 5 bangles
    grossWeightGrams: number;
    netWeightGrams: number;
    stoneWeightGrams?: number;
    stoneWeightCarats?: number;
    purityKarat: string;
    huidCode?: string;
    unitCostPrice?: number; // calculated
}

export interface ManufacturingOrder {
    orderNumber: string;
    artisanKarigarId?: string;
    artisanKarigarName: string;
    orderDate: string; // ISO date
    status: 'draft' | 'in_progress' | 'completed' | 'cancelled';
    rawMaterials: RawMaterialInput[];
    additionalCosts: ManufacturingAdditionalCosts;
    finishedItems: FinishedItemOutput[];
    scrapRecoveries?: ScrapRecoveryOutput[];
    allowedLossTolerancePercent?: number; // Default 1.0% for gold casting/smithing
    notes?: string;
}

export interface MetalLossReconciliation {
    totalInputMetalGrams: number;
    totalFinishedNetMetalGrams: number;
    totalScrapRecoveredGrams: number;
    unrecoveredMeltingLossGrams: number;
    meltingLossPercent: number;
    allowedTolerancePercent: number;
    allowedLossGrams: number;
    varianceGrams: number; // positive = excess loss beyond tolerance
    isWithinTolerance: boolean;
}

export interface ManufacturingAssemblyResult {
    success: boolean;
    orderNumber: string;
    totalRawMaterialsCost: number;
    totalAdditionalCosts: number;
    grossProductionCost: number;
    totalScrapRecoveryCredit: number;
    netProductionCost: number;
    costPerFinishedUnit: number;
    reconciliation: MetalLossReconciliation;
    stockAdjustments: {
        rawMaterialDeductions: Array<{
            variantId: string;
            name: string;
            quantity: number;
            unit: string;
            costDeducted: number;
        }>;
        finishedGoodsAdditions: Array<{
            variantId: string;
            name: string;
            quantity: number;
            grossWeight: number;
            netWeight: number;
            purity: string;
            calculatedUnitCost: number;
            totalValuation: number;
            huidCode?: string;
        }>;
        scrapAdditions: Array<{
            name: string;
            recoveredWeight: number;
            creditedValue: number;
        }>;
    };
    errors: string[];
}

/**
 * Calculate total overheads (ac1 + ac2 + ac3 + ac4 + ac5)
 */
export function calculateTotalAdditionalCosts(ac: ManufacturingAdditionalCosts): number {
    const ac1 = Math.max(0, Number(ac.ac1_labour) || 0);
    const ac2 = Math.max(0, Number(ac.ac2_hallmarking) || 0);
    const ac3 = Math.max(0, Number(ac.ac3_finishing) || 0);
    const ac4 = Math.max(0, Number(ac.ac4_logistics) || 0);
    const ac5 = Math.max(0, Number(ac.ac5_certification_other) || 0);
    return Math.round((ac1 + ac2 + ac3 + ac4 + ac5) * 100) / 100;
}

/**
 * Calculate total raw material cost
 */
export function calculateRawMaterialsCost(materials: RawMaterialInput[]): number {
    let total = 0;
    for (const m of materials) {
        const qty = Math.max(0, Number(m.quantity) || 0);
        const rate = Math.max(0, Number(m.unitCostPrice) || 0);
        total += qty * rate;
    }
    return Math.round(total * 100) / 100;
}

/**
 * Reconcile metal weight balance
 * Input Metal = Finished Net Metal + Recovered Scrap + Burning/Melting Loss
 */
export function reconcileMetalBalance(
    rawMaterials: RawMaterialInput[],
    finishedItems: FinishedItemOutput[],
    scrapRecoveries: ScrapRecoveryOutput[] = [],
    allowedTolerancePercent: number = 1.0
): MetalLossReconciliation {
    // Only metals count towards metal weight balance (ignore standalone stones/diamonds)
    const metalMaterials = rawMaterials.filter(
        m => m.materialType !== 'diamond' && m.materialType !== 'gemstone'
    );

    const totalInputMetalGrams = roundGrams(
        metalMaterials.reduce((sum, m) => sum + (Number(m.quantity) || 0), 0)
    );

    const totalFinishedNetMetalGrams = roundGrams(
        finishedItems.reduce((sum, item) => sum + (Number(item.netWeightGrams) || 0), 0)
    );

    const totalScrapRecoveredGrams = roundGrams(
        scrapRecoveries.reduce((sum, s) => sum + (Number(s.recoveredWeightGrams) || 0), 0)
    );

    const accountForMetal = roundGrams(totalFinishedNetMetalGrams + totalScrapRecoveredGrams);
    const unrecoveredMeltingLossGrams = roundGrams(Math.max(0, totalInputMetalGrams - accountForMetal));

    const meltingLossPercent = totalInputMetalGrams > 0
        ? Math.round(((unrecoveredMeltingLossGrams / totalInputMetalGrams) * 100) * 1000) / 1000
        : 0;

    const allowedLossGrams = roundGrams((totalInputMetalGrams * allowedTolerancePercent) / 100);
    const varianceGrams = roundGrams(unrecoveredMeltingLossGrams - allowedLossGrams);
    const isWithinTolerance = unrecoveredMeltingLossGrams <= allowedLossGrams;

    return {
        totalInputMetalGrams,
        totalFinishedNetMetalGrams,
        totalScrapRecoveredGrams,
        unrecoveredMeltingLossGrams,
        meltingLossPercent,
        allowedTolerancePercent,
        allowedLossGrams,
        varianceGrams,
        isWithinTolerance,
    };
}

/**
 * Validate manufacturing order before assembly
 */
export function validateManufacturingOrder(order: ManufacturingOrder): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!order.orderNumber || order.orderNumber.trim() === '') {
        errors.push('Order number is required.');
    }
    if (!order.artisanKarigarName || order.artisanKarigarName.trim() === '') {
        errors.push('Karigar / Artisan name is required.');
    }
    if (!order.rawMaterials || order.rawMaterials.length === 0) {
        errors.push('At least one raw material input is required.');
    } else {
        for (let i = 0; i < order.rawMaterials.length; i++) {
            const m = order.rawMaterials[i];
            if (!m.variantId) errors.push(`Raw material #${i + 1} variantId is required.`);
            if (m.quantity <= 0) errors.push(`Raw material #${i + 1} (${m.name || 'unnamed'}) quantity must be greater than 0.`);
            if (m.unitCostPrice < 0) errors.push(`Raw material #${i + 1} unitCostPrice cannot be negative.`);
        }
    }

    if (!order.finishedItems || order.finishedItems.length === 0) {
        errors.push('At least one finished item output is required.');
    } else {
        for (let i = 0; i < order.finishedItems.length; i++) {
            const item = order.finishedItems[i];
            if (!item.variantId) errors.push(`Finished item #${i + 1} variantId is required.`);
            if (item.quantityProduced <= 0) errors.push(`Finished item #${i + 1} quantityProduced must be >= 1.`);
            if (item.grossWeightGrams <= 0) errors.push(`Finished item #${i + 1} grossWeightGrams must be greater than 0.`);
            if (item.netWeightGrams <= 0) errors.push(`Finished item #${i + 1} netWeightGrams must be greater than 0.`);
            if (item.netWeightGrams > item.grossWeightGrams) {
                errors.push(`Finished item #${i + 1} netWeightGrams (${item.netWeightGrams}g) cannot exceed grossWeightGrams (${item.grossWeightGrams}g).`);
            }
            if (item.huidCode && !validateHUID(item.huidCode)) {
                errors.push(`Finished item #${i + 1} HUID "${item.huidCode}" is invalid. Must be exactly 6 alphanumeric characters.`);
            }
        }
    }

    // Metal conservation check: Finished metal + scrap cannot exceed total input metal
    const metalMaterials = (order.rawMaterials || []).filter(
        m => m.materialType !== 'diamond' && m.materialType !== 'gemstone'
    );
    const totalInput = metalMaterials.reduce((sum, m) => sum + (Number(m.quantity) || 0), 0);
    const totalOutputMetal = (order.finishedItems || []).reduce((sum, i) => sum + (Number(i.netWeightGrams) || 0), 0);
    const totalScrap = (order.scrapRecoveries || []).reduce((sum, s) => sum + (Number(s.recoveredWeightGrams) || 0), 0);

    if (roundGrams(totalOutputMetal + totalScrap) > roundGrams(totalInput)) {
        errors.push(`Physical metal violation: Total output metal (${roundGrams(totalOutputMetal + totalScrap)}g) exceeds input metal (${roundGrams(totalInput)}g).`);
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Execute Manufacturing Assembly
 * Calculates full costs, performs reconciliation, and generates atomic inventory adjustments.
 */
export function executeManufacturingAssembly(order: ManufacturingOrder): ManufacturingAssemblyResult {
    const validation = validateManufacturingOrder(order);
    if (!validation.valid) {
        return {
            success: false,
            orderNumber: order.orderNumber,
            totalRawMaterialsCost: 0,
            totalAdditionalCosts: 0,
            grossProductionCost: 0,
            totalScrapRecoveryCredit: 0,
            netProductionCost: 0,
            costPerFinishedUnit: 0,
            reconciliation: {
                totalInputMetalGrams: 0,
                totalFinishedNetMetalGrams: 0,
                totalScrapRecoveredGrams: 0,
                unrecoveredMeltingLossGrams: 0,
                meltingLossPercent: 0,
                allowedTolerancePercent: order.allowedLossTolerancePercent || 1.0,
                allowedLossGrams: 0,
                varianceGrams: 0,
                isWithinTolerance: false,
            },
            stockAdjustments: {
                rawMaterialDeductions: [],
                finishedGoodsAdditions: [],
                scrapAdditions: [],
            },
            errors: validation.errors,
        };
    }

    const rawMaterialsCost = calculateRawMaterialsCost(order.rawMaterials);
    const additionalCosts = calculateTotalAdditionalCosts(order.additionalCosts);
    const grossProductionCost = Math.round((rawMaterialsCost + additionalCosts) * 100) / 100;

    // Calculate Scrap Credit
    let totalScrapCredit = 0;
    const scrapAdditions: Array<{ name: string; recoveredWeight: number; creditedValue: number }> = [];

    for (const scrap of order.scrapRecoveries || []) {
        const wt = roundGrams(Math.max(0, Number(scrap.recoveredWeightGrams) || 0));
        const rate = Math.max(0, Number(scrap.valuationRatePerGram) || 0);
        const credit = Math.round((wt * rate) * 100) / 100;
        totalScrapCredit += credit;
        scrapAdditions.push({
            name: scrap.name || `Scrap Metal ${scrap.purityKarat}`,
            recoveredWeight: wt,
            creditedValue: credit,
        });
    }
    totalScrapCredit = Math.round(totalScrapCredit * 100) / 100;

    // Net Production Cost
    const netProductionCost = Math.max(0, Math.round((grossProductionCost - totalScrapCredit) * 100) / 100);

    // Finished Units
    const totalFinishedUnits = order.finishedItems.reduce((sum, item) => sum + item.quantityProduced, 0);
    const costPerFinishedUnit = totalFinishedUnits > 0
        ? Math.round((netProductionCost / totalFinishedUnits) * 100) / 100
        : 0;

    // Reconciliation
    const reconciliation = reconcileMetalBalance(
        order.rawMaterials,
        order.finishedItems,
        order.scrapRecoveries,
        order.allowedLossTolerancePercent ?? 1.0
    );

    // Inventory Deductions (Raw Materials)
    const rawMaterialDeductions = order.rawMaterials.map(m => ({
        variantId: m.variantId,
        name: m.name,
        quantity: -Math.abs(m.quantity),
        unit: m.unit,
        costDeducted: Math.round((m.quantity * m.unitCostPrice) * 100) / 100,
    }));

    // Inventory Additions (Finished Goods)
    // Weight-proportional cost allocation if multiple different finished products
    const totalFinishedWeight = order.finishedItems.reduce((sum, item) => sum + item.grossWeightGrams, 0);

    const finishedGoodsAdditions = order.finishedItems.map(item => {
        let allocatedCost: number;
        if (totalFinishedWeight > 0) {
            const weightShare = item.grossWeightGrams / totalFinishedWeight;
            allocatedCost = Math.round((netProductionCost * weightShare) * 100) / 100;
        } else {
            allocatedCost = Math.round((netProductionCost / order.finishedItems.length) * 100) / 100;
        }

        const unitCost = item.quantityProduced > 0
            ? Math.round((allocatedCost / item.quantityProduced) * 100) / 100
            : 0;

        return {
            variantId: item.variantId,
            name: item.productName,
            quantity: item.quantityProduced,
            grossWeight: item.grossWeightGrams,
            netWeight: item.netWeightGrams,
            purity: item.purityKarat,
            calculatedUnitCost: unitCost,
            totalValuation: allocatedCost,
            huidCode: item.huidCode,
        };
    });

    return {
        success: true,
        orderNumber: order.orderNumber,
        totalRawMaterialsCost: rawMaterialsCost,
        totalAdditionalCosts: additionalCosts,
        grossProductionCost,
        totalScrapRecoveryCredit: totalScrapCredit,
        netProductionCost,
        costPerFinishedUnit,
        reconciliation,
        stockAdjustments: {
            rawMaterialDeductions,
            finishedGoodsAdditions,
            scrapAdditions,
        },
        errors: [],
    };
}
