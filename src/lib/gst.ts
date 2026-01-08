/**
 * GST Utilities for Indian Tax Compliance
 * Jewelry: 3% GST (1.5% CGST + 1.5% SGST for intra-state)
 * Making Charges: 5% GST (if billed separately)
 */

import { type DeliveryChallan } from './challan';

// ===========================================
// GST RATES
// ===========================================
export const GST_RATES = {
    JEWELRY: 3.0,           // Gold, Silver, Platinum jewelry
    MAKING_CHARGES: 5.0,    // Making/labor charges
    PRECIOUS_STONES: 0.25,  // Rough diamonds
    IMITATION: 18.0,        // Imitation jewelry
} as const;

// ===========================================
// HSN CODES (Harmonized System of Nomenclature)
// ===========================================
export const HSN_CODES = {
    // Chapter 71 - Precious metals and jewelry
    GOLD_JEWELRY_STUDDED: '711311',     // Gold jewelry studded with gems
    GOLD_JEWELRY_PLAIN: '711319',       // Plain gold jewelry
    GOLD_UNSTUDDED: '71131910',         // Unstudded gold jewelry
    GOLD_WITH_PEARL: '71131920',        // Gold jewelry set with pearls
    GOLD_WITH_DIAMOND: '71131930',      // Gold jewelry set with diamonds
    GOLD_WITH_STONES: '71131940',       // Gold with other precious stones
    SILVER_JEWELRY: '711311',           // Silver jewelry
    SILVER_FILIGREE: '71131110',        // Silver filigree work
    PLATINUM_JEWELRY: '711311',         // Platinum jewelry
    IMITATION_JEWELRY: '711790',        // Imitation jewelry

    // Raw metals (for purchase)
    GOLD_UNWROUGHT: '710812',           // Gold unwrought/semi-manufactured
    SILVER_UNWROUGHT: '710691',         // Silver unwrought

    // Default for jewelry
    DEFAULT: '7113',
} as const;

// ===========================================
// INDIAN STATE CODES (for GST)
// ===========================================
export const STATE_CODES: Record<string, string> = {
    'Andhra Pradesh': '37',
    'Arunachal Pradesh': '12',
    'Assam': '18',
    'Bihar': '10',
    'Chhattisgarh': '22',
    'Goa': '30',
    'Gujarat': '24',
    'Haryana': '06',
    'Himachal Pradesh': '02',
    'Jharkhand': '20',
    'Karnataka': '29',
    'Kerala': '32',
    'Madhya Pradesh': '23',
    'Maharashtra': '27',
    'Manipur': '14',
    'Meghalaya': '17',
    'Mizoram': '15',
    'Nagaland': '13',
    'Odisha': '21',
    'Punjab': '03',
    'Rajasthan': '08',
    'Sikkim': '11',
    'Tamil Nadu': '33',
    'Telangana': '36',
    'Tripura': '16',
    'Uttar Pradesh': '09',
    'Uttarakhand': '05',
    'West Bengal': '19',
    'Delhi': '07',
    'Jammu and Kashmir': '01',
    'Ladakh': '38',
    'Puducherry': '34',
    'Chandigarh': '04',
    'Dadra and Nagar Haveli and Daman and Diu': '26',
    'Lakshadweep': '31',
    'Andaman and Nicobar Islands': '35',
};

export function getStateCode(stateName: string): string {
    return STATE_CODES[stateName] || '';
}

export function getStateName(stateCode: string): string {
    return Object.entries(STATE_CODES).find(([, code]) => code === stateCode)?.[0] || '';
}

// ===========================================
// GST CALCULATION
// ===========================================
export interface GSTCalculation {
    taxableAmount: number;
    cgstRate: number;
    cgstAmount: number;
    sgstRate: number;
    sgstAmount: number;
    igstRate: number;
    igstAmount: number;
    cessRate: number;
    cessAmount: number;
    totalTax: number;
    grandTotal: number;
    isInterState: boolean;
}

