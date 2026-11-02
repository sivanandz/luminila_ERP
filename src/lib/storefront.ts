import { createTenantClient, sanitizeFilter } from "@/lib/pocketbase";

export interface StorefrontBinding {
    boundAdminEmail: string;
    brandName: string;
    customDomain: string;
}

/**
 * Fallback tenant for a storefront that has never been bound. Shared by the
 * content route and tenant resolver so OTP tokens and orders cannot land on
 * two different default tenants (SF-13).
 */
export const DEFAULT_STOREFRONT_TENANT_EMAIL = "admin@luminila.local";

const DEFAULT_BINDING: StorefrontBinding = {
    boundAdminEmail: DEFAULT_STOREFRONT_TENANT_EMAIL,
    brandName: "Luminila Jewels",
    customDomain: "storefront",
};

const EMAIL_PATTERN = /^[^\s"'\\@<>]+@[^\s"'\\@<>]+$/;

/**
 * Storefront callers are unauthenticated, so the email they send selects a
 * tenant only if it is a plain address. Anything else is dropped instead of
 * being interpolated into a PocketBase filter.
 */
export function normalizeBindingEmail(raw?: string | null): string {
    const clean = (raw || "").trim().toLowerCase();
    return EMAIL_PATTERN.test(clean) ? clean : "";
}

/**
 * An order belongs to the tenant in the customer's signed session. The body may
 * repeat that tenant, but it may not choose a different one.
 */
export function resolveOrderTenant(
    tokenTenant: string,
    requestedEmail?: string | null
): { ok: boolean; tenant: string; error?: string } {
    const tenant = normalizeBindingEmail(tokenTenant);
    if (!tenant) {
        return { ok: false, tenant: "", error: "Session has no valid tenant" };
    }
    const requested = normalizeBindingEmail(requestedEmail);
    if (requested && requested !== tenant) {
        return { ok: false, tenant, error: "Order account does not match the session" };
    }
    return { ok: true, tenant };
}

/**
 * Resolves active storefront binding (admin email & brand name) from PocketBase store_settings
 */
export async function getStorefrontBinding(preferredEmail?: string): Promise<StorefrontBinding> {
    const cleanEmail = normalizeBindingEmail(preferredEmail);
    try {
        // A per-request client keeps this lookup out of the module-global
        // `pb` session, which concurrent requests for different tenants would
        // otherwise overwrite mid-flight (A-09).
        const client = await createTenantClient(cleanEmail || undefined);
        let query = 'key="storefront_content"';
        if (cleanEmail) {
            query += ` && account_email="${sanitizeFilter(cleanEmail)}"`;
        }

        const record = await client.collection("store_settings").getFirstListItem(query).catch(() => null);

        if (record && record.value) {
            const cms = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            const boundAdminEmail = cms.adminBinding?.boundAdminEmail || record.account_email || cleanEmail || DEFAULT_BINDING.boundAdminEmail;
            const brandName = cms.branding?.wordmark?.text || cms.hero?.brandName || DEFAULT_BINDING.brandName;
            const customDomain = cms.adminBinding?.customDomain || DEFAULT_BINDING.customDomain;
            return { boundAdminEmail, brandName, customDomain };
        }

        // If an email was provided but no custom storefront_content exists yet,
        // honor it only when that tenant actually has settings in this database.
        // Previously any caller-supplied address was accepted, so an unknown
        // storefront name was echoed back and used as the tenant.
        if (cleanEmail) {
            const nameRecord = await client
                .collection("store_settings")
                .getFirstListItem(`key="store_name" && account_email="${sanitizeFilter(cleanEmail)}"`)
                .catch(() => null);
            if (nameRecord) {
                return {
                    boundAdminEmail: cleanEmail,
                    brandName: nameRecord.value ? String(nameRecord.value) : DEFAULT_BINDING.brandName,
                    customDomain: DEFAULT_BINDING.customDomain,
                };
            }
            console.warn("[getStorefrontBinding] Requested storefront has no settings, using the default binding");
        }
    } catch (e) {
        console.warn("[getStorefrontBinding] Error resolving storefront binding:", e);
    }
    return DEFAULT_BINDING;
}
