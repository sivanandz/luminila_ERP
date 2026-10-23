import crypto from "crypto";

/**
 * Customer session signing.
 *
 * A per-process fallback secret used to be generated when the environment was
 * unset. That silently produced tokens which broke on restart and could never
 * verify across two workers. Signing now refuses to run without a configured
 * secret; verification fails closed instead of throwing.
 */

export class MissingSessionSecretError extends Error {
    constructor() {
        super(
            "CUSTOMER_SESSION_SECRET (or JWT_SECRET) must be set. Customer session tokens cannot be signed with a per-process key."
        );
        this.name = "MissingSessionSecretError";
    }
}

function readSecret(): string | null {
    const envSecret = process.env.CUSTOMER_SESSION_SECRET || process.env.JWT_SECRET;
    if (envSecret && envSecret.trim()) {
        return envSecret.trim();
    }
    return null;
}

/** True when sessions can be signed and verified at all. */
export function isCustomerTokenConfigured(): boolean {
    return readSecret() !== null;
}

function getSecret(): string {
    const secret = readSecret();
    if (!secret) throw new MissingSessionSecretError();
    return secret;
}

export interface CustomerTokenPayload {
    id: string;
    phone: string;
    tenant: string;
    exp: number;
}

/**
 * Sign customer session token with HMAC-SHA256.
 * Throws `MissingSessionSecretError` when no secret is configured.
 */
export function signCustomerToken(payload: CustomerTokenPayload): string {
    const secret = getSecret();
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
    return `${data}.${signature}`;
}

/**
 * Verify and decode customer session token.
 * Returns null for anything it cannot trust, including a missing secret.
 */
export function verifyCustomerToken(tokenString: string): CustomerTokenPayload | null {
    if (!tokenString || typeof tokenString !== "string") return null;
    const parts = tokenString.split(".");
    if (parts.length !== 2) return null;

    const secret = readSecret();
    if (!secret) return null;

    const [data, signature] = parts;
    const expectedSignature = crypto.createHmac("sha256", secret).update(data).digest("base64url");

    try {
        const provided = Buffer.from(signature);
        const expected = Buffer.from(expectedSignature);
        if (provided.length !== expected.length) return null;
        if (!crypto.timingSafeEqual(provided, expected)) {
            return null;
        }

        const payload: CustomerTokenPayload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
        if (!payload || typeof payload !== "object" || !payload.id || !payload.tenant) {
            return null;
        }
        if (payload.exp && Date.now() > payload.exp) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}
