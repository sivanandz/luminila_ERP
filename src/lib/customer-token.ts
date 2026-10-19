import crypto from "crypto";

let fallbackSecret: string | null = null;
function getSecret(): string {
    const envSecret = process.env.CUSTOMER_SESSION_SECRET || process.env.JWT_SECRET;
    if (envSecret && envSecret.trim()) {
        return envSecret.trim();
    }
    if (!fallbackSecret) {
        fallbackSecret = crypto.randomBytes(32).toString("hex");
        console.warn("[CustomerToken] WARNING: Neither CUSTOMER_SESSION_SECRET nor JWT_SECRET set. Generated dynamic ephemeral secret for this process.");
    }
    return fallbackSecret;
}

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
    const secret = getSecret();
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
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
    const secret = getSecret();
    const expectedSignature = crypto.createHmac("sha256", secret).update(data).digest("base64url");

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
