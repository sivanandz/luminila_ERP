import assert from "node:assert/strict";
import { parseVendorOffer } from "../lib/whatsapp-crm";
import { WhatsAppManager } from "../lib/whatsapp";

async function main() {
    console.log("=== test-whatsapp-fixes ===");

    // 1. Test Vendor Offer Per-Gram Price Calculation
    {
        const offer1 = "22K Temple Necklace 45.2 grams @ 6200/gm with rubies";
        const parsed1 = parseVendorOffer(offer1);
        assert.equal(parsed1.purity, "22K");
        assert.equal(parsed1.weightGrams, 45.2);
        assert.equal(parsed1.isPerGram, true);
        assert.equal(parsed1.ratePerGram, 6200);
        // Total price should be 45.2 * 6200 = 280240
        assert.equal(parsed1.price, Math.round(45.2 * 6200));
        console.log("  PASS  vendor offer per-gram rate calculates total unit price correctly");

        const offer2 = "Antique Gold Choker 1 pcs ₹45,000 fixed price";
        const parsed2 = parseVendorOffer(offer2);
        assert.equal(parsed2.isPerGram, false);
        assert.equal(parsed2.price, 45000);
        console.log("  PASS  vendor offer flat unit rate preserved when not per-gram");
    }

    // 2. Test WhatsAppManager dynamic session resolution
    {
        const mgr = new WhatsAppManager();
        // With no explicit session set, it resolves to default or tenant
        const sid = mgr.getSessionIdSafe();
        assert.ok(sid && typeof sid === "string", "Session ID should be non-empty");

        mgr.setSessionId("wpp_store_custom");
        assert.equal(mgr.getSessionIdSafe(), "wpp_store_custom");
        console.log("  PASS  WhatsAppManager session fallback & override work seamlessly");
    }

    console.log("=== test-whatsapp-fixes: ALL PASSED ===");
}

main().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
