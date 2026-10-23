/**
 * Private ERP / public storefront routing (Next.js 16 proxy convention).
 *
 * One Next server serves both surfaces, but only the storefront hostname is
 * published. This proxy is the last line of defence: a request whose Host is
 * the public storefront cannot reach ERP pages or admin APIs, and unknown hosts
 * get the public-safe view. The private ERP is reached over Tailscale, where
 * the host appears in ADMIN_HOSTS and every route is allowed.
 *
 * The guard is disabled when neither ADMIN_HOSTS nor STOREFRONT_HOSTS is set,
 * so the desktop build, local development and CI behave exactly as before.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
    classifyHost,
    isPathAllowed,
    parseHostGuardConfig,
} from "@/lib/host-guard";

export default function proxy(request: NextRequest) {
    const config = parseHostGuardConfig(process.env);
    if (!config.enabled) {
        return NextResponse.next();
    }

    const role = classifyHost(request.headers.get("host"), config);
    const pathname = request.nextUrl.pathname;

    if (!isPathAllowed(role, pathname)) {
        // 404 rather than a redirect: a public visitor should not learn that an
        // operations surface exists on this server.
        return new NextResponse("Not Found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
        });
    }

    const response = NextResponse.next();
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (role === "admin") {
        response.headers.set("X-Frame-Options", "DENY");
        response.headers.set("X-Robots-Tag", "noindex, nofollow");
    }
    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image).*)"],
};
