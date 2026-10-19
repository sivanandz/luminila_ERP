import crypto from "crypto";
import fs from "fs";
import path from "path";

interface OtpRecord {
    phone: string;
    hashedOtp: string;
    salt: string;
    expiresAt: number;
    attempts: number;
    lastRequestedAt: number;
    requestCount: number;
}

const OTP_FILE_PATH = path.join(process.cwd(), "src", "data", "otp_store.json");
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds cooldown
const MAX_VERIFY_ATTEMPTS = 5;

function hashOtp(otp: string, salt: string): string {
    return crypto.createHmac("sha256", salt).update(otp).digest("hex");
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
        
        // Prune expired records
        const now = Date.now();
        const cleaned: Record<string, OtpRecord> = {};
        for (const [key, val] of Object.entries(data)) {
            if (val.expiresAt > now) {
                cleaned[key] = val;
            }
        }
        fs.writeFileSync(OTP_FILE_PATH, JSON.stringify(cleaned, null, 2), "utf-8");
    } catch (err) {
        console.error("[OTP Store] Error writing otp_store.json:", err);
    }
}

export function generateAndSaveOtp(phone: string): {
    success: boolean;
    otp?: string;
    error?: string;
    cooldownRemaining?: number;
} {
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
        return { success: false, error: "Invalid phone number length" };
    }

    const store = loadStore();
    const now = Date.now();
    const existing = store[cleanPhone];

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

    // Generate cryptographically secure 6-digit numeric OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const salt = crypto.randomBytes(16).toString("hex");
    const hashedOtp = hashOtp(otp, salt);

    store[cleanPhone] = {
        phone: cleanPhone,
        hashedOtp,
        salt,
        expiresAt: now + OTP_TTL_MS,
        attempts: 0,
        lastRequestedAt: now,
        requestCount: (existing ? existing.requestCount : 0) + 1,
    };

    saveStore(store);

    return {
        success: true,
        otp,
    };
}

export function verifyOtp(phone: string, inputOtp: string): {
    valid: boolean;
    reason?: string;
} {
    const cleanPhone = phone.replace(/\D/g, "");
    const store = loadStore();
    const record = store[cleanPhone];

    if (!record) {
        return { valid: false, reason: "No active OTP request found for this phone number." };
    }

    if (Date.now() > record.expiresAt) {
        delete store[cleanPhone];
        saveStore(store);
        return { valid: false, reason: "OTP has expired. Please request a new one." };
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
        delete store[cleanPhone];
        saveStore(store);
        return { valid: false, reason: "Too many failed attempts. Please request a new OTP." };
    }

    record.attempts += 1;

    const computed = hashOtp(inputOtp.trim(), record.salt);
    if (crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(record.hashedOtp))) {
        // Successfully verified, consume OTP
        delete store[cleanPhone];
        saveStore(store);
        return { valid: true };
    }

    saveStore(store);
    return {
        valid: false,
        reason: `Incorrect OTP. ${MAX_VERIFY_ATTEMPTS - record.attempts} attempts remaining.`,
    };
}
