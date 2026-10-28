import { NextResponse } from "next/server";
import { verifyOtp } from "@/lib/otp-store";
import { isCustomerTokenConfigured, signCustomerToken } from "@/lib/customer-token";
import { createTenantClient, sanitizeFilter } from "@/lib/pocketbase";
import { getStorefrontBinding } from "@/lib/storefront";
import { recordConsentEvent } from "@/lib/consent-ledger";

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
        const otp = (body.otp || "").trim();
        const customerName = (body.name || "").trim();

        const cleanDigits = rawPhone.replace(/\D/g, "");
        if (!cleanDigits || cleanDigits.length < 10) {
            return NextResponse.json(
                { success: false, error: "Invalid phone number." },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        if (!otp || otp.length < 4) {
            return NextResponse.json(
                { success: false, error: "Please enter a valid 6-digit verification code." },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        // 1. Resolve the tenant first: OTP codes are scoped to it, so a code
        // minted for one storefront cannot be replayed against another.
        const reqEmail = typeof body.accountEmail === "string" ? body.accountEmail : undefined;
        const { boundAdminEmail } = await getStorefrontBinding(reqEmail);

        // 2. Verify the code with attempts protection
        const check = verifyOtp(cleanDigits, otp, boundAdminEmail);
        if (!check.valid) {
            return NextResponse.json(
                { success: false, error: check.reason || "Invalid or expired OTP." },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        // 3. Ensure PocketBase server-side authentication on the tenant's isolated DB
        const client = await createTenantClient(boundAdminEmail);

        // 4. Look up or auto-provision customer in PocketBase
        let customerRecord: any = null;
        const phoneSuffix = cleanDigits.slice(-10);

        try {
            customerRecord = await client.collection("customers").getFirstListItem(
                `phone ~ "${sanitizeFilter(phoneSuffix)}" && account_email = "${sanitizeFilter(boundAdminEmail)}"`
            );
        } catch {
            // Customer does not exist yet for this tenant
        }

        if (!customerRecord) {
            try {
                customerRecord = await client.collection("customers").create({
                    name: customerName || `Client ${phoneSuffix.slice(-4)}`,
                    phone: cleanDigits,
                    customer_type: "retail",
                    source: "website_otp",
                    account_email: boundAdminEmail,
                    loyalty_points: 50, // Welcome gift
                    notes: `Verified & Registered via Storefront WhatsApp OTP on ${new Date().toLocaleDateString("en-IN")}`,
                });
            } catch (err) {
                // Fail closed. Signing a 30-day token for a customer id that was
                // never saved used to hand out a usable session with no record.
                console.error("[Verify OTP] Could not persist customer:", err);
                return NextResponse.json(
                    { success: false, error: "Could not complete sign in. Please try again." },
                    { status: 503, headers: CORS_HEADERS }
                );
            }
        } else if (customerName && customerRecord.name?.startsWith("Client ")) {
            // Update customer name if provided
            try {
                customerRecord = await client.collection("customers").update(customerRecord.id, {
                    name: customerName,
                });
            } catch {}
        }

        // Consent ledger (A30): the OTP proves phone ownership, so record the
        // transactional and WhatsApp-service consent; marketing stays a separate
        // decision made on the storefront/checkout.
        await recordConsentEvent(client, {
            customerId: customerRecord.id,
            phone: cleanDigits,
            channel: "storefront",
            purpose: "transactional",
            granted: true,
            source: "otp_verification",
        });
        await recordConsentEvent(client, {
            customerId: customerRecord.id,
            phone: cleanDigits,
            channel: "storefront",
            purpose: "whatsapp_service",
            granted: true,
            source: "otp_verification",
        });

        // 4. Create cryptographically signed session token. Refuse rather than
        // fall back to a per-process key that would invalidate on restart.
        if (!isCustomerTokenConfigured()) {
            return NextResponse.json(
                { success: false, error: "Customer sessions are not configured on this server." },
                { status: 503, headers: CORS_HEADERS }
            );
        }

        const token = signCustomerToken({
            id: customerRecord.id,
            phone: phoneSuffix,
            tenant: boundAdminEmail,
            exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
        });

        return NextResponse.json(
            {
                success: true,
                message: "Authentication successful",
                customer: {
                    id: customerRecord.id,
                    name: customerRecord.name,
                    phone: customerRecord.phone || cleanDigits,
                    email: customerRecord.email || "",
                    address: customerRecord.address || customerRecord.shipping_address || "",
                    city: customerRecord.city || "",
                    state: customerRecord.state || "",
                    pincode: customerRecord.pincode || "",
                    loyalty_points: customerRecord.loyalty_points || 0,
                    account_email: boundAdminEmail,
                },
                token,
            },
            { status: 200, headers: CORS_HEADERS }
        );
    } catch (err: any) {
        console.error("[Verify OTP API Error]:", err);
        return NextResponse.json(
            { success: false, error: err?.message || "Internal server error" },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}
