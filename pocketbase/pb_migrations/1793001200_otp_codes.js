/// <reference path="../pb_data/types.d.ts" />

/**
 * OTP records in PocketBase (A-13).
 *
 * The store used to be `src/data/otp_store.json`: per-host, lost on redeploy,
 * and not tenant-scoped. `otp_codes` keeps one row per (tenant, phone) with an
 * HMAC of the code and the daily/cooldown counters.
 *
 * Construction follows the PB 0.25-safe order: create the collection, add the
 * fields, save, then apply rules/indexes (constructor `fields` are ignored).
 */

const TENANT_RULE =
    '@request.auth.email != "" && (account_email = @request.auth.email || account_email = @request.auth.account_email)';

migrate((app) => {
    let collection = null;
    try {
        collection = app.findCollectionByNameOrId("otp_codes");
    } catch (e) {
        collection = null;
    }

    if (!collection) {
        collection = new Collection({ type: "base", name: "otp_codes" });
        app.save(collection);
    }

    const fields = [
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        { name: "account_email", type: "text", required: true, max: 255 },
        { name: "phone", type: "text", required: true, max: 10 },
        { name: "hashed_otp", type: "text", max: 128 },
        { name: "salt", type: "text", max: 64 },
        { name: "expires_at", type: "date" },
        { name: "attempts", type: "number", min: 0 },
        { name: "last_requested_at", type: "date" },
        { name: "request_count", type: "number", min: 0 },
        { name: "day_key", type: "text", max: 10 },
        { name: "day_count", type: "number", min: 0 },
    ];

    for (const def of fields) {
        if (!collection.fields.find((field) => field.name === def.name)) {
            collection.fields.add(new Field(def));
        }
    }
    app.save(collection);

    unmarshal({
        listRule: TENANT_RULE,
        viewRule: TENANT_RULE,
        createRule: TENANT_RULE,
        updateRule: TENANT_RULE,
        deleteRule: TENANT_RULE,
        indexes: [
            "CREATE UNIQUE INDEX idx_otp_codes_tenant_phone ON otp_codes (account_email, phone)",
            "CREATE INDEX idx_otp_codes_tenant_day ON otp_codes (account_email, day_key)",
        ],
    }, collection);
    app.save(collection);
}, (app) => {
    try {
        const collection = app.findCollectionByNameOrId("otp_codes");
        app.delete(collection);
    } catch (e) {
        // already absent
    }
});
