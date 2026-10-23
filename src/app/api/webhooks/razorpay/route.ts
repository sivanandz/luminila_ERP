import { NextResponse } from "next/server";
import { processRazorpayWebhookEvent } from "@/lib/razorpay-webhook-handler";

/** Map a handler failure to a status Razorpay and an operator can act on. */
function statusForError(error?: string): number {
    const message = (error || "").toLowerCase();
    if (message.includes("secret is not configured")) return 503;
    if (message.includes("signature")) return 401;
    if (message.includes("amount does not match")) return 409;
    return 400;
}

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
                { status: statusForError(result.error) }
            );
        }

        return NextResponse.json({ success: true, message: "Webhook processed successfully" }, { status: 200 });
    } catch (err: unknown) {
        console.error("[Razorpay Webhook Error]:", err);
        return NextResponse.json(
            { success: false, error: err instanceof Error ? err.message : "Internal webhook handler error" },
            { status: 500 }
        );
    }
}
