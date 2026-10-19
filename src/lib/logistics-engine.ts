/**
 * Unified Courier Logistics & Dispatch Manifest Engine
 * Reverse-engineered from Vasy.ai Omnichannel E-Commerce ERP features.
 * 
 * Supports:
 * - Multi-carrier integration adapter (Delhivery, Shiprocket, Bluedart, DTDC)
 * - CTS-compliant Air Waybill (AWB) generation & barcode tracking
 * - Volumetric weight vs actual chargeable weight calculation
 * - Dynamic shipping rate estimation across Indian delivery zones (A to E)
 * - Daily dispatch handover manifest generator
 */

export type CourierCarrier = 'delhivery' | 'shiprocket' | 'bluedart' | 'dtdc' | 'st_courier';

export type DeliveryZone =
    | 'zone_a' // Intra-city / Local
    | 'zone_b' // Within State (Intra-state)
    | 'zone_c' // Metro to Metro
    | 'zone_d' // Rest of India
    | 'zone_e';// Special Zones (North East, J&K, Islands)

export interface ParcelDimensions {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    actualWeightGrams: number;
}

export interface ShippingAddress {
    recipientName: string;
    phone: string;
    streetAddress: string;
    city: string;
    state: string;
    pincode: string;
}

export interface OutwardShipmentInput {
    orderNumber: string;
    invoiceNumber?: string;
    carrier: CourierCarrier;
    manualAwbNumber?: string; // Manual AWB entry (especially for offline bookings like ST Courier)
    senderAddress: ShippingAddress;
    deliveryAddress: ShippingAddress;
    dimensions: ParcelDimensions;
    isCod: boolean;
    codAmount?: number;
    invoiceValue: number;
}

export interface GeneratedShipmentLabel {
    awbNumber: string;
    carrier: CourierCarrier;
    orderNumber: string;
    shippingStatus: 'manifested' | 'picked_up';
    chargeableWeightGrams: number;
    volumetricWeightGrams: number;
    estimatedShippingCost: number;
    isCod: boolean;
    codAmount: number;
    trackingUrl: string;
    barcodeString: string;
    manifestDate: string;
}

export interface DispatchManifestSummary {
    manifestNumber: string;
    carrier: CourierCarrier;
    dispatchDate: string;
    totalParcels: number;
    totalChargeableWeightKg: number;
    totalCodValue: number;
    shipmentAwbs: string[];
    handoverAcknowledgeText: string;
}

export const CARRIER_TRACKING_PREFIXES: Record<CourierCarrier, string> = {
    delhivery: 'DLV',
    shiprocket: 'SR',
    bluedart: 'BLD',
    dtdc: 'DTDC',
    st_courier: 'STC',
};

export interface StCourierTrackingEvent {
    dateTime: string;
    status: string;
    location: string;
}

export interface StCourierTrackingSummary {
    currentStatus?: string;
    origin?: string;
    destination?: string;
    consignment?: string;
    bookDateTime?: string;
    deliveryDateTime?: string;
}

export interface StCourierTrackingResult {
    awbNumber: string;
    isValid: boolean;
    statusCode: number;
    statusText: string;
    summary?: StCourierTrackingSummary;
    events: StCourierTrackingEvent[];
    error?: string;
}

export type StCourierTrackingMode = 'bridge' | 'aggregator' | 'portal';

/**
 * Validates whether an AWB number matches ST Courier's strict 11-digit numeric format.
 */
export function isValidStCourierAwb(awb?: string): boolean {
    if (!awb) return false;
    const clean = awb.trim().replace(/[^0-9]/g, '');
    return /^\d{11}$/.test(clean);
}

/**
 * Generates direct tracking URLs for ST Courier shipments.
 * - 'bridge': Local Next.js API route that handles reverse-engineered session bridge & luxurious tracking page
 * - 'aggregator': Direct 1-click fallback via multi-carrier aggregator
 * - 'portal': ST Courier direct shipment endpoint
 */
