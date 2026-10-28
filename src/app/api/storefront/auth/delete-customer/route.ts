import { NextResponse } from "next/server";
import { createTenantClient } from "@/lib/pocketbase";
import { verifyCustomerToken } from "@/lib/customer-token";
import { getStorefrontBinding } from "@/lib/storefront";
import { recordConsentEvent } from "@/lib/consent-ledger";

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

        // 2. Resolve bound admin email for tenant isolation
        const { boundAdminEmail } = await getStorefrontBinding(customerAuth.tenant);

        // Verify token tenant matches storefront tenant
        if (customerAuth.tenant !== boundAdminEmail) {
            return NextResponse.json(
                { success: false, error: "Forbidden: Customer session does not match store tenant." },
                { status: 403, headers: CORS_HEADERS }
            );
        }

        // 3. IDOR Prevention: Target MUST strictly match authenticated customer
        const targetId = customerAuth.id;
        if (body.customerId && body.customerId.trim() !== targetId) {
            return NextResponse.json(
                { success: false, error: "Forbidden: You are not authorized to delete another customer's account." },
                { status: 403, headers: CORS_HEADERS }
            );
        }

        // Per-request tenant client; the shared one could hold another session.
        const client = await createTenantClient(boundAdminEmail);

        // 4. Verify record exists and belongs to this tenant and customer
        const existing = await client.collection("customers").getOne(targetId).catch(() => null);
        if (!existing) {
            return NextResponse.json(
                { success: false, error: "Customer not found." },
                { status: 404, headers: CORS_HEADERS }
            );
        }

        if (existing.account_email !== boundAdminEmail) {
            return NextResponse.json(
                { success: false, error: "Forbidden: Customer record belongs to a different store tenant." },
                { status: 403, headers: CORS_HEADERS }
            );
        }

        // Consent ledger (A30): deletion revokes marketing and service consent.
        // The events are written before removal and keep the phone number so the
        // revocation survives the deleted relation.
        const deletedPhone = existing.phone || customerAuth.phone || "";
        await recordConsentEvent(client, {
            phone: deletedPhone,
            channel: "storefront",
            purpose: "marketing",
            granted: false,
            source: "account_deletion",
        });
        await recordConsentEvent(client, {
            phone: deletedPhone,
            channel: "storefront",
            purpose: "whatsapp_service",
            granted: false,
            source: "account_deletion",
        });

        // 5. Delete customer record from PocketBase
        await client.collection("customers").delete(targetId);

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
