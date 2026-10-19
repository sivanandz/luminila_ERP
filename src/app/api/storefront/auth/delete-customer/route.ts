import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { pb, ensureServerAuth } from "@/lib/pocketbase";
import { verifyCustomerToken } from "@/lib/customer-token";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(req: Request) {
    return handleDelete(req);
}

export async function DELETE(req: Request) {
    return handleDelete(req);
}

async function handleDelete(req: Request) {
    try {
        const authHeader = req.headers.get("authorization") || "";
        const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        const body = await req.json().catch(() => ({}));
        const rawToken = headerToken || (body.token || "").trim();

        // 1. Authenticate customer token
        const customerAuth = verifyCustomerToken(rawToken);
        if (!customerAuth) {
            return NextResponse.json(
                { success: false, error: "Unauthorized: Valid customer session token is required to delete customer account." },
                { status: 401, headers: CORS_HEADERS }
            );
        }

        const customerId = (body.customerId || "").trim() || customerAuth.id;
        const rawPhone = (body.phone || "").trim() || customerAuth.phone;
        const cleanDigits = rawPhone.replace(/\D/g, "");

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
            console.warn("[Delete Customer] Error reading storefront content:", e);
        }

        // Verify token tenant matches storefront tenant
        if (customerAuth.tenant !== boundAdminEmail) {
            return NextResponse.json(
                { success: false, error: "Forbidden: Customer session does not match store tenant." },
                { status: 403, headers: CORS_HEADERS }
            );
        }

        await ensureServerAuth();

        let targetId = customerId;

        // If no direct ID was provided, search by phone & tenant
        if (!targetId && cleanDigits) {
            const phoneSuffix = cleanDigits.slice(-10);
            try {
                const existing = await pb.collection("customers").getFirstListItem(
                    `phone ~ "${phoneSuffix}" && account_email = "${boundAdminEmail}"`
                );
                if (existing) targetId = existing.id;
            } catch {
                return NextResponse.json(
                    { success: false, error: "Customer not found." },
                    { status: 404, headers: CORS_HEADERS }
                );
            }
        }

        if (!targetId) {
            return NextResponse.json(
                { success: false, error: "Could not identify customer record." },
                { status: 404, headers: CORS_HEADERS }
            );
        }

        // Ensure token belongs to the customer being deleted
        if (customerAuth.id !== targetId && (!cleanDigits || !cleanDigits.endsWith(customerAuth.phone))) {
            return NextResponse.json(
                { success: false, error: "Forbidden: You are not authorized to delete another customer's account." },
                { status: 403, headers: CORS_HEADERS }
            );
        }

        // Delete customer record from PocketBase
        await pb.collection("customers").delete(targetId);

        return NextResponse.json(
            {
                success: true,
                message: "Customer account deleted successfully",
                deletedCustomerId: targetId,
            },
            { status: 200, headers: CORS_HEADERS }
        );
    } catch (err: any) {
        console.error("[Delete Customer API Error]:", err);
        return NextResponse.json(
            { success: false, error: err?.message || "Failed to delete customer account" },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}
