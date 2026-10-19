/**
 * Brutal Verification Test Suite: ST Courier Reverse-Engineered Tracking & Barcode Dispatch
 * 
 * Tests:
 * 1. 11-digit AWB validation rules (handles real customer AWB 64437374632)
 * 2. Live reverse-engineered ST Courier API scraper (session cookie acquisition + table/timeline parsing)
 * 3. 1-click tracking URL generation across bridge, aggregator, and portal modes
 * 4. Manual AWB entry vs auto-generated AWB validation for ST Courier shipments
 * 5. End-of-day dispatch manifest compilation for ST Courier carrier
 */

import {
    isValidStCourierAwb,
    getStCourierTrackingUrl,
    fetchStCourierLiveTracking,
    generateAwbNumber,
    createShipment,
    compileDispatchManifest,
    OutwardShipmentInput,
} from '../lib/logistics-engine';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`❌ FAILED: ${message}`);
        throw new Error(`Assertion failed: ${message}`);
    }
    console.log(`  ✓ ${message}`);
}

async function runTests() {
    console.log('\n======================================================');
    console.log('🚀 RUNNING ST COURIER REVERSE-ENGINEERED TEST SUITE');
    console.log('======================================================\n');

    const REAL_AWB = '64437374632';

    // -----------------------------------------------------------------
    // TEST 1: Strict 11-digit AWB Validation
    // -----------------------------------------------------------------
    console.log('--- TEST 1: Strict 11-Digit AWB Validation ---');
    assert(isValidStCourierAwb(REAL_AWB) === true, 'Real customer AWB 64437374632 is valid');
    assert(isValidStCourierAwb(`  ${REAL_AWB}  `) === true, 'Trimmed AWB is valid');
    assert(isValidStCourierAwb('10012345678') === true, 'Arbitrary 11-digit AWB is valid');
    assert(isValidStCourierAwb('1234567890') === false, '10-digit number is rejected (too short)');
    assert(isValidStCourierAwb('123456789012') === false, '12-digit number is rejected (too long)');
    assert(isValidStCourierAwb('STC644373746') === false, 'Alphanumeric prefix is rejected for ST Courier');
    assert(isValidStCourierAwb('') === false, 'Empty string is rejected');
    assert(isValidStCourierAwb(undefined) === false, 'Undefined is rejected');

    // -----------------------------------------------------------------
    // TEST 2: 1-Click Tracking URL Generation
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: 1-Click Tracking URL Generation ---');
    const bridgeUrl = getStCourierTrackingUrl(REAL_AWB, 'bridge', 'https://erp.luminila.com');
    assert(bridgeUrl === `https://erp.luminila.com/tracking/st-courier?awb=${REAL_AWB}`, 'Bridge tracking URL formatted correctly');

    const aggUrl = getStCourierTrackingUrl(REAL_AWB, 'aggregator');
    assert(aggUrl === `https://trackcourier.io/track-and-trace/st-courier/${REAL_AWB}`, 'Aggregator URL formatted correctly');

    const portalUrl = getStCourierTrackingUrl(REAL_AWB, 'portal');
    assert(portalUrl === `https://stcourier.com/track/shipment?awb_no=${REAL_AWB}`, 'Portal fallback URL formatted correctly');

    // -----------------------------------------------------------------
    // TEST 3: Live Reverse-Engineered ST Courier Tracking Fetch
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Live Reverse-Engineered ST Courier Tracking Fetch ---');
    console.log(`Querying live ST Courier servers for real AWB: ${REAL_AWB}...`);
    const liveResult = await fetchStCourierLiveTracking(REAL_AWB);

    assert(liveResult.isValid === true, 'Live fetch returned isValid = true');
    assert(liveResult.statusCode === 200, 'Live fetch HTTP code is 200');
    assert(liveResult.awbNumber === REAL_AWB, 'Result echoes correct AWB');
    assert(liveResult.summary !== undefined, 'Summary object was extracted');
    assert(liveResult.summary?.currentStatus === 'Delivered', `Extracted Current Status is "Delivered" (Actual: "${liveResult.summary?.currentStatus}")`);
    assert(liveResult.summary?.origin === 'TNHSU-SRI', `Extracted Origin is "TNHSU-SRI" (Actual: "${liveResult.summary?.origin}")`);
    assert(liveResult.summary?.destination === 'TNCJB-JSM', `Extracted Destination is "TNCJB-JSM" (Actual: "${liveResult.summary?.destination}")`);
    assert(Array.isArray(liveResult.events) && liveResult.events.length > 0, `Parsed ${liveResult.events.length} timeline events`);

    const hasDeliveredEvent = liveResult.events.some(e => e.status.includes('Delivered'));
    assert(hasDeliveredEvent, 'Timeline contains "Delivered" milestone event');

    console.log('  Live parsed sample event:', liveResult.events[0]);

    // Test invalid format guard
    const invalidFormatResult = await fetchStCourierLiveTracking('999');
    assert(invalidFormatResult.isValid === false, 'Invalid format rejected without network call');
    assert(invalidFormatResult.statusCode === 400, 'Invalid format returns status 400');

    // -----------------------------------------------------------------
    // TEST 4: Manual AWB Entry vs Auto-Generated AWB
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Manual AWB Entry vs Auto-Generated AWB ---');
    
    // Auto-generated 11-digit AWB
    const autoAwb = generateAwbNumber('st_courier');
    assert(/^\d{11}$/.test(autoAwb), `Auto-generated ST Courier AWB is exactly 11 digits: ${autoAwb}`);

    const baseShipmentInput: OutwardShipmentInput = {
        orderNumber: 'ORD-2026-LUM88',
        invoiceNumber: 'INV-2026-0099',
        carrier: 'st_courier',
        senderAddress: {
            recipientName: 'Luminila Vault',
            phone: '9840123456',
            streetAddress: '12 Jeweler Row',
            city: 'Hosur',
            state: 'Tamil Nadu',
            pincode: '635109',
        },
        deliveryAddress: {
            recipientName: 'Priya Sundaram',
            phone: '9443219876',
            streetAddress: '44 Garden View',
            city: 'Coimbatore',
            state: 'Tamil Nadu',
            pincode: '641021',
        },
        dimensions: {
            lengthCm: 15,
            widthCm: 10,
            heightCm: 6,
            actualWeightGrams: 280,
        },
        isCod: true,
        codAmount: 8500,
        invoiceValue: 8500,
    };

    // Shipment with manual AWB entry (scanned barcode)
    const manualShipment = createShipment({
        ...baseShipmentInput,
        manualAwbNumber: REAL_AWB,
    }, 'zone_b');

    assert(manualShipment.awbNumber === REAL_AWB, `Shipment correctly used manual AWB: ${manualShipment.awbNumber}`);
    assert(manualShipment.carrier === 'st_courier', 'Carrier is st_courier');
    assert(manualShipment.barcodeString === `*${REAL_AWB}*`, 'Barcode string formatted for optical barcode scanner');
    assert(manualShipment.trackingUrl.includes(REAL_AWB), 'Tracking URL contains manual AWB');

    // Manual AWB format validation guard
    let caughtInvalidAwb = false;
    try {
        createShipment({
            ...baseShipmentInput,
            manualAwbNumber: '1234', // Invalid: only 4 digits
        });
    } catch (err: any) {
        caughtInvalidAwb = true;
        assert(err.message.includes('ST Courier tracking number must be exactly 11 numeric digits'), 'Rejects invalid manual AWB with descriptive error');
    }
    assert(caughtInvalidAwb, 'Threw error on invalid manual AWB');

    // -----------------------------------------------------------------
    // TEST 5: End-of-Day Dispatch Manifest Compilation
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Dispatch Manifest with ST Courier Parcels ---');
    const parcel1 = createShipment({
        ...baseShipmentInput,
        orderNumber: 'ORD-STC-001',
        manualAwbNumber: REAL_AWB,
    });
    const parcel2 = createShipment({
        ...baseShipmentInput,
        orderNumber: 'ORD-STC-002',
        manualAwbNumber: '64437374633',
    });

    const manifest = compileDispatchManifest([parcel1, parcel2], 'st_courier', 42);
    assert(manifest.manifestNumber.startsWith('MNF-STC-'), `Manifest prefix is MNF-STC: ${manifest.manifestNumber}`);
    assert(manifest.totalParcels === 2, 'Total parcels is 2');
    assert(manifest.shipmentAwbs.includes(REAL_AWB), 'Manifest lists real AWB 64437374632');
    assert(manifest.carrier === 'st_courier', 'Manifest carrier is st_courier');
    assert(manifest.totalCodValue === 17000, `Total COD calculated correctly: ₹${manifest.totalCodValue}`);

    console.log('\n======================================================');
    console.log('✅ ALL ST COURIER TESTS PASSED WITH 100% SUCCESS!');
    console.log('======================================================\n');
}

runTests().catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
});