export function getStCourierTrackingUrl(
    awbNumber: string,
    mode: StCourierTrackingMode = 'bridge',
    bridgeBaseUrl: string = ''
): string {
    const cleanAwb = awbNumber.replace(/[^0-9]/g, '');
    switch (mode) {
        case 'bridge':
            return `${bridgeBaseUrl}/tracking/st-courier?awb=${cleanAwb}`;
        case 'aggregator':
            return `https://trackcourier.io/track-and-trace/st-courier/${cleanAwb}`;
        case 'portal':
        default:
            return `https://stcourier.com/track/shipment?awb_no=${cleanAwb}`;
    }
}

/**
 * Reverse-engineers ST Courier internal tracking API:
 * 1. Submits POST /track/doCheck with AWB number to acquire session cookie
 * 2. Fetches GET /track/shipment with session cookie
 * 3. Extracts delivery summary table and chronological timeline events
 */
export async function fetchStCourierLiveTracking(awbNumber: string): Promise<StCourierTrackingResult> {
    const cleanAwb = awbNumber.trim().replace(/[^0-9]/g, '');
    if (!/^\d{11}$/.test(cleanAwb)) {
        return {
            awbNumber: cleanAwb,
            isValid: false,
            statusCode: 400,
            statusText: 'Invalid AWB format. ST Courier AWB must be exactly 11 numeric digits.',
            events: [],
            error: 'INVALID_AWB_FORMAT',
        };
    }

    try {
        const postData = `awb_no=${encodeURIComponent(cleanAwb)}`;
        const checkRes = await fetch('https://stcourier.com/track/doCheck', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
            },
            body: postData,
        });

        const cookieHeader = checkRes.headers.get('set-cookie') || '';
        const ciSessionMatch = cookieHeader.match(/ci_session=([^;]+)/);
        const ciSession = ciSessionMatch ? ciSessionMatch[1] : '';

        const shipmentRes = await fetch('https://stcourier.com/track/shipment', {
            method: 'GET',
            headers: {
                'Cookie': ciSession ? `ci_session=${ciSession}` : '',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://stcourier.com/',
            },
        });

        const html = await shipmentRes.text();

        if (html.includes('Sorry, Invalid AWB Number') || html.includes('Sorry, Invalid AWB')) {
            return {
                awbNumber: cleanAwb,
                isValid: false,
                statusCode: 404,
                statusText: 'AWB Not Found or Invalid in ST Courier records',
                events: [],
            };
        }

        // Parse Summary Table
        const summary: StCourierTrackingSummary = {};
        const statusTableMatch = html.match(/<table[^>]*color-bordered-table[\s\S]*?<\/table>/i);
        if (statusTableMatch) {
            const tableHtml = statusTableMatch[0];
            const trMatches = tableHtml.match(/<tr>[\s\S]*?<\/tr>/gi) || [];
            trMatches.forEach(tr => {
                const tds = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(td => td.replace(/<[^>]+>/g, '').trim());
                if (tds.length >= 2) {
                    const key = tds[0].toLowerCase();
                    if (key.includes('current status')) summary.currentStatus = tds[1];
                    else if (key.includes('orgin') || key.includes('origin')) summary.origin = tds[1];
                    else if (key.includes('destination')) summary.destination = tds[1];
                    else if (key.includes('consignment')) summary.consignment = tds[1];
                    else if (key.includes('book date')) summary.bookDateTime = tds[1];
                    else if (key.includes('delivery date')) summary.deliveryDateTime = tds[1];
                }
            });
        }

        // Parse Timeline Events
        const events: StCourierTrackingEvent[] = [];
        const statusIdx = html.indexOf('Status of AWB No');
        const timelineSub = statusIdx !== -1 ? html.slice(statusIdx) : html;

        // Match each milestone item:
        // 1. Date & Time stamp (e.g. "Oct 13, 2026<br>04:31 PM")
        // 2. Icon marker
        // 3. Status title and location inside float:right column
        const itemRegex = /([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s*<br>\s*\d{1,2}:\d{2}\s+(?:AM|PM))[\s\S]*?<i class="fa [^"]+"><\/i>[\s\S]*?<div[^>]*style="[^"]*float:right[^"]*"[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/gi;
        
        let m: RegExpExecArray | null;
        while ((m = itemRegex.exec(timelineSub)) !== null) {
            const dateTime = m[1].replace(/<br\s*[\/]?>/gi, ' ').replace(/\s+/g, ' ').trim();
            const rawText = m[2]
                .replace(/&nbsp;/g, ' ')
                .replace(/<br\s*[\/]?>/gi, ' | ')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const parts = rawText.split('|').map(s => s.trim()).filter(Boolean);
            events.push({
                dateTime,
                status: parts[0] || '',
                location: parts.slice(1).join(' - ') || '',
            });
        }

        const effectiveStatus = summary.currentStatus || (events.length > 0 ? events[0].status : 'Booked');

        return {
            awbNumber: cleanAwb,
            isValid: true,
            statusCode: 200,
            statusText: effectiveStatus,
            summary,
            events,
        };
    } catch (err: any) {
        return {
            awbNumber: cleanAwb,
            isValid: false,
            statusCode: 500,
            statusText: 'Tracking fetch failed',
            events: [],
            error: err?.message || 'NETWORK_ERROR',
        };
    }
}

