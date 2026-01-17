/**
 * E-way Bill Service Layer
 * Integration with NIC E-way Bill GST Portal API (Version 1.03)
 * 
 * Documentation: https://docs.ewaybillgst.gov.in/apidocs/
 * 
 * Prerequisites:
 * - Register at ewaybillgst.gov.in for API access
 * - Configure credentials in store_settings
 */

import { pb } from './pocketbase';
import { getStoreSettings } from './invoice';
import CryptoJS from 'crypto-js';

// ============================================
// CONFIGURATION & TYPES
// ============================================

const SANDBOX_BASE_URL = 'https://gst.charteredinfo.com/ewayapi';
const PRODUCTION_BASE_URL = 'https://api.ewaybillgst.gov.in/ewayapi';

export interface EwayBillConfig {
    clientId: string;
    clientSecret: string;
    gstin: string;
    username: string;
    password: string;
    isProduction: boolean;
}

export interface EwayBillItem {
    productName: string;
    productDesc?: string;
    hsnCode: string;
    quantity: number;
    qtyUnit: string;        // KGS, NOS, PCS, LTR, MTR, etc.
    taxableAmount: number;
    cgstRate: number;
    sgstRate: number;
    igstRate: number;
    cessRate?: number;
}

export interface EwayBillRequest {
    supplyType: 'O' | 'I';              // O=Outward, I=Inward
    subSupplyType: string;               // 1=Supply, 2=Export, 3=Job Work, etc.
    docType: 'INV' | 'CHL' | 'BOE' | 'OTH';
    docNo: string;
    docDate: string;                     // dd/mm/yyyy format
    fromGstin: string;
    fromTrdName?: string;
    fromAddr1?: string;
    fromAddr2?: string;
    fromPlace?: string;
    fromPincode: number;
    fromStateCode: number;
    actFromStateCode?: number;
    toGstin: string;
    toTrdName?: string;
    toAddr1?: string;
    toAddr2?: string;
    toPlace?: string;
    toPincode: number;
    toStateCode: number;
    actToStateCode?: number;
    transactionType: 1 | 2 | 3 | 4;      // 1=Regular, 2=Bill To-Ship To, 3=Bill From-Dispatch From, 4=Combination
    transDistance: number;               // km (max 4000)
    transMode?: 1 | 2 | 3 | 4;           // 1=Road, 2=Rail, 3=Air, 4=Ship
    vehicleType?: 'R' | 'O';             // R=Regular, O=Over Dimensional Cargo
    vehicleNo?: string;
    transporterId?: string;
    transporterName?: string;
    transDocNo?: string;
    transDocDate?: string;               // dd/mm/yyyy
    totalValue: number;
    cgstValue: number;
    sgstValue: number;
    igstValue: number;
    cessValue: number;
    totInvValue: number;
    itemList: EwayBillItem[];
}

export interface EwayBillResponse {
    ewayBillNo: string;
    ewayBillDate: string;
    validUpto: string;
    alert?: string;
}

export interface EwayBillDetails {
    ewbNo: string;
    ewbDate: string;
    genMode: string;
    userGstin: string;
    supplyType: string;
    subSupplyType: string;
    docType: string;
    docNo: string;
    docDate: string;
    fromGstin: string;
    fromTrdName: string;
    fromAddr1: string;
    fromPlace: string;
    fromStateCode: number;
    toGstin: string;
    toTrdName: string;
    toAddr1: string;
    toPlace: string;
    toStateCode: number;
    totalValue: number;
    totInvValue: number;
    cgstValue: number;
    sgstValue: number;
    igstValue: number;
    cessValue: number;
    transMode: string;
    vehicleNo: string;
    validUpto: string;
    status: string;
    itemList: any[];
}

// Sub-supply type codes
export const SUB_SUPPLY_TYPES = {
    SUPPLY: '1',
    IMPORT: '2',
    EXPORT: '3',
    JOB_WORK: '4',
    FOR_OWN_USE: '5',
    JOB_WORK_RETURNS: '6',
    SALES_RETURN: '7',
    OTHERS: '8',
    SKD_CKD: '9',
    LINE_SALES: '10',
    RECIPIENT_NOT_KNOWN: '11',
    EXHIBITION: '12',
};

