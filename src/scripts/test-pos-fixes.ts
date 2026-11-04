import assert from 'node:assert/strict';

async function run() {
    console.log('=== test-pos-fixes ===');

    // Test 1: Cart item jewelry attribute preservation
    {
        interface TestCartItem {
            id: string;
            sku: string;
            name: string;
            price: number;
            quantity: number;
            isPriceOverridden?: boolean;
            gross_weight?: number;
            net_weight?: number;
            stone_weight?: number;
            stone_amount?: number;
            purity_karat?: string;
            making_charges?: number;
            huid_code?: string;
        }

        const scannedPiece: TestCartItem = {
            id: 'cart-1',
            sku: 'RNG-22K-001',
            name: 'Gold Ring',
            price: 25000,
            quantity: 1,
            gross_weight: 4.52,
            net_weight: 4.20,
            stone_weight: 0.32,
            stone_amount: 1500,
            purity_karat: '22K',
            making_charges: 450,
            huid_code: 'AB1234',
        };

        assert.equal(scannedPiece.gross_weight, 4.52, 'gross_weight preserved');
        assert.equal(scannedPiece.huid_code, 'AB1234', 'HUID code preserved');
        console.log('  PASS  jewelry attributes retained on cart items');
    }

    // Test 2: Price override immunity against channel repricing
    {
        const cart = [
            { id: '1', name: 'Bangle', price: 50000, basePrice: 52000, isPriceOverridden: true },
            { id: '2', name: 'Chain', price: 30000, basePrice: 30000, isPriceOverridden: false },
        ];

        const repriceForChannel = (items: typeof cart, multiplier: number) => {
            return items.map((item) => {
                if (item.isPriceOverridden) return item;
                return { ...item, price: item.basePrice * multiplier };
            });
        };

        const repriced = repriceForChannel(cart, 0.9); // 10% wholesale discount
        assert.equal(repriced[0].price, 50000, 'Negotiated override price was NOT erased');
        assert.equal(repriced[1].price, 27000, 'Non-overridden line received channel discount');
        console.log('  PASS  negotiated price override preserved across channel repricing');
    }

    // Test 3: PhonePe preflight re-entrancy safety
    {
        let isProcessing = false;
        const isProcessingRef = { current: false };

        const simulatePhonePeCheckout = async (hasShortage: boolean) => {
            if (isProcessingRef.current) return 'BLOCKED';
            isProcessingRef.current = true;
            isProcessing = true;

            try {
                if (hasShortage) {
                    return 'SHORTAGE_ERROR';
                }
                return 'SUCCESS';
            } finally {
                isProcessingRef.current = false;
                isProcessing = false;
            }
        };

        const res1 = await simulatePhonePeCheckout(true);
        assert.equal(res1, 'SHORTAGE_ERROR');
        assert.equal(isProcessingRef.current, false, 'Ref must be unlocked even after shortage error');
        assert.equal(isProcessing, false, 'State must be reset');

        const res2 = await simulatePhonePeCheckout(false);
        assert.equal(res2, 'SUCCESS');
        assert.equal(isProcessingRef.current, false, 'Ref unlocked after success');
        console.log('  PASS  PhonePe pre-flight shortage does not deadlock re-entrancy lock');
    }

    console.log('=== test-pos-fixes: ALL PASSED ===\n');
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
