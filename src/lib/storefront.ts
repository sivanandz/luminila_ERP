import { pb, ensureServerAuth } from "@/lib/pocketbase";

export interface StorefrontBinding {
    boundAdminEmail: string;
    brandName: string;
    customDomain: string;
}

const DEFAULT_BINDING: StorefrontBinding = {
    boundAdminEmail: "admin@luminila.internal",
    brandName: "Luminila Jewels",
    customDomain: "storefront",
};

/**
 * Resolves active storefront binding (admin email & brand name) from PocketBase store_settings
 */
export async function getStorefrontBinding(preferredEmail?: string): Promise<StorefrontBinding> {
    try {
        await ensureServerAuth();
        let query = 'key="storefront_content"';
        if (preferredEmail && preferredEmail.trim()) {
            query += ' && account_email="' + preferredEmail.trim().toLowerCase() + '"';
        }

        let record = await pb.collection("store_settings").getFirstListItem(query).catch(() => null);

        // Fallback to first available storefront_content if preferredEmail didn't match
        if (!record && preferredEmail) {
            record = await pb.collection("store_settings").getFirstListItem('key="storefront_content"').catch(() => null);
        }

        if (record && record.value) {
            const cms = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            const boundAdminEmail = cms.adminBinding?.boundAdminEmail || record.account_email || DEFAULT_BINDING.boundAdminEmail;
            const brandName = cms.branding?.wordmark?.text || cms.hero?.brandName || DEFAULT_BINDING.brandName;
            const customDomain = cms.adminBinding?.customDomain || DEFAULT_BINDING.customDomain;
            return { boundAdminEmail, brandName, customDomain };
        }
    } catch (e) {
        console.warn("[getStorefrontBinding] Error resolving storefront binding:", e);
    }
    return DEFAULT_BINDING;
}
