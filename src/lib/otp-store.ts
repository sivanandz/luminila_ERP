import crypto from "crypto";
import { createTenantClient, sanitizeFilter } from "./pocketbase";

/**
 * OTP store backed by PocketBase (`otp_codes`), not disk.
 *
 * The previous implementation wrote `src/data/otp_store.json`, which is not
 * shared across hosts, is lost on redeploy, and violates the database-first
 * rule (A-13). Records are tenant-scoped by `account_email`; the code is
 * stored only as an HMAC.
 */

interface OtpRow {
    id: string;
    hashed_otp?: string;
    salt?: string;
    expires_at?: string;
    attempts?: number;
    last_requested_at?: string;
    request_count?: number;
    day_key?: string;
    day_count?: number;
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
const MAX_VERIFY_ATTEMPTS = 5;
const OTP_DAILY_LIMIT_ENV = Number(process.env.OTP_DAILY_LIMIT || 5);
// A non-numeric env value yields NaN, and `dayCount >= NaN` is always false —
// silently disabling the cap (audit F6). Fall back to the default instead.
const MAX_DAILY_REQUESTS = Number.isFinite(OTP_DAILY_LIMIT_ENV) ? Math.max(1, OTP_DAILY_LIMIT_ENV) : 5;

function hashOtp(otp: string, salt: string): string {
    return crypto.createHmac("sha256", salt).update(otp).digest("hex");
}

function normalizeTenant(tenant?: string): string {
    return (tenant || "").trim().toLowerCase();
}

/**
 * One canonical phone form for every OTP read and write.
 *
 * Storefront callers send `+91...`, `91...` and bare 10-digit numbers; storing
 * one form and verifying another is why codes minted on send failed on verify
 * (A-14 / SF-12).
 */
function normalizePhone(phone: string): string {
    return String(phone ?? "").replace(/\D/g, "").slice(-10);
}

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function iso(ms: number): string {
    return new Date(ms).toISOString();
}

function tenantClause(tenant: string): string {
    return tenant ? `account_email = "${sanitizeFilter(tenant)}"` : `account_email = ""`;
}

async function findRow(
    tenant: string,
    phone: string
): Promise<OtpRow | null> {
    const client = await createTenantClient(tenant || undefined);
    return client
        .collection("otp_codes")
        .getFirstListItem<OtpRow>(
            `${tenantClause(tenant)} && phone = "${sanitizeFilter(phone)}"`,
            { requestKey: null }
        )
        .catch(() => null);
}

export async function generateAndSaveOtp(phone: string, tenant?: string): Promise<{
    success: boolean;
    otp?: string;
    error?: string;
    cooldownRemaining?: number;
}> {
    const cleanPhone = normalizePhone(phone);
    if (cleanPhone.length < 10) {
        return { success: false, error: "Invalid phone number length" };
    }

    const scope = normalizeTenant(tenant);
    const client = await createTenantClient(scope || undefined);
    const existing = await findRow(scope, cleanPhone);
    const now = Date.now();
    const today = todayKey();

    const dayCount = existing && existing.day_key === today ? Number(existing.day_count || 0) : 0;
    if (dayCount >= MAX_DAILY_REQUESTS) {
        return {
            success: false,
            error: `Daily verification limit reached for this number. Try again tomorrow.`,
        };
    }

    if (existing?.last_requested_at) {
        const lastRequested = new Date(existing.last_requested_at).getTime();
        const timeSinceLast = now - lastRequested;
        if (Number.isFinite(lastRequested) && timeSinceLast < RESEND_COOLDOWN_MS) {
            const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - timeSinceLast) / 1000);
            return {
                success: false,
                error: `Please wait ${waitSeconds}s before requesting a new OTP.`,
                cooldownRemaining: waitSeconds,
            };
        }
    }

    // randomInt's upper bound is exclusive; 1000000 allows 999999 (A-22).
    const otp = crypto.randomInt(100000, 1000000).toString();
    const salt = crypto.randomBytes(16).toString("hex");
    const hashedOtp = hashOtp(otp, salt);

    const payload = {
        account_email: scope,
        phone: cleanPhone,
        hashed_otp: hashedOtp,
        salt,
        expires_at: iso(now + OTP_TTL_MS),
        attempts: 0,
        last_requested_at: iso(now),
        request_count: Number(existing?.request_count || 0) + 1,
        day_key: today,
        day_count: dayCount + 1,
    };

    try {
        if (existing) {
            await client.collection("otp_codes").update(existing.id, payload);
        } else {
            await client.collection("otp_codes").create(payload);
        }
    } catch (err) {
        // A concurrent request may have created the unique (tenant, phone) row
        // between the read and the write; update it instead of failing.
        const raced = await findRow(scope, cleanPhone);
        if (!raced) throw err;
        await client.collection("otp_codes").update(raced.id, payload);
    }

    return { success: true, otp };
}

/**
 * Undo a request whose delivery failed.
 *
 * `generateAndSaveOtp` increments the daily counter before WhatsApp is called,
 * so five failed sends used to lock the number out for the rest of the day
 * without a single code reaching it (A-13). The code is consumed as well: a
 * message that never arrived must not remain verifiable.
 */
export async function releaseOtpAttempt(phone: string, tenant?: string): Promise<void> {
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) return;
    const scope = normalizeTenant(tenant);
    const row = await findRow(scope, cleanPhone);
    if (!row) return;
    const client = await createTenantClient(scope || undefined);
    await client.collection("otp_codes").update(row.id, {
        day_count: Math.max(0, Number(row.day_count || 0) - 1),
        request_count: Math.max(0, Number(row.request_count || 0) - 1),
        hashed_otp: "",
        salt: "",
        expires_at: "",
        attempts: 0,
    });
}

export async function verifyOtp(phone: string, inputOtp: string, tenant?: string): Promise<{
    valid: boolean;
    reason?: string;
}> {
    const cleanPhone = normalizePhone(phone);
    const scope = normalizeTenant(tenant);
    const row = await findRow(scope, cleanPhone);

    if (!row || !row.hashed_otp) {
        return { valid: false, reason: "No active OTP request found for this phone number." };
    }

    const client = await createTenantClient(scope || undefined);
    const clearCode = {
        hashed_otp: "",
        salt: "",
        expires_at: "",
        attempts: 0,
    };

    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (!expiresAt || Date.now() > expiresAt) {
        await client.collection("otp_codes").update(row.id, clearCode);
        return { valid: false, reason: "OTP has expired. Please request a new one." };
    }

    const attempts = Number(row.attempts || 0);
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await client.collection("otp_codes").update(row.id, clearCode);
        return { valid: false, reason: "Too many failed attempts. Please request a new OTP." };
    }

    const computed = hashOtp(inputOtp.trim(), row.salt || "");
    const expected = row.hashed_otp;
    const matches = computed.length === expected.length
        && crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expected));

    if (matches) {
        await client.collection("otp_codes").update(row.id, clearCode);
        return { valid: true };
    }

    await client.collection("otp_codes").update(row.id, { attempts: attempts + 1 });
    return {
        valid: false,
        reason: `Incorrect OTP. ${Math.max(0, MAX_VERIFY_ATTEMPTS - (attempts + 1))} attempts remaining.`,
    };
}
