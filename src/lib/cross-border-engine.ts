/**
 * Cross-Border Multi-Currency & Statutory LUT Export Engine
 * Reverse-engineered from Vasy.ai Omnichannel Cross-Border E-Commerce features.
 * 
 * Supports:
 * - Multi-currency conversion for NRI & international jewelry retail (USD, GBP, EUR, AED, CAD, AUD, SGD)
 * - Real-time & administrative FX rate management
 * - Indian GST Letter of Undertaking (LUT) Zero-Rated export invoicing (Section 16 IGST Act)
 * - Port code & Shipping Bill statutory compliance
 */

export type ForeignCurrency = 'USD' | 'GBP' | 'EUR' | 'AED' | 'CAD' | 'AUD' | 'SGD';

export interface CurrencyConfig {
    code: ForeignCurrency;
    symbol: string;
    label: string;
    defaultExchangeRateToInr: number; // 1 Foreign Currency = X INR
}

export const SUPPORTED_CURRENCIES: Record<ForeignCurrency, CurrencyConfig> = {
    USD: { code: 'USD', symbol: '$', label: 'US Dollar', defaultExchangeRateToInr: 83.50 },
    GBP: { code: 'GBP', symbol: '£', label: 'British Pound', defaultExchangeRateToInr: 108.20 },
    EUR: { code: 'EUR', symbol: '€', label: 'Euro', defaultExchangeRateToInr: 90.40 },
    AED: { code: 'AED', symbol: 'د.إ', label: 'UAE Dirham', defaultExchangeRateToInr: 22.75 },
    CAD: { code: 'CAD', symbol: 'CA$', label: 'Canadian Dollar', defaultExchangeRateToInr: 61.20 },
    AUD: { code: 'AUD', symbol: 'AU$', label: 'Australian Dollar', defaultExchangeRateToInr: 54.80 },
    SGD: { code: 'SGD', symbol: 'SG$', label: 'Singapore Dollar', defaultExchangeRateToInr: 62.50 },
};

export interface CrossBorderConversionResult {
    inrAmount: number;
    currency: ForeignCurrency;
    exchangeRate: number;
    foreignAmount: number;
    formattedDisplay: string;
}

export interface LutExportInvoiceRequest {
    invoiceNumber: string;
    invoiceDate: string;
    buyerName: string;
    buyerCountry: string;
    buyerAddress: string;
    currency: ForeignCurrency;
    exchangeRateToInr?: number;
    items: Array<{
        sku: string;
        description: string;
        hsnCode: string;
        quantity: number;
        unitPriceInr: number;
    }>;
    isLutExport: boolean; // True = 0% GST under LUT; False = Pay IGST with refund
    lutArnNumber?: string;
    portCode?: string; // e.g. "INBLR4" (Bangalore Air Cargo) or "INBOM4" (Mumbai)
    shippingBillNumber?: string;
    shippingBillDate?: string;
}

export interface StatutoryExportInvoice {
    invoiceNumber: string;
    invoiceDate: string;
    exportType: 'LUT_ZERO_RATED' | 'IGST_PAID_EXPORT';
    declarationText: string;
    currency: ForeignCurrency;
    exchangeRate: number;
    buyerDetails: {
        name: string;
        country: string;
        address: string;
    };
    lutDetails?: {
        arnNumber: string;
        portCode: string;
        shippingBillNumber?: string;
        shippingBillDate?: string;
    };
    lineItems: Array<{
        sku: string;
        description: string;
        hsnCode: string;
        quantity: number;
        unitPriceForeign: number;
        totalForeign: number;
        unitPriceInr: number;
        totalInr: number;
        gstRatePercent: number;
        gstAmountInr: number;
    }>;
    totals: {
        foreignSubtotal: number;
        foreignGrandTotal: number;
        inrSubtotal: number;
        inrGstTotal: number;
        inrGrandTotal: number;
    };
}

/**
 * Converts INR base amount to foreign currency
 */
