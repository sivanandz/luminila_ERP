import { NextResponse } from "next/server";
import PocketBase from "pocketbase";
import { createTenantClient } from "@/lib/pocketbase";
import {
    createPaymentLink as serverCreateRazorpayLink,
    fetchPaymentLinkStatus as serverFetchRazorpayStatus,
    RazorpayConfig,
} from "@/lib/razorpay";
import {
    initiatePayment as serverInitiatePhonePe,
    checkPaymentStatus as serverCheckPhonePeStatus,
} from "@/lib/phonepe";

export async function POST(req: Request) {
    try {
        // Enforce POS Operator / Superuser Authentication
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();

        if (!token) {
            return NextResponse.json(
                { success: false, error: "Unauthorized: Operator session token is required to process POS payments." },
                { status: 401 }
            );
        }

        const body = await req.json();
        const { action, payload, accountEmail } = body;
        const hintEmail = typeof accountEmail === "string" ? accountEmail.trim().toLowerCase() : undefined;

        // A client for the operator's tenant; the shared client is not touched.
        const tenantClient = await createTenantClient(hintEmail);

        const authPb = new PocketBase(tenantClient.baseUrl);
        let isAuthorized = false;
        try {
            authPb.authStore.save(token, null);
            await authPb.collection("users").authRefresh();
            isAuthorized = authPb.authStore.isValid;
        } catch {
            try {
                authPb.authStore.save(token, null);
                await authPb.collection("_superusers").authRefresh();
                isAuthorized = authPb.authStore.isValid;
                } catch {
                isAuthorized = false;
            }
        }

        if (!isAuthorized) {
            return NextResponse.json(
                { success: false, error: "Unauthorized: Invalid or expired operator session." },
                { status: 401 }
            );
        }

        // The gateway helpers read their configuration from the environment on
        // the server, so no shared client session is required here.
        if (action === "razorpay_create_link") {
            const result = await serverCreateRazorpayLink(payload);
            return NextResponse.json(result, { status: result.success ? 200 : 400 });
        }

        if (action === "razorpay_fetch_status") {
            const { paymentLinkId } = payload;
            const result = await serverFetchRazorpayStatus(paymentLinkId);
            return NextResponse.json(result, { status: result.success ? 200 : 400 });
        }

        if (action === "phonepe_initiate") {
            const result = await serverInitiatePhonePe(payload);
            return NextResponse.json(result, { status: result.success ? 200 : 400 });
        }

        if (action === "phonepe_status") {
            const { transactionId } = payload;
            const result = await serverCheckPhonePeStatus(transactionId);
            return NextResponse.json(result, { status: result.success ? 200 : 400 });
        }

        return NextResponse.json({ success: false, error: "Invalid payment action" }, { status: 400 });
    } catch (err: any) {
        console.error("[POS Payment API Error]:", err);
        return NextResponse.json(
            { success: false, error: err.message || "Internal server payment error" },
            { status: 500 }
        );
    }
}
