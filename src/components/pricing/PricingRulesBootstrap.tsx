"use client";

import { useEffect } from "react";
import { loadConfiguredChannels } from "@/lib/channel-pricing";

/**
 * Loads the tenant's sales channels (and their cost-based pricing rules) once
 * after authentication. `getChannelPrice` reads the module-level channel list,
 * so pricing anywhere in the app needs this to run before prices are computed.
 */
export function PricingRulesBootstrap() {
    useEffect(() => {
        loadConfiguredChannels().catch((error) => {
            console.warn("[pricing] Could not load channel rules:", error);
        });
    }, []);

    return null;
}
