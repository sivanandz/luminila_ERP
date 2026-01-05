/**
 * Shopify Sync Engine
 * Uses Shopify GraphQL Admin API for inventory and product sync
 * 
 * Setup: Create a Custom App in Shopify Admin → Apps → Develop apps
 * Required scopes: read_products, write_products, read_inventory, write_inventory
 */

const SHOPIFY_STORE_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || "";
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "";

interface ShopifyProduct {
    id: string;
    title: string;
    handle: string;
    variants: {
        edges: Array<{
            node: {
                id: string;
                sku: string;
                price: string;
                inventoryItem: {
                    id: string;
                    inventoryLevels: {
                        edges: Array<{
                            node: {
                                available: number;
                                location: {
                                    id: string;
                                    name: string;
                                };
                            };
                        }>;
                    };
                };
            };
        }>;
    };
}

interface ShopifyOrder {
    id: string;
    name: string;
    createdAt: string;
    customer: {
        displayName: string;
        phone: string;
    } | null;
    lineItems: {
        edges: Array<{
            node: {
                sku: string;
                quantity: number;
                variant: {
                    id: string;
                    sku: string;
                };
            };
        }>;
    };
    totalPriceSet: {
        shopMoney: {
            amount: string;
            currencyCode: string;
        };
    };
    fulfillmentStatus: string;
    financialStatus: string;
}

/**
 * Execute a GraphQL query against Shopify Admin API
 */
