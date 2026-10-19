/**
 * Utility to resolve ERP backend API URLs seamlessly across local dev ports and production deployments.
 */
export function getStorefrontApiUrl(endpoint: string = "/api/storefront/content"): string {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

    if (process.env.NEXT_PUBLIC_ERP_API_URL) {
        return `${process.env.NEXT_PUBLIC_ERP_API_URL.replace(/\/$/, "")}${cleanEndpoint}`;
    }

    // In local development, resolve ERP host (port 3000) consistently on both server and client to prevent hydration mismatch
    if (process.env.NODE_ENV === "development") {
        return `http://localhost:3000${cleanEndpoint}`;
    }

    if (typeof window !== "undefined") {
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
            return `http://localhost:3000${cleanEndpoint}`;
        }
    }

    return cleanEndpoint;
}
