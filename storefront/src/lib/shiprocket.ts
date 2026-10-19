/**
 * Shiprocket API & Pincode Serviceability Helper
 * Powers multi-courier fulfillment across Delhivery, BlueDart, ST Courier, DTDC, and Ekart.
 */

export interface CourierServiceability {
    pincode: string;
    city: string;
    state: string;
    isServiceable: boolean;
    estimatedDeliveryDays: number;
    estimatedDeliveryDate: string;
    primaryCourier: "Delhivery Air" | "BlueDart Express" | "ST Courier" | "DTDC Priority";
    codAvailable: boolean;
}

// Major pan-India postal hubs for sub-second client-side delivery estimation
const REGIONAL_HUBS: Record<string, { state: string; defaultCity: string; courier: "ST Courier" | "BlueDart Express" | "Delhivery Air" | "DTDC Priority" }> = {
    "60": { state: "Tamil Nadu", defaultCity: "Chennai / Kanchipuram", courier: "ST Courier" },
    "61": { state: "Tamil Nadu", defaultCity: "Thanjavur / Trichy", courier: "ST Courier" },
    "62": { state: "Tamil Nadu", defaultCity: "Madurai / Dindigul", courier: "ST Courier" },
    "63": { state: "Tamil Nadu", defaultCity: "Salem / Vellore", courier: "ST Courier" },
    "64": { state: "Tamil Nadu", defaultCity: "Coimbatore / Tiruppur", courier: "ST Courier" },
    "56": { state: "Karnataka", defaultCity: "Bengaluru Metro", courier: "BlueDart Express" },
    "57": { state: "Karnataka", defaultCity: "Mangaluru / Udupi", courier: "BlueDart Express" },
    "58": { state: "Karnataka", defaultCity: "Hubballi / Belagavi", courier: "Delhivery Air" },
    "50": { state: "Telangana", defaultCity: "Hyderabad / Secunderabad", courier: "BlueDart Express" },
    "51": { state: "Telangana", defaultCity: "Warangal / Nizamabad", courier: "Delhivery Air" },
    "52": { state: "Andhra Pradesh", defaultCity: "Vijayawada / Guntur", courier: "Delhivery Air" },
    "53": { state: "Andhra Pradesh", defaultCity: "Visakhapatnam", courier: "BlueDart Express" },
    "40": { state: "Maharashtra", defaultCity: "Mumbai Metro", courier: "BlueDart Express" },
    "41": { state: "Maharashtra", defaultCity: "Pune / PCMC", courier: "BlueDart Express" },
    "42": { state: "Maharashtra", defaultCity: "Nashik / Dhule", courier: "Delhivery Air" },
    "44": { state: "Maharashtra", defaultCity: "Nagpur Metro", courier: "Delhivery Air" },
    "11": { state: "Delhi", defaultCity: "New Delhi Central", courier: "BlueDart Express" },
    "12": { state: "Haryana (NCR)", defaultCity: "Gurugram / Faridabad", courier: "BlueDart Express" },
    "20": { state: "Uttar Pradesh (NCR)", defaultCity: "Noida / Ghaziabad", courier: "BlueDart Express" },
    "38": { state: "Gujarat", defaultCity: "Ahmedabad / Gandhinagar", courier: "BlueDart Express" },
    "39": { state: "Gujarat", defaultCity: "Surat / Vadodara", courier: "Delhivery Air" },
    "30": { state: "Rajasthan", defaultCity: "Jaipur / Dausa", courier: "Delhivery Air" },
    "31": { state: "Rajasthan", defaultCity: "Udaipur / Bhilwara", courier: "Delhivery Air" },
    "70": { state: "West Bengal", defaultCity: "Kolkata Metro", courier: "BlueDart Express" },
    "68": { state: "Kerala", defaultCity: "Kochi / Ernakulam", courier: "Delhivery Air" },
    "69": { state: "Kerala", defaultCity: "Thiruvananthapuram", courier: "Delhivery Air" },
};

export async function checkShiprocketPincode(pincode: string, merchantHubPrefix?: string): Promise<CourierServiceability> {
    const cleanPin = pincode.trim().replace(/\D/g, "");

    // Basic Indian 6-digit validation
    if (cleanPin.length !== 6) {
        return {
            pincode: cleanPin,
            city: "Unknown",
            state: "India",
            isServiceable: false,
            estimatedDeliveryDays: 0,
            estimatedDeliveryDate: "",
            primaryCourier: "Delhivery Air",
            codAvailable: false,
        };
    }

    const prefix = cleanPin.substring(0, 2);
    const merchantPrefix = merchantHubPrefix || process.env.NEXT_PUBLIC_MERCHANT_HUB_PREFIX || "60";
    const isLocalIntraState = prefix.substring(0, 1) === merchantPrefix.substring(0, 1);

    const hub = REGIONAL_HUBS[prefix];
    let days = 4;
    let courier: "Delhivery Air" | "BlueDart Express" | "ST Courier" | "DTDC Priority" = "Delhivery Air";
    let state = hub ? hub.state : "India";
    let city = hub ? hub.defaultCity : "Regional Hub";

    if (isLocalIntraState) {
        days = 2; // Next-day or 48h within local state zone
        courier = hub ? hub.courier : "ST Courier";
    } else if (hub) {
        days = 3; // Fast Metro / Tier-1 hub air transit
        courier = hub.courier;
    } else {
        days = 4; // Tier-2 / Tier-3 national express
        courier = "DTDC Priority";
    }

    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + days);
    const dateFormatted = deliveryDate.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
    });

    return {
        pincode: cleanPin,
        city,
        state,
        isServiceable: true,
        estimatedDeliveryDays: days,
        estimatedDeliveryDate: dateFormatted,
        primaryCourier: courier,
        codAvailable: true,
    };
}
