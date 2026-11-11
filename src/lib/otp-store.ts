import crypto from "crypto";
import { createTenantClient, sanitizeFilter } from "./pocketbase";
import { enqueueTask } from "./concurrency";

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

/**
 * Server-side pepper (audit C-06): the per-row salt used to be the HMAC key and
 * lived in the same row as the hash, so anyone who could read the row could
 * brute-force the 6-digit code offline. `otp_codes` is superuser-only since
 * migration 1793003100; the pepper keeps the hash brute-force-proof even if
 * that rule ever regresses. The salt stays in the payload for schema
 * compatibility but carries no security weight.
 */
function otpPepper(): string {
    return (
        process.env.OTP_HASH_PEPPER ||
        process.env.TENANT_REGISTRY_KEY ||
        process.env.CUSTOMER_SESSION_SECRET ||
        process.env.POCKETBASE_SUPERUSER_PASSWORD ||
        process.env.PB_ADMIN_PASSWORD ||
        ""
    );
}

function hashOtp(otp: string, salt: string, phone: string): string {
    const key = otpPepper() || salt || "luminila-otp";
    return crypto.createHmac("sha256", key).update(`${phone}:${otp}`).digest("hex");
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

    // Serialize generates for this (tenant, phone): the cooldown and daily-limit
    // checks are read-then-write, so two concurrent requests could both pass
    // them and overshoot MAX_DAILY_REQUESTS (AI-5). The daily counter is also
    // reserved atomically below so a second host cannot overshoot either.
    return enqueueTask(`otp_${scope}_${cleanPhone}`, async () => {
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
        const hashedOtp = hashOtp(otp, salt, cleanPhone);

        const buildPayload = (row: OtpRow | null) => ({
            account_email: scope,
            phone: cleanPhone,
            hashed_otp: hashedOtp,
            salt,
            expires_at: iso(now + OTP_TTL_MS),
            attempts: 0,
            last_requested_at: iso(now),
            request_count: Number(row?.request_count || 0) + 1,
        });
        const dailyLimit = {
            success: false as const,
            error: `Daily verification limit reached for this number. Try again tomorrow.`,
        };

        /**
         * Write the new code and reserve the day's slot. Concurrent callers get
         * an atomic `day_count+` first and are rejected on the post-increment
         * value, so neither the read-then-write day check nor the cooldown can
         * be bypassed by parallelism (AI-5).
         */
        const persist = async (row: OtpRow | null): Promise<{ ok: true } | { ok: false; error: string }> => {
            const payload = buildPayload(row);
            if (!row) {
                await client.collection("otp_codes").create({ ...payload, day_key: today, day_count: 1 });
                return { ok: true };
            }
            if (row.day_key === today) {
                const reserved = await client
                    .collection("otp_codes")
                    .update<{ day_count?: number }>(row.id, { "day_count+": 1 });
                if (Number(reserved.day_count || 0) > MAX_DAILY_REQUESTS) {
                    await client
                        .collection("otp_codes")
                        .update(row.id, { "day_count+": -1 })
                        .catch(() => {});
                    return { ok: false, error: dailyLimit.error };
                }
                await client.collection("otp_codes").update(row.id, payload);
                return { ok: true };
            }
            // First request of the day: reset the counter together with the row.
            await client.collection("otp_codes").update(row.id, {
                ...payload,
                day_key: today,
                day_count: 1,
            });
            return { ok: true };
        };

        try {
            const stored = await persist(existing);
            if (!stored.ok) return { success: false, error: stored.error };
        } catch (err) {
            // A concurrent request may have created the unique (tenant, phone) row
            // between the read and the write; update it instead of failing.
            const raced = await findRow(scope, cleanPhone);
            if (!raced) throw err;
            const stored = await persist(raced);
            if (!stored.ok) return { success: false, error: stored.error };
        }

        return { success: true, otp };
    });
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

    // Atomic attempt accounting (AI-4): parallel verifies used to read the same
    // `attempts` value and all pass the pre-check, allowing more than
    // MAX_VERIFY_ATTEMPTS guesses. Increment first and reject from the
    // post-increment value instead.
    const bumped = await client
        .collection("otp_codes")
        .update<{ attempts?: number }>(row.id, { "attempts+": 1 });
    const attempts = Number(bumped.attempts || 0);
    if (attempts > MAX_VERIFY_ATTEMPTS) {
        await client.collection("otp_codes").update(row.id, clearCode);
        return { valid: false, reason: "Too many failed attempts. Please request a new OTP." };
    }

    const computed = hashOtp(inputOtp.trim(), row.salt || "", cleanPhone);
    const expected = row.hashed_otp;
    const matches = computed.length === expected.length
        && crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expected));

    if (matches) {
        await client.collection("otp_codes").update(row.id, clearCode);
        return { valid: true };
    }

    return {
        valid: false,
        reason: `Incorrect OTP. ${Math.max(0, MAX_VERIFY_ATTEMPTS - attempts)} attempts remaining.`,
    };
}