// State codes (partial list - key states)
export const STATE_CODES: Record<string, number> = {
    'JAMMU AND KASHMIR': 1,
    'HIMACHAL PRADESH': 2,
    'PUNJAB': 3,
    'CHANDIGARH': 4,
    'UTTARAKHAND': 5,
    'HARYANA': 6,
    'DELHI': 7,
    'RAJASTHAN': 8,
    'UTTAR PRADESH': 9,
    'BIHAR': 10,
    'SIKKIM': 11,
    'ARUNACHAL PRADESH': 12,
    'NAGALAND': 13,
    'MANIPUR': 14,
    'MIZORAM': 15,
    'TRIPURA': 16,
    'MEGHALAYA': 17,
    'ASSAM': 18,
    'WEST BENGAL': 19,
    'JHARKHAND': 20,
    'ODISHA': 21,
    'CHHATTISGARH': 22,
    'MADHYA PRADESH': 23,
    'GUJARAT': 24,
    'DAMAN AND DIU': 25,
    'DADRA AND NAGAR HAVELI': 26,
    'MAHARASHTRA': 27,
    'KARNATAKA': 29,
    'GOA': 30,
    'LAKSHADWEEP': 31,
    'KERALA': 32,
    'TAMIL NADU': 33,
    'PUDUCHERRY': 34,
    'ANDAMAN AND NICOBAR': 35,
    'TELANGANA': 36,
    'ANDHRA PRADESH': 37,
    'LADAKH': 38,
};

// ============================================
// SESSION MANAGEMENT
// ============================================

let authToken: string | null = null;
let tokenExpiry: Date | null = null;
let sessionEncryptionKey: string | null = null;

// ============================================
// HELPER FUNCTIONS
// ============================================

async function getEwayBillConfig(): Promise<EwayBillConfig | null> {
    try {
        const settings = await getStoreSettings();
        const ewaySettings = await pb.collection('store_settings').getFirstListItem('key="eway_bill"').catch(() => null);

        if (!ewaySettings) {
            console.warn('E-way Bill settings not configured');
            return null;
        }

        return {
            clientId: (ewaySettings as any).eway_client_id || '',
            clientSecret: (ewaySettings as any).eway_client_secret || '',
            gstin: settings.store_gstin,
            username: (ewaySettings as any).eway_username || '',
            password: (ewaySettings as any).eway_password || '',
            isProduction: (ewaySettings as any).eway_is_production || false,
        };
    } catch (error) {
        console.error('Error getting E-way Bill config:', error);
        return null;
    }
}

function getBaseUrl(isProduction: boolean): string {
    return isProduction ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
}

function formatDateForEway(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

function encryptWithPublicKey(data: string): string {
    // Note: In production, you'd use RSA encryption with NIC's public key
    // For now, we'll use Base64 encoding as a placeholder
    // Real implementation needs: RSA encryption with NIC's public key (available on their portal)
    return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(data));
}

function encryptWithSEK(data: string, sek: string): string {
    // Encrypt data using Session Encryption Key (AES)
    const encrypted = CryptoJS.AES.encrypt(data, CryptoJS.enc.Base64.parse(sek), {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
    });
    return encrypted.toString();
}

function decryptWithSEK(encryptedData: string, sek: string): string {
    const decrypted = CryptoJS.AES.decrypt(encryptedData, CryptoJS.enc.Base64.parse(sek), {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
    });
    return decrypted.toString(CryptoJS.enc.Utf8);
}

// ============================================
// AUTHENTICATION
// ============================================

