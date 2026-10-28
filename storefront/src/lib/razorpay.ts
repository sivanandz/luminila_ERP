/**
 * Razorpay Standard Web Checkout Integration
 * Enables instant payments via UPI (GPay/PhonePe), RuPay, Credit/Debit Cards, and NetBanking.
 */

declare global {
    interface Window {
        Razorpay: any;
    }
}

export function loadRazorpayScript(): Promise<boolean> {
    return new Promise((resolve) => {
        if (typeof window === "undefined") {
            resolve(false);
            return;
        }

        if (window.Razorpay) {
            resolve(true);
            return;
        }

        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
}

export interface RazorpayPaymentOptions {
    amount: number; // in INR rupees
    /** Razorpay order id created server-side (CO-05); carries the ERP order reference. */
    orderId?: string;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    description?: string;
    brandName?: string;
    razorpayKey?: string;
    themeColor?: string;
    onSuccess: (paymentId: string, signature?: string) => void;
    onFailure: (error: any) => void;
}

export async function openRazorpayCheckout(options: RazorpayPaymentOptions) {
    const isLoaded = await loadRazorpayScript();
    if (!isLoaded) {
        throw new Error("Unable to load Razorpay payment gateway. Please check your internet connection.");
    }

    const razorpayKey =
        options.razorpayKey ||
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ||
        "rzp_test_placeholder_key";

    const rzpOptions = {
        key: razorpayKey,
        amount: options.amount * 100, // Amount in paise
        currency: "INR",
        ...(options.orderId ? { order_id: options.orderId } : {}),
        name: options.brandName || "Fashion Atelier",
        description: options.description || "Online Jewellery Order",
        image: "https://cdn-icons-png.flaticon.com/512/751/751508.png",
        prefill: {
            name: options.customerName,
            contact: options.customerPhone,
            email: options.customerEmail || "customer@example.com",
        },
        theme: {
            color: options.themeColor || "#000000",
        },
        modal: {
            ondismiss: function () {
                options.onFailure({ message: "Payment cancelled by user" });
            },
        },
        handler: function (response: { razorpay_payment_id: string; razorpay_signature?: string }) {
            options.onSuccess(response.razorpay_payment_id, response.razorpay_signature);
        },
    };

    const rzpInstance = new window.Razorpay(rzpOptions);
    rzpInstance.open();
}
