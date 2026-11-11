import { createTenantClient, sanitizeFilter } from "@/lib/pocketbase";
import { isSingleAccountMode, SINGLE_ACCOUNT_EMAIL } from "@/lib/deployment-mode";

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
 * The tenants a public (unauthenticated) storefront caller may address.
 *
 * Single mode: the one account, always. Multi mode: an explicit server-side
 * allowlist (`STOREFRONT_TENANTS` / `STOREFRONT_TENANT_EMAILS`, comma
 * separated). A caller-supplied email that is not allow-listed resolves to ""
 * and every public route must fail closed — an anonymous request must never
 * open a tenant database it was not configured to serve (audit C-01/C-02).
 */
export function resolvePublicStorefrontTenant(raw?: string | null): string {
    if (isSingleAccountMode()) return SINGLE_ACCOUNT_EMAIL;
    const clean = normalizeBindingEmail(raw);
    if (!clean) return "";
    const allowList = (process.env.STOREFRONT_TENANTS || process.env.STOREFRONT_TENANT_EMAILS || "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    return allowList.includes(clean) ? clean : "";
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
    // Single mode has exactly one account. The legacy `admin@luminila.local`
    // default must never win here: the catalog resolver pins the same
    // deployment to SINGLE_ACCOUNT_EMAIL, so a different binding here would
    // make every storefront order fail the product-ownership check (M-02).
    if (isSingleAccountMode()) {
        const single = await createTenantClient();
        const record = await single
            .collection("store_settings")
            .getFirstListItem(
                `key="storefront_content" && account_email="${sanitizeFilter(SINGLE_ACCOUNT_EMAIL)}"`
            )
            .catch(() => null);
        let brandName = DEFAULT_BINDING.brandName;
        let customDomain = DEFAULT_BINDING.customDomain;
        if (record && record.value) {
            const cms = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
            brandName = cms?.branding?.wordmark?.text || cms?.hero?.brandName || brandName;
            customDomain = cms?.adminBinding?.customDomain || customDomain;
        }
        return { boundAdminEmail: SINGLE_ACCOUNT_EMAIL, brandName, customDomain };
    }

    const cleanEmail = normalizeBindingEmail(preferredEmail);
    // The caller may be anonymous, but the lookup may not be: a bare
    // `key="storefront_content"` read returns whichever tenant owns the first
    // row and would bind a public storefront to an arbitrary account (SYN-3).
    // Without a tenant there is nothing tenant-specific to resolve.
    if (!cleanEmail) return DEFAULT_BINDING;
    try {
        // A per-request client keeps this lookup out of the module-global
        // `pb` session, which concurrent requests for different tenants would
        // otherwise overwrite mid-flight (A-09).
        const client = await createTenantClient(cleanEmail);
        const query = `key="storefront_content" && account_email="${sanitizeFilter(cleanEmail)}"`;

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
    } catch (e) {
        console.warn("[getStorefrontBinding] Error resolving storefront binding:", e);
    }
    return DEFAULT_BINDING;
}
