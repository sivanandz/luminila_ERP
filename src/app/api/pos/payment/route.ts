import { NextResponse } from "next/server";
import {
    createPaymentLink as serverCreateRazorpayLink,
    fetchPaymentLinkStatus as serverFetchRazorpayStatus,
    type CreatePaymentLinkParams,
} from "@/lib/razorpay";
import {
    initiatePayment as serverInitiatePhonePe,
    checkPaymentStatus as serverCheckPhonePeStatus,
} from "@/lib/phonepe";
import { authenticateOperator, hasCapability, tenantAccessAllowed } from "@/lib/api-auth";
import { isSingleAccountMode } from "@/lib/deployment-mode";

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const { action, payload, accountEmail } = body ?? {};
        const hintEmail = typeof accountEmail === "string" ? accountEmail.trim().toLowerCase() : undefined;

        // Operator-only endpoint: a viewer must not be able to mint payment
        // links or read arbitrary link statuses (A-11).
        const session = await authenticateOperator(req, hintEmail);
        if (!session.ok || !session.client) {
            return NextResponse.json(
                { success: false, error: session.error || "Unauthorized: Invalid or expired operator session." },
                { status: session.status || 401 }
            );
        }
        if (hintEmail && !isSingleAccountMode() && !tenantAccessAllowed(session.email, session.isSuperuser, hintEmail)) {
            return NextResponse.json(
                { success: false, error: "Session does not belong to the requested account." },
                { status: 403 }
            );
        }

        const p = (payload ?? {}) as Record<string, unknown>;
        const isStatusAction = action === "razorpay_fetch_status" || action === "phonepe_status";
        const capability = isStatusAction ? "read" : "create";
        if (!(await hasCapability(session, "sales", capability))) {
            return NextResponse.json(
                { success: false, error: `Missing sales:${capability} capability.` },
                { status: 403 }
            );
        }

        // The gateway helpers read their configuration from the environment on
        // the server, so no shared client session is required here.
        if (action === "razorpay_create_link") {
            const amount = Number(p.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                return NextResponse.json({ success: false, error: "A positive amount is required" }, { status: 400 });
            }
            const result = await serverCreateRazorpayLink({
                ...(p as unknown as CreatePaymentLinkParams),
                amount,
            });
            return NextResponse.json(result, { status: result.success ? 200 : 400 });
        }

        if (action === "razorpay_fetch_status") {
            const paymentLinkId = String(p.paymentLinkId ?? "");
            if (!paymentLinkId) {
                return NextResponse.json({ success: false, error: "paymentLinkId is required" }, { status: 400 });
            }
            const result = await serverFetchRazorpayStatus(paymentLinkId);
            return NextResponse.json(result, { status: result.success ? 200 : 400 });
        }

        if (action === "phonepe_initiate") {
            const amount = Number(p.amount);
            const orderId = String(p.orderId ?? "");
            const redirectUrl = String(p.redirectUrl ?? "");
            if (!orderId || !redirectUrl || !Number.isFinite(amount) || amount <= 0) {
                return NextResponse.json(
                    { success: false, error: "orderId, a positive amount and redirectUrl are required" },
                    { status: 400 }
                );
            }
            const result = await serverInitiatePhonePe({
                orderId,
                amount,
                redirectUrl,
                customerPhone: p.customerPhone ? String(p.customerPhone) : undefined,
                callbackUrl: p.callbackUrl ? String(p.callbackUrl) : undefined,
            });
            return NextResponse.json(result, { status: result.success ? 200 : 400 });
        }

        if (action === "phonepe_status") {
            const transactionId = String(p.transactionId ?? "");
            if (!transactionId) {
                return NextResponse.json({ success: false, error: "transactionId is required" }, { status: 400 });
            }
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
