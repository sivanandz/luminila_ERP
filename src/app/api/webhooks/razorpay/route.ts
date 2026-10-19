import { NextResponse } from "next/server";
import { processRazorpayWebhookEvent } from "@/lib/razorpay-webhook-handler";

export async function POST(req: Request) {
    try {
        const rawBody = await req.text();
        const signature = req.headers.get("x-razorpay-signature");

        if (!signature) {
            console.warn("[Razorpay Webhook] Missing x-razorpay-signature header");
            return NextResponse.json(
                { success: false, error: "Missing x-razorpay-signature header" },
                { status: 400 }
            );
        }

        const result = await processRazorpayWebhookEvent(rawBody, signature);

        if (!result.success) {
            console.error("[Razorpay Webhook] Processing failed:", result.error);
            return NextResponse.json(
                { success: false, error: result.error },
                { status: 400 }
            );
        }

        return NextResponse.json({ success: true, message: "Webhook processed successfully" }, { status: 200 });
    } catch (err: any) {
        console.error("[Razorpay Webhook Error]:", err);
        return NextResponse.json(
            { success: false, error: err.message || "Internal webhook handler error" },
            { status: 500 }
        );
    }
}