async function shopifyGraphQL<T>(
    query: string,
    variables?: Record<string, unknown>
): Promise<T> {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
        throw new Error("Shopify credentials not configured");
    }

    const response = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/graphql.json`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            },
            body: JSON.stringify({ query, variables }),
        }
    );

    if (!response.ok) {
        throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
        console.error("Shopify GraphQL errors:", data.errors);
        throw new Error(data.errors[0]?.message || "GraphQL error");
    }

    return data.data;
}

/**
 * Fetch all products from Shopify
 */
export async function fetchShopifyProducts(
    cursor?: string
): Promise<{ products: ShopifyProduct[]; hasNextPage: boolean; endCursor: string | null }> {
    const query = `
    query GetProducts($cursor: String) {
      products(first: 50, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            handle
            variants(first: 20) {
              edges {
                node {
                  id
                  sku
                  price
                  inventoryItem {
                    id
                    inventoryLevels(first: 5) {
                      edges {
                        node {
                          available
                          location {
                            id
                            name
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

    const data = await shopifyGraphQL<{
        products: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            edges: Array<{ node: ShopifyProduct }>;
        };
    }>(query, { cursor });

    return {
        products: data.products.edges.map((edge) => edge.node),
        hasNextPage: data.products.pageInfo.hasNextPage,
        endCursor: data.products.pageInfo.endCursor,
    };
}

/**
 * Fetch all products with pagination
 */
export async function fetchAllShopifyProducts(): Promise<ShopifyProduct[]> {
    const allProducts: ShopifyProduct[] = [];
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
        const result = await fetchShopifyProducts(cursor);
        allProducts.push(...result.products);
        hasMore = result.hasNextPage;
        cursor = result.endCursor || undefined;
    }

    return allProducts;
}

/**
 * Update inventory level in Shopify
 */
export async function updateShopifyInventory(
    inventoryItemId: string,
    locationId: string,
    available: number
): Promise<void> {
    const mutation = `
    mutation UpdateInventory($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
          createdAt
          reason
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

    await shopifyGraphQL(mutation, {
        input: {
            name: "available",
            reason: "correction",
            ignoreCompareQuantity: true,
            quantities: [
                {
                    inventoryItemId,
                    locationId,
                    quantity: available,
                },
            ],
        },
    });
}

/**
 * Fetch recent orders from Shopify
 */
export async function fetchShopifyOrders(
    since?: Date,
    limit = 50
): Promise<ShopifyOrder[]> {
    const query = `
    query GetOrders($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            customer {
              displayName
              phone
            }
            lineItems(first: 20) {
              edges {
                node {
                  sku
                  quantity
                  variant {
                    id
                    sku
                  }
                }
              }
            }
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            fulfillmentStatus
            financialStatus
          }
        }
      }
    }
  `;

    const queryFilter = since
        ? `created_at:>=${since.toISOString()}`
        : undefined;

    const data = await shopifyGraphQL<{
        orders: { edges: Array<{ node: ShopifyOrder }> };
    }>(query, { first: limit, query: queryFilter });

    return data.orders.edges.map((edge) => edge.node);
}

/**
 * Sync products from Shopify to local database
 */
export async function syncProductsFromShopify(
    onProgress?: (current: number, total: number) => void
): Promise<{ created: number; updated: number; errors: string[] }> {
    const products = await fetchAllShopifyProducts();
    const errors: string[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        onProgress?.(i + 1, products.length);

        try {
            // TODO: Upsert to Supabase
            // This would match by SKU and update/create accordingly
            console.log(`Syncing product: ${product.title}`);

            // For each variant
            for (const variantEdge of product.variants.edges) {
                const variant = variantEdge.node;
                const inventoryLevel = variant.inventoryItem.inventoryLevels.edges[0]?.node;

                console.log(`  - Variant ${variant.sku}: ${inventoryLevel?.available || 0} units`);

                // TODO: Upsert variant to Supabase
                // Include shopify_inventory_id for future sync
            }

            updated++;
        } catch (err) {
            errors.push(`Failed to sync ${product.title}: ${err}`);
        }
    }

    return { created, updated, errors };
}

/**
 * Sync orders from Shopify to local database
 */
export async function syncOrdersFromShopify(
    since?: Date
): Promise<{ synced: number; errors: string[] }> {
    const orders = await fetchShopifyOrders(since);
    const errors: string[] = [];
    let synced = 0;

    for (const order of orders) {
        try {
            // TODO: Insert to Supabase if not exists
            console.log(`Syncing order: ${order.name}`);

            for (const itemEdge of order.lineItems.edges) {
                const item = itemEdge.node;
                console.log(`  - Item ${item.sku}: ${item.quantity} units`);

                // TODO: Decrement local inventory, log stock movement
            }

            synced++;
        } catch (err) {
            errors.push(`Failed to sync order ${order.name}: ${err}`);
        }
    }

    return { synced, errors };
}

/**
 * Push local inventory changes to Shopify
 */
export async function pushInventoryToShopify(
    sku: string,
    newQuantity: number
): Promise<boolean> {
    try {
        // First, find the product/variant by SKU
        const query = `
      query FindVariant($sku: String!) {
        productVariants(first: 1, query: $sku) {
          edges {
            node {
              id
              inventoryItem {
                id
                inventoryLevels(first: 1) {
                  edges {
                    node {
                      location {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

        const data = await shopifyGraphQL<{
            productVariants: {
                edges: Array<{
                    node: {
                        id: string;
                        inventoryItem: {
                            id: string;
                            inventoryLevels: {
                                edges: Array<{
                                    node: {
                                        location: { id: string };
                                    };
                                }>;
                            };
                        };
                    };
                }>;
            };
        }>(query, { sku });

        const variant = data.productVariants.edges[0]?.node;
        if (!variant) {
            console.warn(`Variant with SKU ${sku} not found in Shopify`);
            return false;
        }

        const inventoryItemId = variant.inventoryItem.id;
        const locationId =
            variant.inventoryItem.inventoryLevels.edges[0]?.node.location.id;

        if (!locationId) {
            console.warn(`No location found for variant ${sku}`);
            return false;
        }

        await updateShopifyInventory(inventoryItemId, locationId, newQuantity);
        console.log(`Updated Shopify inventory: ${sku} = ${newQuantity}`);

        return true;
    } catch (err) {
        console.error(`Failed to push inventory to Shopify: ${err}`);
        return false;
    }
}

/**
 * Check if Shopify is configured
 */
export function isShopifyConfigured(): boolean {
    return Boolean(SHOPIFY_STORE_DOMAIN && SHOPIFY_ACCESS_TOKEN);
}
