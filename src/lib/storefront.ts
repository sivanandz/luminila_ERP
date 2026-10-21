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
        await ensureServerAuth(preferredEmail);
        let query = 'key="storefront_content"';
        if (preferredEmail && preferredEmail.trim()) {
            query += ' && account_email="' + preferredEmail.trim().toLowerCase() + '"';
        }

        let record = await pb.collection("store_settings").getFirstListItem(query).catch(() => null);

        if (record && record.value) {
            const cms = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            const boundAdminEmail = cms.adminBinding?.boundAdminEmail || record.account_email || preferredEmail || DEFAULT_BINDING.boundAdminEmail;
            const brandName = cms.branding?.wordmark?.text || cms.hero?.brandName || DEFAULT_BINDING.brandName;
            const customDomain = cms.adminBinding?.customDomain || DEFAULT_BINDING.customDomain;
            return { boundAdminEmail, brandName, customDomain };
        }

        // If preferredEmail was provided but no custom storefront_content was saved yet,
        // strictly honor preferredEmail and lookup store_name for this tenant
        if (preferredEmail && preferredEmail.trim()) {
            const cleanEmail = preferredEmail.trim().toLowerCase();
            let brandName = DEFAULT_BINDING.brandName;
            try {
                const nameRecord = await pb.collection("store_settings").getFirstListItem(`key="store_name" && account_email="${cleanEmail}"`).catch(() => null);
                if (nameRecord?.value) brandName = String(nameRecord.value);
            } catch {}
            return {
                boundAdminEmail: cleanEmail,
                brandName,
                customDomain: DEFAULT_BINDING.customDomain,
            };
        }
    } catch (e) {
        console.warn("[getStorefrontBinding] Error resolving storefront binding:", e);
    }
    return DEFAULT_BINDING;
}
