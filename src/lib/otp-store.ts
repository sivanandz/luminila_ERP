import crypto from "crypto";
import fs from "fs";
import path from "path";

interface OtpRecord {
    phone: string;
    tenant: string;
    hashedOtp: string;
    salt: string;
    expiresAt: number;
    attempts: number;
    lastRequestedAt: number;
    requestCount: number;
    /** UTC date the daily counter belongs to, for example 2026-10-23. */
    dayKey: string;
    /** Requests accepted for that phone and tenant on dayKey. */
    dayCount: number;
}

const OTP_FILE_PATH = path.join(process.cwd(), "src", "data", "otp_store.json");
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds cooldown
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_DAILY_REQUESTS = Math.max(1, Number(process.env.OTP_DAILY_LIMIT || 5));

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
 * (A-14 / SF-12). The last 10 digits are the Indian subscriber number.
 */
function normalizePhone(phone: string): string {
    return String(phone ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * OTPs are scoped to a tenant as well as a phone, so a code minted for one
 * storefront cannot be replayed against another.
 */
function storageKey(tenant: string | undefined, phone: string): string {
    const scope = normalizeTenant(tenant);
    return scope ? `${scope}:${phone}` : phone;
}

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

function loadStore(): Record<string, OtpRecord> {
    try {
        if (!fs.existsSync(OTP_FILE_PATH)) {
            const dir = path.dirname(OTP_FILE_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(OTP_FILE_PATH, JSON.stringify({}), "utf-8");
            return {};
        }
        const content = fs.readFileSync(OTP_FILE_PATH, "utf-8");
        return JSON.parse(content || "{}");
    } catch (err) {
        console.warn("[OTP Store] Error reading otp_store.json:", err);
        return {};
    }
}

function saveStore(data: Record<string, OtpRecord>) {
    try {
        const dir = path.dirname(OTP_FILE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Keep active codes and today's counters. A record with no active code
        // but a counter from today must survive, otherwise deleting the code
        // would reset the daily cap.
        const now = Date.now();
        const today = todayKey();
        const cleaned: Record<string, OtpRecord> = {};
        for (const [key, val] of Object.entries(data)) {
            if (val.expiresAt > now || val.dayKey === today) {
                cleaned[key] = val;
            }
        }
        fs.writeFileSync(OTP_FILE_PATH, JSON.stringify(cleaned, null, 2), "utf-8");
    } catch (err) {
        console.error("[OTP Store] Error writing otp_store.json:", err);
    }
}

/** Consume the active code but keep the daily counter intact. */
function consumeCode(record: OtpRecord) {
    record.hashedOtp = "";
    record.salt = "";
    record.expiresAt = 0;
    record.attempts = 0;
}

export function generateAndSaveOtp(phone: string, tenant?: string): {
    success: boolean;
    otp?: string;
    error?: string;
    cooldownRemaining?: number;
} {
    const cleanPhone = normalizePhone(phone);
    if (cleanPhone.length < 10) {
        return { success: false, error: "Invalid phone number length" };
    }

    const store = loadStore();
    const key = storageKey(tenant, cleanPhone);
    const existing = store[key];
    const now = Date.now();
    const today = todayKey();

    const dayCount = existing && existing.dayKey === today ? existing.dayCount : 0;
    if (dayCount >= MAX_DAILY_REQUESTS) {
        return {
            success: false,
            error: `Daily verification limit reached for this number. Try again tomorrow.`,
        };
    }

    if (existing) {
        const timeSinceLast = now - existing.lastRequestedAt;
        if (timeSinceLast < RESEND_COOLDOWN_MS) {
            const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - timeSinceLast) / 1000);
            return {
                success: false,
                error: `Please wait ${waitSeconds}s before requesting a new OTP.`,
                cooldownRemaining: waitSeconds,
            };
        }
    }

    // Generate cryptographically secure 6-digit numeric OTP. randomInt's upper
    // bound is exclusive, so 999999 as the bound could never be generated
    // (A-22).
    const otp = crypto.randomInt(100000, 1000000).toString();
    const salt = crypto.randomBytes(16).toString("hex");
    const hashedOtp = hashOtp(otp, salt);

    store[key] = {
        phone: cleanPhone,
        tenant: normalizeTenant(tenant),
        hashedOtp,
        salt,
        expiresAt: now + OTP_TTL_MS,
        attempts: 0,
        lastRequestedAt: now,
        requestCount: (existing ? existing.requestCount : 0) + 1,
        dayKey: today,
        dayCount: dayCount + 1,
    };

    saveStore(store);

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
export function releaseOtpAttempt(phone: string, tenant?: string): void {
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) return;
    const store = loadStore();
    const key = storageKey(tenant, cleanPhone);
    const record = store[key];
    if (!record) return;
    record.dayCount = Math.max(0, (record.dayCount || 0) - 1);
    record.requestCount = Math.max(0, (record.requestCount || 0) - 1);
    consumeCode(record);
    saveStore(store);
}

export function verifyOtp(phone: string, inputOtp: string, tenant?: string): {
    valid: boolean;
    reason?: string;
} {
    const cleanPhone = normalizePhone(phone);
    const store = loadStore();
    const key = storageKey(tenant, cleanPhone);
    const record = store[key];

    if (!record || !record.hashedOtp) {
        return { valid: false, reason: "No active OTP request found for this phone number." };
    }

    if (Date.now() > record.expiresAt) {
        consumeCode(record);
        saveStore(store);
        return { valid: false, reason: "OTP has expired. Please request a new one." };
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
        consumeCode(record);
        saveStore(store);
        return { valid: false, reason: "Too many failed attempts. Please request a new OTP." };
    }

    record.attempts += 1;

    const computed = hashOtp(inputOtp.trim(), record.salt);
    if (crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(record.hashedOtp))) {
        consumeCode(record);
        saveStore(store);
        return { valid: true };
    }

    saveStore(store);
    return {
        valid: false,
        reason: `Incorrect OTP. ${MAX_VERIFY_ATTEMPTS - record.attempts} attempts remaining.`,
    };
}