export async function authenticateEwayBill(): Promise<boolean> {
    // Check if we have a valid token
    if (authToken && tokenExpiry && new Date() < tokenExpiry) {
        return true;
    }

    const config = await getEwayBillConfig();
    if (!config) {
        throw new Error('E-way Bill not configured. Please configure in Settings.');
    }

    const baseUrl = getBaseUrl(config.isProduction);

    try {
        const requestPayload = {
            action: 'ACCESSTOKEN',
            username: config.username,
            password: config.password,
            app_key: config.clientId, // Client's app key
        };

        // Encrypt the request payload with NIC's public key
        const encryptedPayload = encryptWithPublicKey(JSON.stringify(requestPayload));

        const response = await fetch(`${baseUrl}/authenticate?action=ACCESSTOKEN`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'client-id': config.clientId,
                'client-secret': config.clientSecret,
                'gstin': config.gstin,
            },
            body: JSON.stringify({
                action: 'ACCESSTOKEN',
                data: encryptedPayload,
            }),
        });

        const result = await response.json();

        if (result.status === 1) {
            // Decrypt the response to get auth token and SEK
            const decryptedData = JSON.parse(
                CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Base64.parse(result.data))
            );

            authToken = decryptedData.authtoken;
            sessionEncryptionKey = decryptedData.sek;
            // Token valid for 6 hours
            tokenExpiry = new Date(Date.now() + 6 * 60 * 60 * 1000);

            console.log('E-way Bill authentication successful');
            return true;
        } else {
            throw new Error(result.error?.message || 'Authentication failed');
        }
    } catch (error) {
        console.error('E-way Bill authentication error:', error);
        throw error;
    }
}

// ============================================
// GENERATE E-WAY BILL
// ============================================

export async function generateEwayBill(request: EwayBillRequest): Promise<EwayBillResponse> {
    await authenticateEwayBill();

    const config = await getEwayBillConfig();
    if (!config) throw new Error('E-way Bill not configured');

    const baseUrl = getBaseUrl(config.isProduction);

    try {
        const ewayData = {
            supplyType: request.supplyType,
            subSupplyType: request.subSupplyType,
            docType: request.docType,
            docNo: request.docNo,
            docDate: request.docDate,
            fromGstin: request.fromGstin,
            fromTrdName: request.fromTrdName || '',
            fromAddr1: request.fromAddr1 || '',
            fromAddr2: request.fromAddr2 || '',
            fromPlace: request.fromPlace || '',
            fromPincode: request.fromPincode,
            fromStateCode: request.fromStateCode,
            actFromStateCode: request.actFromStateCode || request.fromStateCode,
            toGstin: request.toGstin,
            toTrdName: request.toTrdName || '',
            toAddr1: request.toAddr1 || '',
            toAddr2: request.toAddr2 || '',
            toPlace: request.toPlace || '',
            toPincode: request.toPincode,
            toStateCode: request.toStateCode,
            actToStateCode: request.actToStateCode || request.toStateCode,
            transactionType: request.transactionType,
            transDistance: request.transDistance,
            transMode: request.transMode || '',
            vehicleType: request.vehicleType || 'R',
            vehicleNo: request.vehicleNo || '',
            transporterId: request.transporterId || '',
            transporterName: request.transporterName || '',
            transDocNo: request.transDocNo || '',
            transDocDate: request.transDocDate || '',
            totalValue: request.totalValue,
            cgstValue: request.cgstValue,
            sgstValue: request.sgstValue,
            igstValue: request.igstValue,
            cessValue: request.cessValue,
            totInvValue: request.totInvValue,
            itemList: request.itemList.map(item => ({
                productName: item.productName,
                productDesc: item.productDesc || '',
                hsnCode: item.hsnCode,
                quantity: item.quantity,
                qtyUnit: item.qtyUnit,
                taxableAmount: item.taxableAmount,
                cgstRate: item.cgstRate,
                sgstRate: item.sgstRate,
                igstRate: item.igstRate,
                cessRate: item.cessRate || 0,
            })),
        };

        // Encrypt request data
        const encryptedData = encryptWithSEK(
            CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(JSON.stringify(ewayData))),
            sessionEncryptionKey!
        );

        const response = await fetch(`${baseUrl}/ewayapi/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'client-id': config.clientId,
                'client-secret': config.clientSecret,
                'gstin': config.gstin,
                'authtoken': authToken!,
            },
            body: JSON.stringify({
                action: 'GENEWAYBILL',
                data: encryptedData,
            }),
        });

        const result = await response.json();

        if (result.status === 1) {
            // Decrypt response
            const decryptedData = JSON.parse(
                decryptWithSEK(result.data, sessionEncryptionKey!)
            );

            return {
                ewayBillNo: decryptedData.ewayBillNo,
                ewayBillDate: decryptedData.ewayBillDate,
                validUpto: decryptedData.validUpto,
                alert: decryptedData.alert,
            };
        } else {
            throw new Error(result.error?.message || 'E-way Bill generation failed');
        }
    } catch (error) {
        console.error('E-way Bill generation error:', error);
        throw error;
    }
}

// ============================================
// GET E-WAY BILL DETAILS
// ============================================

export async function getEwayBillDetails(ewbNo: string): Promise<EwayBillDetails | null> {
    await authenticateEwayBill();

    const config = await getEwayBillConfig();
    if (!config) throw new Error('E-way Bill not configured');

    const baseUrl = getBaseUrl(config.isProduction);

    try {
        const response = await fetch(`${baseUrl}/ewayapi/GetEwayBill?ewbNo=${ewbNo}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'client-id': config.clientId,
                'client-secret': config.clientSecret,
                'gstin': config.gstin,
                'authtoken': authToken!,
            },
        });

        const result = await response.json();

        if (result.status === 1) {
            const decryptedData = JSON.parse(
                decryptWithSEK(result.data, sessionEncryptionKey!)
            );
            return decryptedData as EwayBillDetails;
        } else {
            console.error('Failed to get E-way Bill:', result.error);
            return null;
        }
    } catch (error) {
        console.error('Error fetching E-way Bill details:', error);
        return null;
    }
}

