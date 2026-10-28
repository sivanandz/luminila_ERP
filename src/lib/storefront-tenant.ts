import type PocketBase from "pocketbase";
import { createTenantClient } from "@/lib/pocketbase";
import { readTenantRegistry } from "@/lib/tenant-db-manager";

const STOREFRONT_CONTENT_KEY = "storefront_content";
const PRIMARY_ADMIN_EMAIL = "admin@luminila.local";

export interface StorefrontTenant {
    /** The tenant whose inventory is bound to the storefront content. */
    email: string;
    client: PocketBase;
}

/**
 * Resolve the tenant that owns the storefront. The content record's
 * adminBinding is authoritative; the registry/primary fallbacks only apply
 * before the CMS has ever bound a tenant.
 */
export async function resolveStorefrontTenant(
    hintEmail?: string
): Promise<StorefrontTenant> {
    let email = (hintEmail || "").trim().toLowerCase();

    if (!email) {
        try {
            email = (readTenantRegistry().activeTenantEmail || "").trim().toLowerCase();
        } catch {
            email = "";
        }
    }
    if (!email) email = PRIMARY_ADMIN_EMAIL;

    let client = await createTenantClient(email);

    try {
        let record = await client
            .collection("store_settings")
            .getFirstListItem(
                client.filter(
                    'key = "storefront_content" && account_email = {:email}',
                    { email }
                )
            )
            .catch(() => null);

        if (!record) {
            record = await client
                .collection("store_settings")
                .getFirstListItem(
                    client.filter('key = "storefront_content"')
                )
                .catch(() => null);
        }

        const raw = record?.value;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        const bound = String(
            parsed?.adminBinding?.boundAdminEmail || ""
        ).trim().toLowerCase();

        if (bound && bound !== email) {
            email = bound;
            client = await createTenantClient(email);
        }
    } catch {
        /* keep the registry/primary tenant */
    }

    return { email, client };
}
