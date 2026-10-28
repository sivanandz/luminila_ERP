import {
    DEFAULT_SALES_CHANNELS,
    normalizeChannelDefinitions,
    type SalesChannelDefinition,
} from "./pricing-rules";

/**
 * Load a tenant's channel definitions (including cost-based pricing rules)
 * for server-side price resolution.
 *
 * Falls back to the built-in channels when the tenant has not saved a set or
 * the settings row is unavailable; the defaults carry no rules, so pricing
 * remains on stored prices until rules are configured.
 */
export async function loadTenantChannelDefinitions(
    client: any,
    email: string
): Promise<SalesChannelDefinition[]> {
    try {
        const filter = typeof client?.filter === "function"
            ? client.filter("key = {:key} && account_email = {:email}", {
                  key: "sales_channel_definitions",
                  email,
              })
            : `key = "sales_channel_definitions" && account_email = "${email}"`;

        const record = await client
            .collection("store_settings")
            .getFirstListItem(filter)
            .catch(() => null);

        if (!record?.value) return [...DEFAULT_SALES_CHANNELS];

        const parsed = typeof record.value === "string"
            ? JSON.parse(record.value)
            : record.value;

        return normalizeChannelDefinitions(parsed);
    } catch (error) {
        console.warn("[pricing] Could not load channel definitions:", error);
        return [...DEFAULT_SALES_CHANNELS];
    }
}