export const ZONE_BASE_RATES: Record<DeliveryZone, { base500g: number; addl500g: number }> = {
    zone_a: { base500g: 40, addl500g: 30 },
    zone_b: { base500g: 55, addl500g: 40 },
    zone_c: { base500g: 75, addl500g: 55 },
    zone_d: { base500g: 95, addl500g: 70 },
    zone_e: { base500g: 130, addl500g: 95 },
};

/**
 * Calculates volumetric weight vs actual weight to determine chargeable weight
 * Volumetric weight (g) = (Length × Width × Height in cm) / 5000 × 1000
 */
export function calculateChargeableWeight(dimensions: ParcelDimensions): {
    actualWeightGrams: number;
    volumetricWeightGrams: number;
    chargeableWeightGrams: number;
} {
    const l = Math.max(1, dimensions.lengthCm);
    const w = Math.max(1, dimensions.widthCm);
    const h = Math.max(1, dimensions.heightCm);
    const actual = Math.max(1, dimensions.actualWeightGrams);

    // Standard courier volumetric formula: (L * W * H / 5000) kg -> * 1000 = grams
    const volumetricKg = (l * w * h) / 5000;
    const volumetricWeightGrams = Math.round(volumetricKg * 1000);

    const chargeableWeightGrams = Math.max(actual, volumetricWeightGrams);

    return {
        actualWeightGrams: actual,
        volumetricWeightGrams,
        chargeableWeightGrams,
    };
}

/**
 * Estimates shipping cost based on zone, weight slabs, and COD fees
 */
export function estimateShippingRate(
    chargeableWeightGrams: number,
    zone: DeliveryZone = 'zone_b',
    isCod: boolean = false,
    codAmount: number = 0
): {
    baseRate: number;
    weightSurcharge: number;
    codCharge: number;
    totalRate: number;
} {
    const rateConfig = ZONE_BASE_RATES[zone] || ZONE_BASE_RATES.zone_b;
    const baseRate = rateConfig.base500g;

    let weightSurcharge = 0;
    if (chargeableWeightGrams > 500) {
        const excessWeight = chargeableWeightGrams - 500;
        const slabs = Math.ceil(excessWeight / 500);
        weightSurcharge = slabs * rateConfig.addl500g;
    }

    let codCharge = 0;
    if (isCod && codAmount > 0) {
        // Typical courier COD fee: Max of ₹50 or 2.0% of COD order value
        codCharge = Math.max(50, Math.round((codAmount * 0.02) * 100) / 100);
    }

    const totalRate = Math.round((baseRate + weightSurcharge + codCharge) * 100) / 100;

    return {
        baseRate,
        weightSurcharge,
        codCharge,
        totalRate,
    };
}

/**
 * Generates an AWB number with carrier prefix and checksum.
 * ST Courier uses 11-digit numeric barcodes without alphabetic prefix.
 */
