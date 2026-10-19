import { pb, ensureAuth } from "./pocketbase";
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

export async function getStoreSettings(userId?: string, userName?: string, userEmail?: string): Promise<StoreSettings> {
    ensureAuth();
    const currentUserEmail = userEmail || pb.authStore.model?.email;
    const defaults = getDefaultStoreSettings(userName, currentUserEmail);
    const effectiveUserId = userId || pb.authStore.model?.id;
    const key = effectiveUserId ? `store_settings_${effectiveUserId}` : "store_settings_default";

    // 1. Try to load from PocketBase store_settings collection scoped to tenant
    try {
        const filter = currentUserEmail 
            ? `key="${key}" && account_email="${currentUserEmail}"`
            : `key="${key}"`;
        const record = await pb.collection("store_settings").getFirstListItem(filter);
        if (record && record.value) {
            const parsed = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            // Update local cache namespaced by tenant/user
            if (typeof window !== "undefined") {
                const storageId = currentUserEmail || effectiveUserId || "default";
                localStorage.setItem(`luminila_settings_${storageId}`, JSON.stringify(parsed));
            }
            const isGstRegistered = parsed.isGstRegistered !== undefined 
                ? Boolean(parsed.isGstRegistered) 
                : Boolean(parsed.gstin && parsed.gstin.trim() !== "");
            return { ...defaults, ...parsed, isGstRegistered };
        }
    } catch {
        // Record might not exist yet in PB
    }

    // 2. Try localStorage namespaced by user/tenant ID
    if (typeof window !== "undefined") {
        const storageId = currentUserEmail || effectiveUserId || "default";
        const userScoped = localStorage.getItem(`luminila_settings_${storageId}`);
        if (userScoped) {
            try {
                const parsed = JSON.parse(userScoped);
                const isGstRegistered = parsed.isGstRegistered !== undefined 
                    ? Boolean(parsed.isGstRegistered) 
                    : Boolean(parsed.gstin && parsed.gstin.trim() !== "");
                return { ...defaults, ...parsed, isGstRegistered };
            } catch { /* ignore */ }
        }
    }

    return defaults;
}

export async function saveStoreSettings(settings: StoreSettings, userId?: string): Promise<void> {
    ensureAuth();
    const currentUserEmail = pb.authStore.model?.email;
    const effectiveUserId = userId || pb.authStore.model?.id;
    const key = effectiveUserId ? `store_settings_${effectiveUserId}` : "store_settings_default";
    const storageId = currentUserEmail || effectiveUserId || "default";

    // 1. Save to local storage namespaced by tenant
    if (typeof window !== "undefined") {
        localStorage.setItem(`luminila_settings_${storageId}`, JSON.stringify(settings));
    }

    // 2. Persist to PocketBase store_settings collection scoped to tenant
    try {
        let existingId: string | null = null;
        try {
            const filter = currentUserEmail 
                ? `key="${key}" && account_email="${currentUserEmail}"`
                : `key="${key}"`;
            const existing = await pb.collection("store_settings").getFirstListItem(filter);
            existingId = existing.id;
        } catch {
            existingId = null;
        }

        if (existingId) {
            try {
                await pb.collection("store_settings").update(existingId, {
                    value: settings,
                    category: "store_config",
                    ...(currentUserEmail ? { account_email: currentUserEmail } : {})
                });
            } catch (updateErr) {
                if (updateErr instanceof ClientResponseError && updateErr.status === 404) {
                    await pb.collection("store_settings").create({
                        key,
                        value: settings,
                        category: "store_config",
                        ...(currentUserEmail ? { account_email: currentUserEmail } : {})
                    });
                } else {
                    throw updateErr;
                }
            }
        } else {
            await pb.collection("store_settings").create({
                key,
                value: settings,
                category: "store_config",
                ...(currentUserEmail ? { account_email: currentUserEmail } : {})
            });
        }

        // Also sync individual flat keys for legacy and multi-component lookups strictly scoped to tenant
        try {
            const isRegVal = settings.isGstRegistered !== false ? "true" : "false";
            const regFilter = currentUserEmail 
                ? `key="is_gst_registered" && account_email="${currentUserEmail}"`
                : `key="is_gst_registered"`;
            const singleKey = await pb.collection("store_settings").getFirstListItem(regFilter).catch(() => null);
            if (singleKey) {
                await pb.collection("store_settings").update(singleKey.id, { 
                    value: isRegVal,
                    ...(currentUserEmail ? { account_email: currentUserEmail } : {})
                });
            } else {
                await pb.collection("store_settings").create({ 
                    key: "is_gst_registered", 
                    value: isRegVal, 
                    category: "tax",
                    ...(currentUserEmail ? { account_email: currentUserEmail } : {})
                });
            }

            if (settings.isGstRegistered === false) {
                const gstinFilter = currentUserEmail ? `key="gstin" && account_email="${currentUserEmail}"` : `key="gstin"`;
                const gstinKey = await pb.collection("store_settings").getFirstListItem(gstinFilter).catch(() => null);
                if (gstinKey) await pb.collection("store_settings").update(gstinKey.id, { value: "" }).catch(() => null);

                const storeGstinFilter = currentUserEmail ? `key="store_gstin" && account_email="${currentUserEmail}"` : `key="store_gstin"`;
                const storeGstinKey = await pb.collection("store_settings").getFirstListItem(storeGstinFilter).catch(() => null);
                if (storeGstinKey) await pb.collection("store_settings").update(storeGstinKey.id, { value: "" }).catch(() => null);
            }

            // Sync flat address and store details
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

            for (const [k, v] of Object.entries(flatSyncKeys)) {
                try {
                    const kFilter = currentUserEmail 
                        ? `key="${k}" && account_email="${currentUserEmail}"`
                        : `key="${k}"`;
                    const row = await pb.collection("store_settings").getFirstListItem(kFilter).catch(() => null);
                    if (row) {
                        await pb.collection("store_settings").update(row.id, { 
                            value: v,
                            ...(currentUserEmail ? { account_email: currentUserEmail } : {})
                        });
                    } else {
                        await pb.collection("store_settings").create({ 
                            key: k, 
                            value: v, 
                            category: "general",
                            ...(currentUserEmail ? { account_email: currentUserEmail } : {})
                        });
                    }
                } catch { /* ignore individual key errors */ }
            }
        } catch { /* ignore optional individual key sync */ }
    } catch (err) {
        console.warn("Failed to persist settings to PocketBase:", err);
        throw err;
    }
}
