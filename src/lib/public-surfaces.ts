/**
 * Which application paths may render before authentication.
 *
 * Shared by the client-side AuthGate and the Chrome wrapper so a public
 * storefront page does not get redirected to /login and does not render the
 * operations sidebar. Keep this list minimal: adding a path here makes it
 * reachable without a session.
 */

/** Public app paths (no session required, ERP chrome hidden). */
export const PUBLIC_PATH_PREFIXES = ["/login", "/setup", "/tracking", "/checkout"] as const;

/** Paths the public storefront host may serve. Mirrors PUBLIC minus ERP-only routes. */
export const STOREFRONT_PATH_PREFIXES = ["/checkout", "/tracking", "/api/storefront", "/api/tracking"] as const;

function underAny(pathname: string, prefixes: readonly string[]): boolean {
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isPublicAppPath(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    return underAny(pathname, PUBLIC_PATH_PREFIXES);
}

export function isStorefrontPath(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    return underAny(pathname, STOREFRONT_PATH_PREFIXES);
}
