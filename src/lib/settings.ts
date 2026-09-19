import { pb } from "./pocketbase";

export interface StoreSettings {
    storeName: string;
    currency: string;
    email: string;
    phone: string;
    address: string;
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
        address: "",
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
    const defaults = getDefaultStoreSettings(userName, userEmail);
    const key = userId ? `store_settings_${userId}` : "store_settings_default";

    // 1. Try to load from PocketBase store_settings collection
    try {
        const record = await pb.collection("store_settings").getFirstListItem(`key="${key}"`);
        if (record && record.value) {
            const parsed = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            // Update local cache
            if (typeof window !== "undefined") {
                localStorage.setItem(`luminila_settings_${userId || "default"}`, JSON.stringify(parsed));
            }
            return { ...defaults, ...parsed };
        }
    } catch {
        // Record might not exist yet in PB
    }

    // 2. Try localStorage namespaced by user ID
    if (typeof window !== "undefined") {
        const userScoped = localStorage.getItem(`luminila_settings_${userId || "default"}`);
        if (userScoped) {
            try {
                return { ...defaults, ...JSON.parse(userScoped) };
            } catch { /* ignore */ }
        }
    }

    return defaults;
}

export async function saveStoreSettings(settings: StoreSettings, userId?: string): Promise<boolean> {
    const key = userId ? `store_settings_${userId}` : "store_settings_default";

    // 1. Save to local storage namespaced by user
    if (typeof window !== "undefined") {
        localStorage.setItem(`luminila_settings_${userId || "default"}`, JSON.stringify(settings));
        localStorage.setItem("luminila_settings", JSON.stringify(settings));
    }

    // 2. Persist to PocketBase store_settings collection
    try {
        let existingId: string | null = null;
        try {
            const existing = await pb.collection("store_settings").getFirstListItem(`key="${key}"`);
            existingId = existing.id;
        } catch {
            existingId = null;
        }

        if (existingId) {
            await pb.collection("store_settings").update(existingId, {
                value: settings,
                category: "store_config"
            });
        } else {
            await pb.collection("store_settings").create({
                key,
                value: settings,
                category: "store_config"
            });
        }
        return true;
    } catch (err) {
        console.warn("Failed to persist settings to PocketBase:", err);
        return false;
    }
}
