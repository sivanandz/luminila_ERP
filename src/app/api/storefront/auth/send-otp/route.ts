import { NextResponse } from "next/server";
import { generateAndSaveOtp } from "@/lib/otp-store";
import { sendMessage, getTenantWhatsAppSessionId } from "@/lib/whatsapp";
import { getStorefrontBinding } from "@/lib/storefront";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const rawPhone = (body.phone || "").trim();
        const cleanDigits = rawPhone.replace(/\D/g, "");
        const phone10 = cleanDigits.slice(-10);

        if (!phone10 || phone10.length !== 10 || !/^[6-9]\d{9}$/.test(phone10)) {
            return NextResponse.json(
                { success: false, error: "Please enter a valid 10-digit Indian mobile number starting with 6-9." },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        // Standardize to 91XXXXXXXXXX for WhatsApp delivery in India
        const waNumber = `91${phone10}`;

        // 1. Fetch bound admin and branding from storefront content
        const reqEmail = typeof body.accountEmail === "string" ? body.accountEmail.trim().toLowerCase() : undefined;
        const { boundAdminEmail, brandName } = await getStorefrontBinding(reqEmail);

        // 2. Generate a secure 6-digit OTP scoped to this tenant
        const otpResult = generateAndSaveOtp(phone10, boundAdminEmail);
        if (!otpResult.success || !otpResult.otp) {
            return NextResponse.json(
                {
                    success: false,
                    error: otpResult.error || "Failed to generate verification code.",
                    cooldownRemaining: otpResult.cooldownRemaining,
                },
                { status: 429, headers: CORS_HEADERS }
            );
        }

        const otp = otpResult.otp;
        const tenantSession = getTenantWhatsAppSessionId(boundAdminEmail);

        const otpMessage = `🔐 *${brandName} Verification Code*

Your one-time login code is: *${otp}*

⏱️ Valid for 5 minutes.
🛡️ Never share this code with anyone.

_If you did not request this, please ignore this message._`;

        let waDelivered = false;
        let deliveryError = "";

        try {
            waDelivered = await sendMessage(tenantSession, waNumber, otpMessage);
        } catch (err: any) {
            deliveryError = err?.message || String(err);
            console.warn(`[Send OTP] WhatsApp delivery via session ${tenantSession} failed:`, deliveryError);
        }

        // Only allow devOtp when explicitly running in local dev and ALLOW_DEV_OTP is enabled
        const allowDevOtp = process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_OTP === "true";

        // Fail closed: a code nobody received must not be reported as sent, and
        // the tenant's WhatsApp session id is never echoed to an anonymous caller.
        if (!waDelivered && !allowDevOtp) {
            return NextResponse.json(
                { success: false, error: "We could not send the code on WhatsApp. Please try again." },
                { status: 502, headers: CORS_HEADERS }
            );
        }

        return NextResponse.json(
            {
                success: true,
                message: waDelivered
                    ? `Verification code sent to your WhatsApp number +91 ${phone10}`
                    : "Verification code generated in development mode.",
                waDelivered,
                phone: phone10,
                ...(allowDevOtp ? { devOtp: otp } : {}),
            },
            { status: 200, headers: CORS_HEADERS }
        );
    } catch (err: any) {
        console.error("[Send OTP API Error]:", err);
        return NextResponse.json(
            { success: false, error: err?.message || "Internal server error" },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}
