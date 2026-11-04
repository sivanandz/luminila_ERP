import type PocketBase from "pocketbase";
import { createTenantClient } from "@/lib/pocketbase";
import { SINGLE_ACCOUNT_EMAIL, isSingleAccountMode } from "@/lib/deployment-mode";
import { DEFAULT_STOREFRONT_TENANT_EMAIL } from "@/lib/storefront";

const STOREFRONT_CONTENT_KEY = "storefront_content";

export interface StorefrontTenant {
    /** The tenant whose inventory is bound to the storefront content. */
    email: string;
    client: PocketBase;
}

/**
 * Resolve the tenant that owns the storefront.
 *
 * Single-account mode owns one database and one account, so the primary client
 * is returned before any lookup: a stale registry entry or a binding that names
 * another email must not switch the deployment to another database.
 *
 * In multi mode the content record's adminBinding is authoritative; without a
 * hint the shared default storefront tenant is used. The registry's
 * `activeTenantEmail` is a process-global "last admin who signed in" value and
 * must never select the tenant for an unauthenticated public route (SYN-5).
 */
export async function resolveStorefrontTenant(
    hintEmail?: string
): Promise<StorefrontTenant> {
    if (isSingleAccountMode()) {
        return {
            email: SINGLE_ACCOUNT_EMAIL,
            client: await createTenantClient(),
        };
    }

    let email = (hintEmail || "").trim().toLowerCase() || DEFAULT_STOREFRONT_TENANT_EMAIL;

    let client = await createTenantClient(email);

    try {
        // Only the scoped row may bind the storefront. An unscoped
        // `key = "storefront_content"` read returns whichever tenant happens to
        // own the first row and would silently switch the storefront to it
        // (A-08 / SF-04).
        const record = await client
            .collection("store_settings")
            .getFirstListItem(
                client.filter(
                    'key = "storefront_content" && account_email = {:email}',
                    { email }
                )
            )
            .catch(() => null);

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
        /* keep the hint/default tenant */
    }

    return { email, client };
}