export function calculateGST(
    taxableAmount: number,
    sellerStateCode: string,
    buyerStateCode: string,
    gstRate: number = GST_RATES.JEWELRY,
    cessRate: number = 0
): GSTCalculation {
    const isInterState = sellerStateCode !== buyerStateCode && buyerStateCode !== '';

    let cgstRate = 0;
    let sgstRate = 0;
    let igstRate = 0;

    if (isInterState) {
        // Inter-state: IGST only
        igstRate = gstRate;
    } else {
        // Intra-state: CGST + SGST (split equally)
        cgstRate = gstRate / 2;
        sgstRate = gstRate / 2;
    }

    const cgstAmount = roundToTwo(taxableAmount * (cgstRate / 100));
    const sgstAmount = roundToTwo(taxableAmount * (sgstRate / 100));
    const igstAmount = roundToTwo(taxableAmount * (igstRate / 100));
    const cessAmount = roundToTwo(taxableAmount * (cessRate / 100));

    const totalTax = roundToTwo(cgstAmount + sgstAmount + igstAmount + cessAmount);
    const grandTotal = roundToTwo(taxableAmount + totalTax);

    return {
        taxableAmount: roundToTwo(taxableAmount),
        cgstRate,
        cgstAmount,
        sgstRate,
        sgstAmount,
        igstRate,
        igstAmount,
        cessRate,
        cessAmount,
        totalTax,
        grandTotal,
        isInterState,
    };
}

// ===========================================
// AMOUNT TO WORDS (Indian Numbering System)
// ===========================================
const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
];

const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
];

function convertToWords(num: number): string {
    if (num === 0) return '';
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + convertToWords(num % 100) : '');
    if (num < 100000) return convertToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + convertToWords(num % 1000) : '');
    if (num < 10000000) return convertToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + convertToWords(num % 100000) : '');
    return convertToWords(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 ? ' ' + convertToWords(num % 10000000) : '');
}

export function amountToWords(amount: number, currency: string = 'Rupees'): string {
    if (amount === 0) return `Zero ${currency} Only`;

    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);

    let result = '';

    if (rupees > 0) {
        result = convertToWords(rupees) + ` ${currency}`;
    }

    if (paise > 0) {
        result += (rupees > 0 ? ' and ' : '') + convertToWords(paise) + ' Paise';
    }

    return result + ' Only';
}

export const toWords = amountToWords;

// ===========================================
// GSTIN VALIDATION
// ===========================================
export function validateGSTIN(gstin: string): { valid: boolean; message: string } {
    if (!gstin) {
        return { valid: true, message: '' }; // Optional field
    }

    gstin = gstin.toUpperCase().trim();

    if (gstin.length !== 15) {
        return { valid: false, message: 'GSTIN must be 15 characters' };
    }

    // Format: 22AAAAA0000A1Z5
    // First 2: State code
    // Next 10: PAN
    // 13th: Entity number
    // 14th: Z (default)
    // 15th: Checksum

    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

    if (!gstinRegex.test(gstin)) {
        return { valid: false, message: 'Invalid GSTIN format' };
    }

    const stateCode = gstin.substring(0, 2);
    if (!Object.values(STATE_CODES).includes(stateCode)) {
        return { valid: false, message: 'Invalid state code in GSTIN' };
    }

    return { valid: true, message: '' };
}

