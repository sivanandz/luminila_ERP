import { NextResponse } from "next/server";
import { ensureServerAuth } from "@/lib/pocketbase";
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
        const body = await req.json();
        const { action, payload } = body;

        // Verify server authentication
        await ensureServerAuth();

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
