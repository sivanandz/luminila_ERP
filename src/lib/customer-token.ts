import crypto from "crypto";

const TOKEN_SECRET = process.env.CUSTOMER_SESSION_SECRET || process.env.JWT_SECRET || "luminila-customer-secret-key-2026";

export interface CustomerTokenPayload {
    id: string;
    phone: string;
    tenant: string;
    exp: number;
}

/**
 * Sign customer session token with HMAC-SHA256
 */
export function signCustomerToken(payload: CustomerTokenPayload): string {
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(data).digest("base64url");
    return `${data}.${signature}`;
}

/**
 * Verify and decode customer session token
 */
export function verifyCustomerToken(tokenString: string): CustomerTokenPayload | null {
    if (!tokenString || typeof tokenString !== "string") return null;
    const parts = tokenString.split(".");
    if (parts.length !== 2) return null;

    const [data, signature] = parts;
    const expectedSignature = crypto.createHmac("sha256", TOKEN_SECRET).update(data).digest("base64url");

    try {
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            return null;
        }

        const payload: CustomerTokenPayload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
        if (payload.exp && Date.now() > payload.exp) {
            return null; // Expired
        }
        return payload;
    } catch {
        return null;
    }
}