// ============================================
// UPDATE VEHICLE (PART B)
// ============================================

export async function updateEwayBillVehicle(
    ewbNo: string,
    vehicleNo: string,
    transMode: 1 | 2 | 3 | 4,
    fromPlace?: string,
    fromState?: number,
    reason?: string
): Promise<boolean> {
    await authenticateEwayBill();

    const config = await getEwayBillConfig();
    if (!config) throw new Error('E-way Bill not configured');

    const baseUrl = getBaseUrl(config.isProduction);

    try {
        const updateData = {
            ewbNo,
            vehicleNo,
            transMode,
            fromPlace: fromPlace || '',
            fromState: fromState || 0,
            reasonCode: reason || '',
            reasonRem: '',
            transDocNo: '',
            transDocDate: '',
        };

        const encryptedData = encryptWithSEK(
            CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(JSON.stringify(updateData))),
            sessionEncryptionKey!
        );

        const response = await fetch(`${baseUrl}/ewayapi/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'client-id': config.clientId,
                'client-secret': config.clientSecret,
                'gstin': config.gstin,
                'authtoken': authToken!,
            },
            body: JSON.stringify({
                action: 'UPDATEVEHICLE',
                data: encryptedData,
            }),
        });

        const result = await response.json();
        return result.status === 1;
    } catch (error) {
        console.error('Error updating vehicle:', error);
        return false;
    }
}

// ============================================
// CANCEL E-WAY BILL
// ============================================

export async function cancelEwayBill(
    ewbNo: string,
    cancelReason: 1 | 2 | 3 | 4 // 1=Duplicate, 2=Order Cancelled, 3=Data Entry Mistake, 4=Others
): Promise<boolean> {
    await authenticateEwayBill();

    const config = await getEwayBillConfig();
    if (!config) throw new Error('E-way Bill not configured');

    const baseUrl = getBaseUrl(config.isProduction);

    try {
        const cancelData = {
            ewbNo,
            cancelRsnCode: cancelReason,
            cancelRmrk: '',
        };

        const encryptedData = encryptWithSEK(
            CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(JSON.stringify(cancelData))),
            sessionEncryptionKey!
        );

        const response = await fetch(`${baseUrl}/ewayapi/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'client-id': config.clientId,
                'client-secret': config.clientSecret,
                'gstin': config.gstin,
                'authtoken': authToken!,
            },
            body: JSON.stringify({
                action: 'CANEWB',
                data: encryptedData,
            }),
        });

        const result = await response.json();
        return result.status === 1;
    } catch (error) {
        console.error('Error cancelling E-way Bill:', error);
        return false;
    }
}

