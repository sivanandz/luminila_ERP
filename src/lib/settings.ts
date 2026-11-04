import { pb, ensureAuth, accountScopeEmail, sanitizeFilter } from "./pocketbase";
import { ClientResponseError } from "pocketbase";

export interface StoreSettings {
    storeName: string;
    currency: string;
    email: string;
    phone: string;
    whatsappPhone?: string;
    address: string;
    city?: string;
    state?: string;
    pincode?: string;
    lowStockThreshold: number;
    companyLogo: string | null;
    defaultPrintMode: string;
    gstin: string;
    pan: string;
    stateCode: string;
    bankName: string;
    accountNumber: string;
    ifsc: string;
    branch: string;
    invoiceFooter: string;
    isGstRegistered?: boolean;
    // Integrations
    shopifyStore: string;
    shopifyToken: string;
    // PhonePe
    phonepeMerchantId: string;
    phonepeSaltKey: string;
    phonepeSaltIndex: string;
    phonepeEnv: string;
    // Razorpay
    razorpayKeyId: string;
    razorpayKeySecret: string;
    razorpayWebhookSecret: string;
    razorpayEnv: string;
}

export function getDefaultStoreSettings(userName?: string, userEmail?: string): StoreSettings {
    return {
        storeName: userName ? `${userName}'s Store` : "My Jewelry Store",
        currency: "INR",
        email: userEmail || "",
        phone: "",
        whatsappPhone: "",
        address: "",
        city: "",
        state: "",
        pincode: "",
        lowStockThreshold: 5,
        companyLogo: null,
        defaultPrintMode: "regular",
        gstin: "",
        pan: "",
        stateCode: "",
        bankName: "",
        accountNumber: "",
        ifsc: "",
        branch: "",
        invoiceFooter: "Thank you for your business!",
        isGstRegistered: true,
        shopifyStore: "",
        shopifyToken: "",
        phonepeMerchantId: "",
        phonepeSaltKey: "",
        phonepeSaltIndex: "1",
        phonepeEnv: "UAT",
        razorpayKeyId: "",
        razorpayKeySecret: "",
        razorpayWebhookSecret: "",
        razorpayEnv: "TEST",
    };
}

/** Coerce a loaded value to a trimmed string (AI-SYS-07: `[safe-primitives]`). */
function asTrimmedString(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (value === null || value === undefined) return "";
    return String(value).trim();
}

/**
 * Merge a parsed settings blob over the defaults, forcing the string fields the
 * rest of the app calls `.trim()` on to be strings.
 */
function normalizeLoadedSettings(parsed: Record<string, unknown>, defaults: StoreSettings): StoreSettings {
    const gstin = asTrimmedString(parsed.gstin);
    const pincode = asTrimmedString(parsed.pincode);
    const phone = asTrimmedString(parsed.phone);
    const whatsappPhone = asTrimmedString(parsed.whatsappPhone);
    const isGstRegistered = parsed.isGstRegistered !== undefined
        ? Boolean(parsed.isGstRegistered)
        : gstin !== "";
    return {
        ...defaults,
        ...(parsed as Partial<StoreSettings>),
        gstin,
        pincode,
        phone,
        whatsappPhone,
        isGstRegistered,
    };
}

/**
 * Tenant scope for settings. The owning account's email (not the signed-in
 * staff member's) is the settings key, so staff edits land on the tenant's
 * `store_config` row instead of a personal copy (AI-SYS-08).
 */
function tenantScopeEmail(): string {
    ensureAuth();
    return accountScopeEmail();
}

function tenantClause(tenant: string): string {
    return `account_email="${sanitizeFilter(tenant)}"`;
}

/**
 * Settings fields that are payment-gateway credentials. They belong in the
 * tenant's PocketBase settings row (server-read) and must never be mirrored into
 * browser localStorage, where any XSS can read them (SET-4 / PAY-1).
 */
const CLIENT_SECRET_FIELDS = [
    "razorpayKeySecret",
    "razorpayWebhookSecret",
    "phonepeSaltKey",
    "shopifyToken",
] as const;

function stripClientSecrets(settings: Record<string, unknown>): Record<string, unknown> {
    const clone = { ...settings };
    for (const field of CLIENT_SECRET_FIELDS) delete clone[field];
    return clone;
}