// ===========================================
// HELPERS
// ===========================================
function roundToTwo(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function formatINR(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
}

export function formatQuantity(qty: number): string {
    return qty % 1 === 0 ? qty.toString() : qty.toFixed(3);
}

// ===========================================
// HSN CODE HELPERS
// ===========================================
export function getHSNForProduct(category?: string, material?: string): string {
    if (!category && !material) return HSN_CODES.DEFAULT;

    const lowerMaterial = (material || '').toLowerCase();

    if (lowerMaterial.includes('gold')) {
        return HSN_CODES.GOLD_JEWELRY_PLAIN;
    }
    if (lowerMaterial.includes('silver')) {
        return HSN_CODES.SILVER_JEWELRY;
    }
    if (lowerMaterial.includes('imitation') || lowerMaterial.includes('artificial')) {
        return HSN_CODES.IMITATION_JEWELRY;
    }

    return HSN_CODES.DEFAULT;
}

export function getGSTRateForHSN(hsn: string): number {
    if (hsn.startsWith('7117')) return GST_RATES.IMITATION;
    if (hsn.startsWith('7113')) return GST_RATES.JEWELRY;
    if (hsn.startsWith('7113')) return GST_RATES.JEWELRY;
    return GST_RATES.JEWELRY;
}

// ===========================================
// E-WAY BILL JSON EXPORT
// ===========================================

export interface EWayBillDetails {
    transporterId?: string;
    transporterName?: string;
    transDocNo?: string;
    transDocDate?: string;
    vehicleNo?: string;
    vehicleType?: 'R' | 'O'; // Regular / Over Dimensional
    distance: number;
}

export type EWayBillDocument = any | DeliveryChallan;

export function generateEWayBillJSON(
    document: EWayBillDocument,
    supplierGstin: string,
    ewbDetails: EWayBillDetails
): any {
    // Determine if it's an invoice or challan
    const isChallan = 'challan_number' in document;

    // Common fields
    const docNumber = isChallan ? document.challan_number : document.invoice_number;
    const docDateRaw = isChallan ? document.challan_date : document.invoice_date;
    const supplyType = isChallan ? 'O' : 'O'; // Outward
    const subSupplyType = isChallan ? '8' : '1'; // 8 for 'Others' (Challan), 1 for Supply (Invoice)
    const docType = isChallan ? 'CHL' : 'INV';

    // Mapping Names
    const fromTradeName = isChallan
        ? (document.consignor_name || 'Luminila Jewelry')
        : 'Luminila Jewelry';

    const toTradeName = isChallan
        ? document.consignee_name
        : document.buyer_name;

    const toGstin = (isChallan ? document.consignee_gstin : document.buyer_gstin) || 'URP';
    const toAddr1 = (isChallan ? document.consignee_address : document.buyer_address) || '';
    const toPlace = (isChallan ? document.place_of_supply : document.place_of_supply) || '';
    const toPincode = Number((isChallan ? 0 : document.buyer_pincode) || 0) || 100000;
    const toStateCode = Number((isChallan ? document.consignee_state_code : document.buyer_state_code) || 0);

    const docDate = new Date(docDateRaw).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }); // dd/mm/yyyy

    // Items
    const itemList = (document.items || []).map((item: any) => {
        const taxable = item.taxable_value || item.taxable_amount || 0;
        const totalTax = (item.cgst_amount || 0) + (item.sgst_amount || 0) + (item.igst_amount || 0);

        let rate = 0;
        if (taxable > 0) rate = Math.round((totalTax / taxable) * 100);

        return {
            productName: item.description || 'Jewelry',
            productDesc: item.description || 'Jewelry',
            hsnCode: Number(item.hsn_code || '7113'),
            quantity: item.quantity,
            qtyUnit: item.unit || 'GMS',
            taxableAmount: taxable,
            sgstRate: (item.sgst_amount || 0) > 0 ? rate / 2 : 0,
            cgstRate: (item.cgst_amount || 0) > 0 ? rate / 2 : 0,
            igstRate: (item.igst_amount || 0) > 0 ? rate : 0,
            cessRate: 0,
        };
    });

    const totalTaxable = itemList.reduce((sum: number, item: any) => sum + item.taxableAmount, 0);
    const totalCGST = document.cgst_amount || 0;
    const totalSGST = document.sgst_amount || 0;
    const totalIGST = document.igst_amount || 0;

    return {
        supplyType,
        subSupplyType,
        docType,
        docNo: docNumber,
        docDate,
        fromGstin: supplierGstin,
        fromTrdName: fromTradeName,
        fromAddr1: 'Main Street', // Ideally from settings
        fromAddr2: '',
        fromPlace: 'City', // Ideally from settings
        fromPincode: 560001, // Ideally from settings
        fromStateCode: Number(supplierGstin.substring(0, 2)),

        toGstin,
        toTrdName: toTradeName,
        toAddr1: toAddr1,
        toAddr2: '',
        toPlace: toPlace,
        toPincode,
        toStateCode,

        totalValue: totalTaxable,
        cgstValue: totalCGST,
        sgstValue: totalSGST,
        igstValue: totalIGST,
        cessValue: 0,
        transDistance: ewbDetails.distance,
        transporterId: ewbDetails.transporterId || '',
        transporterName: ewbDetails.transporterName || '',
        transDocNo: ewbDetails.transDocNo || '',
        transDocDate: ewbDetails.transDocDate || '',
        vehicleNo: ewbDetails.vehicleNo || '',
        vehicleType: ewbDetails.vehicleType || 'R',
        itemList: itemList,
    };
}
