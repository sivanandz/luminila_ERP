/// <reference path="../pb_data/types.d.ts" />

/**
 * Extend the `payment_links` ledger for WhatsApp concierge orders (2026-10-24).
 *
 * The chat order flow (src/lib/chat-sales.ts) writes a payment-ledger row the
 * moment an order is confirmed, before any gateway exists: provider
 * `manual_upi`, status `pending`. Both values were outside the collection's
 * select enums ({razorpay,phonepe} / {created,paid,...}), so the ledger write
 * was rejected and the chat channel silently had no payment trail.
 *
 * Down restores the original enums.
 */

migrate((app) => {
    const links = app.findCollectionByNameOrId("payment_links");

    const provider = links.fields.getByName("provider");
    if (!provider.values.includes("manual_upi")) {
        provider.values.push("manual_upi");
    }

    const status = links.fields.getByName("status");
    if (!status.values.includes("pending")) {
        status.values.push("pending");
    }

    app.save(links);
}, (app) => {
    const links = app.findCollectionByNameOrId("payment_links");

    const provider = links.fields.getByName("provider");
    provider.values = provider.values.filter((v) => v !== "manual_upi");

    const status = links.fields.getByName("status");
    status.values = status.values.filter((v) => v !== "pending");

    app.save(links);
});