export function convertInrToForeign(
    inrAmount: number,
    targetCurrency: ForeignCurrency,
    customRate?: number
): CrossBorderConversionResult {
    const cfg = SUPPORTED_CURRENCIES[targetCurrency] || SUPPORTED_CURRENCIES.USD;
    const rate = customRate && customRate > 0 ? customRate : cfg.defaultExchangeRateToInr;

    const foreign = Math.round((inrAmount / rate) * 100) / 100;

    return {
        inrAmount,
        currency: targetCurrency,
        exchangeRate: rate,
        foreignAmount: foreign,
        formattedDisplay: `${cfg.symbol}${foreign.toFixed(2)} ${cfg.code}`,
    };
}

/**
 * Converts foreign currency amount back to domestic INR
 */
export function convertForeignToInr(
    foreignAmount: number,
    currency: ForeignCurrency,
    customRate?: number
): number {
    const cfg = SUPPORTED_CURRENCIES[currency] || SUPPORTED_CURRENCIES.USD;
    const rate = customRate && customRate > 0 ? customRate : cfg.defaultExchangeRateToInr;
    return Math.round((foreignAmount * rate) * 100) / 100;
}

/**
 * Compiles an official Indian GST Letter of Undertaking (LUT) Export Invoice
 */
export function compileLutExportInvoice(req: LutExportInvoiceRequest): StatutoryExportInvoice {
    const cfg = SUPPORTED_CURRENCIES[req.currency] || SUPPORTED_CURRENCIES.USD;
    const rate = req.exchangeRateToInr && req.exchangeRateToInr > 0
        ? req.exchangeRateToInr
        : cfg.defaultExchangeRateToInr;

    const exportType = req.isLutExport ? 'LUT_ZERO_RATED' : 'IGST_PAID_EXPORT';
    const declaration = req.isLutExport
        ? `SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING (LUT NO: ${req.lutArnNumber || 'APPLIED'}) WITHOUT PAYMENT OF INTEGRATED TAX (IGST).`
        : `SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX (IGST).`;

    let foreignSubtotal = 0;
    let inrSubtotal = 0;
    let inrGstTotal = 0;

    const lineItems = req.items.map(item => {
        const lineTotalInr = Math.round((item.quantity * item.unitPriceInr) * 100) / 100;
        const unitForeign = Math.round((item.unitPriceInr / rate) * 100) / 100;
        const lineForeign = Math.round((item.quantity * unitForeign) * 100) / 100;

        const gstRate = req.isLutExport ? 0 : 3.0;
        const gstAmtInr = req.isLutExport ? 0 : Math.round((lineTotalInr * (gstRate / 100)) * 100) / 100;

        foreignSubtotal += lineForeign;
        inrSubtotal += lineTotalInr;
        inrGstTotal += gstAmtInr;

        return {
            sku: item.sku,
            description: item.description,
            hsnCode: item.hsnCode,
            quantity: item.quantity,
            unitPriceForeign: unitForeign,
            totalForeign: lineForeign,
            unitPriceInr: item.unitPriceInr,
            totalInr: lineTotalInr,
            gstRatePercent: gstRate,
            gstAmountInr: gstAmtInr,
        };
    });

    foreignSubtotal = Math.round(foreignSubtotal * 100) / 100;
    inrSubtotal = Math.round(inrSubtotal * 100) / 100;
    inrGstTotal = Math.round(inrGstTotal * 100) / 100;

    return {
        invoiceNumber: req.invoiceNumber,
        invoiceDate: req.invoiceDate,
        exportType,
        declarationText: declaration,
        currency: req.currency,
        exchangeRate: rate,
        buyerDetails: {
            name: req.buyerName,
            country: req.buyerCountry,
            address: req.buyerAddress,
        },
        lutDetails: req.isLutExport ? {
            arnNumber: req.lutArnNumber || 'LUT-UNASSIGNED',
            portCode: req.portCode || 'INBLR4',
            shippingBillNumber: req.shippingBillNumber,
            shippingBillDate: req.shippingBillDate,
        } : undefined,
        lineItems,
        totals: {
            foreignSubtotal,
            foreignGrandTotal: foreignSubtotal,
            inrSubtotal,
            inrGstTotal,
            inrGrandTotal: Math.round((inrSubtotal + inrGstTotal) * 100) / 100,
        },
    };
}