function readLocalSettings(storageId: string): Record<string, unknown> | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(`luminila_settings_${storageId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

export async function getStoreSettings(userId?: string, userName?: string, userEmail?: string): Promise<StoreSettings> {
    ensureAuth();
    const tenant = tenantScopeEmail();
    const defaults = getDefaultStoreSettings(userName, userEmail || tenant);
    const storageId = tenant || userId || "default";

    // 1. Try to load the tenant's canonical settings row from PocketBase.
    if (tenant) {
        const scope = tenantClause(tenant);
        try {
            const tenantKey = `store_settings_${tenant}`;
            let record = await pb
                .collection("store_settings")
                .getFirstListItem(`key="${sanitizeFilter(tenantKey)}" && ${scope}`)
                .catch(() => null);

            // Existing installs key the row by the owner's user id. Prefer the
            // oldest store_config row (the original owner config) over a staff
            // copy created by the old per-user keying (AI-SYS-08).
            if (!record) {
                record = await pb
                    .collection("store_settings")
                    .getFirstListItem(`category="store_config" && ${scope}`, { sort: "created" })
                    .catch(() => null);
            }

            // Last resort: the legacy per-user key of the signing-in user.
            if (!record && userId) {
                record = await pb
                    .collection("store_settings")
                    .getFirstListItem(`key="store_settings_${sanitizeFilter(userId)}" && ${scope}`)
                    .catch(() => null);
            }

            const rawValue = (record as { value?: unknown } | null)?.value;
            if (rawValue) {
                const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
                if (parsed && typeof parsed === "object") {
                    if (typeof window !== "undefined") {
                        localStorage.setItem(
                            `luminila_settings_${storageId}`,
                            JSON.stringify(stripClientSecrets(parsed))
                        );
                    }
                    return normalizeLoadedSettings(parsed as Record<string, unknown>, defaults);
                }
            }
        } catch {
            // Record might not exist yet (or be unreadable); fall back to local.
        }
    }

    // 2. Try localStorage namespaced by tenant.
    const local = readLocalSettings(storageId) ?? (userId ? readLocalSettings(userId) : null);
    if (local) {
        return normalizeLoadedSettings(local, defaults);
    }

    return defaults;
}

export async function saveStoreSettings(settings: StoreSettings, userId?: string): Promise<void> {
    ensureAuth();
    const tenant = tenantScopeEmail();
    const storageId = tenant || userId || "default";

    // 1. Save to local storage namespaced by tenant — without gateway secrets.
    if (typeof window !== "undefined") {
        localStorage.setItem(
            `luminila_settings_${storageId}`,
            JSON.stringify(stripClientSecrets(settings as unknown as Record<string, unknown>))
        );
    }

    if (!tenant) {
        // Without a resolved tenant every PocketBase filter would be unscoped.
        console.warn("Settings not persisted: no tenant account could be resolved.");
        return;
    }

    const scope = tenantClause(tenant);

    // 2. Persist to the tenant's canonical settings row, choosing the same row
    // the load path reads.
    try {
        const tenantKey = `store_settings_${tenant}`;
        let existing = await pb
            .collection("store_settings")
            .getFirstListItem(`key="${sanitizeFilter(tenantKey)}" && ${scope}`)
            .catch(() => null);

        if (!existing) {
            existing = await pb
                .collection("store_settings")
                .getFirstListItem(`category="store_config" && ${scope}`, { sort: "created" })
                .catch(() => null);
        }
        if (!existing && userId) {
            existing = await pb
                .collection("store_settings")
                .getFirstListItem(`key="store_settings_${sanitizeFilter(userId)}" && ${scope}`)
                .catch(() => null);
        }

        const existingRecord = existing as { id: string; key?: string; account_email?: string } | null;
        const key = existingRecord?.key || `store_settings_${tenant}`;
        const shouldClaim = !existingRecord || !existingRecord.account_email;
        const payload = {
            key,
            value: settings,
            category: "store_config",
            ...(shouldClaim ? { account_email: tenant } : {}),
        };

        if (existingRecord) {
            try {
                await pb.collection("store_settings").update(existingRecord.id, payload);
            } catch (updateErr) {
                if (updateErr instanceof ClientResponseError && updateErr.status === 404) {
                    await pb.collection("store_settings").create({ ...payload, account_email: tenant });
                } else {
                    throw updateErr;
                }
            }
        } else {
            await pb.collection("store_settings").create({ ...payload, account_email: tenant });
        }

        // 3. Sync the individual flat keys legacy and multi-component lookups
        // read, strictly scoped to the tenant.
        try {
            const upsertFlat = async (flatKey: string, value: string, category: string) => {
                const filter = `key="${sanitizeFilter(flatKey)}" && ${scope}`;
                const row = await pb.collection("store_settings").getFirstListItem(filter).catch(() => null);
                const rowRecord = row as { id: string; account_email?: string } | null;
                if (rowRecord) {
                    await pb.collection("store_settings").update(rowRecord.id, {
                        value,
                        ...(!rowRecord.account_email ? { account_email: tenant } : {}),
                    });
                } else {
                    await pb.collection("store_settings").create({
                        key: flatKey,
                        value,
                        category,
                        account_email: tenant,
                    });
                }
            };

            const isRegVal = settings.isGstRegistered !== false ? "true" : "false";
            await upsertFlat("is_gst_registered", isRegVal, "tax");

            if (settings.isGstRegistered === false) {
                const gstinKey = await pb
                    .collection("store_settings")
                    .getFirstListItem(`key="gstin" && ${scope}`)
                    .catch(() => null);
                if (gstinKey) await pb.collection("store_settings").update((gstinKey as { id: string }).id, { value: "" }).catch(() => null);

                const storeGstinKey = await pb
                    .collection("store_settings")
                    .getFirstListItem(`key="store_gstin" && ${scope}`)
                    .catch(() => null);
                if (storeGstinKey) await pb.collection("store_settings").update((storeGstinKey as { id: string }).id, { value: "" }).catch(() => null);
            }

            // Sync flat address and store details.
            const flatSyncKeys: Record<string, string> = {
                store_name: settings.storeName || "",
                storeName: settings.storeName || "",
                address: settings.address || "",
                store_address: settings.address || "",
                city: settings.city || "",
                store_city: settings.city || "",
                state: settings.state || "",
                store_state: settings.state || "",
                pincode: settings.pincode || "",
                store_pincode: settings.pincode || "",
                stateCode: settings.stateCode || "",
                store_state_code: settings.stateCode || "",
                whatsappPhone: settings.whatsappPhone || "",
                store_phone: settings.whatsappPhone || settings.phone || "",
                phone: settings.phone || settings.whatsappPhone || "",
                email: settings.email || "",
                store_email: settings.email || "",
            };

            for (const [flatKey, value] of Object.entries(flatSyncKeys)) {
                try {
                    await upsertFlat(flatKey, value, "general");
                } catch {
                    /* ignore individual key errors */
                }
            }
        } catch {
            /* ignore optional individual key sync */
        }
    } catch (err) {
        console.warn("Failed to persist settings to PocketBase:", err);
        throw err;
    }
}