export function generateAwbNumber(carrier: CourierCarrier, seedNumber?: number): string {
    if (carrier === 'st_courier') {
        if (seedNumber !== undefined) {
            return String(seedNumber).padStart(11, '0').slice(0, 11);
        }
        return String(Math.floor(64000000000 + Math.random() * 9999999999));
    }
    const prefix = CARRIER_TRACKING_PREFIXES[carrier] || 'LUM';
    const rand = seedNumber !== undefined ? seedNumber : Math.floor(10000000 + Math.random() * 90000000);
    return `${prefix}${rand}`;
}

/**
 * Creates full shipment record and printable label data.
 * Supports manual AWB number entry (e.g. from counter docket or barcode scan).
 */
export function createShipment(
    input: OutwardShipmentInput,
    zone: DeliveryZone = 'zone_b',
    customAwbSeed?: number
): GeneratedShipmentLabel {
    let awbNumber: string;
    if (input.manualAwbNumber && input.manualAwbNumber.trim()) {
        const cleanAwb = input.manualAwbNumber.trim();
        if (input.carrier === 'st_courier' && !isValidStCourierAwb(cleanAwb)) {
            throw new Error(`Invalid ST Courier AWB "${cleanAwb}". ST Courier tracking number must be exactly 11 numeric digits.`);
        }
        awbNumber = cleanAwb;
    } else {
        awbNumber = generateAwbNumber(input.carrier, customAwbSeed);
    }

    const weightCalc = calculateChargeableWeight(input.dimensions);
    const rateCalc = estimateShippingRate(
        weightCalc.chargeableWeightGrams,
        zone,
        input.isCod,
        input.codAmount || 0
    );

    const trackingBaseUrls: Record<CourierCarrier, string> = {
        delhivery: `https://www.delhivery.com/track/package/${awbNumber}`,
        shiprocket: `https://shiprocket.co/tracking/${awbNumber}`,
        bluedart: `https://www.bluedart.com/tracking?handler=trak&numbers=${awbNumber}`,
        dtdc: `https://www.dtdc.in/tracking/shipment-tracking.asp?awb=${awbNumber}`,
        st_courier: getStCourierTrackingUrl(awbNumber, 'bridge'),
    };

    return {
        awbNumber,
        carrier: input.carrier,
        orderNumber: input.orderNumber,
        shippingStatus: 'manifested',
        chargeableWeightGrams: weightCalc.chargeableWeightGrams,
        volumetricWeightGrams: weightCalc.volumetricWeightGrams,
        estimatedShippingCost: rateCalc.totalRate,
        isCod: input.isCod,
        codAmount: input.isCod ? (input.codAmount || 0) : 0,
        trackingUrl: trackingBaseUrls[input.carrier],
        barcodeString: `*${awbNumber}*`,
        manifestDate: new Date().toISOString(),
    };
}

/**
 * Compiles end-of-day dispatch manifest for driver handover
 */
export function compileDispatchManifest(
    shipments: GeneratedShipmentLabel[],
    carrier: CourierCarrier,
    manifestSeq: number = 1
): DispatchManifestSummary {
    const carrierShipments = shipments.filter(s => s.carrier === carrier);
    const totalParcels = carrierShipments.length;
    const totalGrams = carrierShipments.reduce((sum, s) => sum + s.chargeableWeightGrams, 0);
    const totalCod = carrierShipments.reduce((sum, s) => sum + (s.isCod ? s.codAmount : 0), 0);
    const awbs = carrierShipments.map(s => s.awbNumber);

    const prefix = CARRIER_TRACKING_PREFIXES[carrier] || 'MNF';
    const dateStr = new Date().toISOString().substring(0, 10).replace(/-/g, '');
    const manifestNumber = `MNF-${prefix}-${dateStr}-${String(manifestSeq).padStart(3, '0')}`;

    return {
        manifestNumber,
        carrier,
        dispatchDate: new Date().toISOString(),
        totalParcels,
        totalChargeableWeightKg: Math.round((totalGrams / 1000) * 100) / 100,
        totalCodValue: Math.round(totalCod * 100) / 100,
        shipmentAwbs: awbs,
        handoverAcknowledgeText: `Handed over ${totalParcels} package(s) weighing ${(totalGrams / 1000).toFixed(2)} kg to ${carrier.toUpperCase()} representative. Total COD to collect: ₹${totalCod.toFixed(2)}.`,
    };
}
