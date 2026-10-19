import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { verifyOtp } from "@/lib/otp-store";
import { signCustomerToken } from "@/lib/customer-token";
import { pb, ensureServerAuth } from "@/lib/pocketbase";

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

        // 1. Verify OTP with attempts protection
        const check = verifyOtp(cleanDigits, otp);
        if (!check.valid) {
            return NextResponse.json(
                { success: false, error: check.reason || "Invalid or expired OTP." },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        // 2. Fetch bound admin email for tenant isolation
        let boundAdminEmail = "admin@luminila.internal";
        try {
            const contentPath = path.join(process.cwd(), "src", "data", "storefront_content.json");
            if (fs.existsSync(contentPath)) {
                const cms = JSON.parse(fs.readFileSync(contentPath, "utf-8"));
                if (cms.adminBinding?.boundAdminEmail) {
                    boundAdminEmail = cms.adminBinding.boundAdminEmail;
                }
            }
        } catch (e) {
            console.warn("[Verify OTP] Error reading storefront content:", e);
        }

        // 3. Ensure PocketBase server-side authentication
        await ensureServerAuth();

        // 4. Look up or auto-provision customer in PocketBase
        let customerRecord: any = null;
        const phoneSuffix = cleanDigits.slice(-10);

        try {
            customerRecord = await pb.collection("customers").getFirstListItem(
                `phone ~ "${phoneSuffix}" && account_email = "${boundAdminEmail}"`
            );
        } catch {
            // Customer does not exist yet for this tenant
        }

        if (!customerRecord) {
            try {
                customerRecord = await pb.collection("customers").create({
                    name: customerName || `Client ${phoneSuffix.slice(-4)}`,
                    phone: cleanDigits,
                    customer_type: "retail",
                    source: "website_otp",
                    account_email: boundAdminEmail,
                    loyalty_points: 50, // Welcome gift
                    notes: `Verified & Registered via Storefront WhatsApp OTP on ${new Date().toLocaleDateString("en-IN")}`,
                });
            } catch (err: any) {
                console.warn("[Verify OTP] PocketBase customer create fallback:", err);
                // Create virtual customer object if PB is temporarily unreachable
                customerRecord = {
                    id: `temp_${Date.now()}`,
                    name: customerName || `Client ${phoneSuffix.slice(-4)}`,
                    phone: cleanDigits,
                    account_email: boundAdminEmail,
                    loyalty_points: 50,
                    source: "website_otp",
                };
            }
        } else if (customerName && customerRecord.name?.startsWith("Client ")) {
            // Update customer name if provided
            try {
                customerRecord = await pb.collection("customers").update(customerRecord.id, {
                    name: customerName,
                });
            } catch {}
        }

        // 4. Create cryptographically signed session token
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