// ============================================
// GENERATE FROM INVOICE
// ============================================

export async function generateEwayBillFromInvoice(invoiceId: string): Promise<EwayBillResponse> {
    // Fetch invoice with items
    const invoice = await pb.collection('invoices').getOne(invoiceId, {
        expand: 'sale',
    });

    const invoiceItems = await pb.collection('invoice_items').getFullList({
        filter: `invoice="${invoiceId}"`,
    });

    const storeSettings = await getStoreSettings();

    // Build E-way Bill request from invoice data
    const request: EwayBillRequest = {
        supplyType: 'O', // Outward supply
        subSupplyType: SUB_SUPPLY_TYPES.SUPPLY,
        docType: 'INV',
        docNo: (invoice as any).invoice_number,
        docDate: formatDateForEway((invoice as any).invoice_date),
        fromGstin: storeSettings.store_gstin,
        fromTrdName: storeSettings.store_name,
        fromAddr1: storeSettings.store_address,
        fromPlace: storeSettings.store_city,
        fromPincode: parseInt(storeSettings.store_pincode) || 0,
        fromStateCode: parseInt(storeSettings.store_state_code) || 29,
        toGstin: (invoice as any).buyer_gstin || 'URP', // URP for unregistered
        toTrdName: (invoice as any).buyer_name,
        toAddr1: (invoice as any).buyer_address,
        toPlace: '', // Would need buyer city
        toPincode: 0, // Would need buyer pincode
        toStateCode: parseInt((invoice as any).buyer_state_code) || 29,
        transactionType: 1, // Regular
        transDistance: 0, // To be filled by user
        totalValue: (invoice as any).taxable_value,
        cgstValue: (invoice as any).cgst_amount,
        sgstValue: (invoice as any).sgst_amount,
        igstValue: (invoice as any).igst_amount,
        cessValue: (invoice as any).cess_amount || 0,
        totInvValue: (invoice as any).grand_total,
        itemList: invoiceItems.map((item: any) => ({
            productName: item.description?.substring(0, 100) || 'Product',
            productDesc: item.description?.substring(0, 100) || '',
            hsnCode: item.hsn_code || '7113',
            quantity: item.quantity,
            qtyUnit: item.unit || 'NOS',
            taxableAmount: item.taxable_amount,
            cgstRate: item.cgst_rate || 0,
            sgstRate: item.sgst_rate || 0,
            igstRate: item.igst_rate || 0,
            cessRate: item.cess_rate || 0,
        })),
    };

    // Generate E-way Bill
    const result = await generateEwayBill(request);

    // Update invoice with E-way Bill details
    await pb.collection('invoices').update(invoiceId, {
        eway_bill_no: result.ewayBillNo,
        eway_bill_date: new Date().toISOString(),
        eway_bill_valid_until: result.validUpto,
        eway_bill_status: 'generated',
    });

    return result;
}

// ============================================
// CHECK IF E-WAY BILL REQUIRED
// ============================================

export function isEwayBillRequired(invoiceValue: number, transportMode?: string): boolean {
    // E-way Bill is required for goods worth > ₹50,000
    const threshold = 50000;

    // Some exemptions exist (e.g., certain goods, short distances)
    // but the general rule is > ₹50,000
    return invoiceValue > threshold;
}

// ============================================
// VALIDATE GSTIN FORMAT
// ============================================

export function isValidGstin(gstin: string): boolean {
    if (!gstin || gstin === 'URP') return true; // URP = Unregistered Person

    // GSTIN format: 2 digits state code + 10 char PAN + 1 entity code + 1 check digit + Z
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return gstinRegex.test(gstin.toUpperCase());
}
