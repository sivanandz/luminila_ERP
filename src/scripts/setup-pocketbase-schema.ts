import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// Blueprint defines the structure but uses collection NAMES for relations
// We will resolve these to IDs at runtime.
const BLUEPRINTS = [
    // --- LEVEL 1 ---
    {
        name: 'customers',
        type: 'base',
        fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'phone', type: 'text', required: false },
            { name: 'email', type: 'email', required: false },
            { name: 'address', type: 'text', required: false },
            { name: 'gstin', type: 'text', required: false },
            { name: 'loyalty_points', type: 'number', required: false },
            { name: 'total_spent', type: 'number', required: false },
            { name: 'notes', type: 'text', required: false }
        ]
    },
    {
        name: 'vendors',
        type: 'base',
        fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'contact_name', type: 'text', required: false },
            { name: 'phone', type: 'text', required: false },
            { name: 'email', type: 'email', required: false },
            { name: 'address', type: 'text', required: false },
            { name: 'gstin', type: 'text', required: false }
        ]
    },
    {
        name: 'categories',
        type: 'base',
        fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'slug', type: 'text', required: false },
            { name: 'description', type: 'text', required: false },
            // Parent added later validation-safe
            { name: 'sort_order', type: 'number', required: false },
            { name: 'icon', type: 'text', required: false },
            { name: 'color', type: 'text', required: false },
            { name: 'is_active', type: 'bool', required: false }
        ]
    },
    {
        name: 'product_attributes',
        type: 'base',
        fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'slug', type: 'text', required: false },
            { name: 'attribute_type', type: 'select', maxSelect: 1, values: ['text', 'select', 'number', 'boolean', 'date'], required: true },
            { name: 'attribute_options', type: 'json', required: false },
            { name: 'default_value', type: 'text', required: false },
            { name: 'is_required', type: 'bool', required: false },
            { name: 'is_filterable', type: 'bool', required: false },
            { name: 'is_visible_on_product', type: 'bool', required: false },
            { name: 'sort_order', type: 'number', required: false }
        ]
    },
    {
        name: 'bank_accounts',
        type: 'base',
        fields: [
            { name: 'account_name', type: 'text', required: true },
            { name: 'account_number', type: 'text', required: false },
            { name: 'bank_name', type: 'text', required: false },
            { name: 'ifsc_code', type: 'text', required: false },
            { name: 'currency', type: 'text', required: false },
            { name: 'opening_balance', type: 'number', required: true },
            { name: 'current_balance', type: 'number', required: true },
            { name: 'is_active', type: 'bool', required: false }
        ]
    },
    {
        name: 'loyalty_settings',
        type: 'base',
        fields: [
            { name: 'points_per_rupee', type: 'number', required: true },
            { name: 'redemption_value', type: 'number', required: true },
            { name: 'min_redemption_points', type: 'number', required: true },
            { name: 'max_redemption_percent', type: 'number', required: true },
            { name: 'points_validity_days', type: 'number', required: true },
            { name: 'signup_bonus', type: 'number', required: false },
            { name: 'birthday_bonus', type: 'number', required: false },
            { name: 'referral_bonus', type: 'number', required: false },
            { name: 'is_active', type: 'bool', required: false }
        ]
    },
    {
        name: 'loyalty_tiers',
        type: 'base',
        fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'min_points', type: 'number', required: true },
            { name: 'max_points', type: 'number', required: false },
            { name: 'multiplier', type: 'number', required: true },
            { name: 'discount_percent', type: 'number', required: false },
            { name: 'color', type: 'text', required: false },
            { name: 'benefits', type: 'json', required: false }
        ]
    },
    {
        name: 'roles',
        type: 'base',
        fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'description', type: 'text', required: false },
            { name: 'permissions', type: 'json', required: false },
            { name: 'is_system', type: 'bool', required: false }
        ]
    },

    // --- LEVEL 2 ---
    {
        name: 'products',
        type: 'base',
        fields: [
            { name: 'name', type: 'text', required: true },
            { name: 'sku', type: 'text', required: true },
            { name: 'description', type: 'text', required: false },
            { name: 'base_price', type: 'number', required: true },
            { name: 'cost_price', type: 'number', required: false },
            { name: 'category', type: 'relation', collectionId: 'categories', required: false },
            { name: 'image_url', type: 'url', required: false },
            { name: 'barcode', type: 'text', required: false },
            { name: 'is_active', type: 'bool', required: false },
            { name: 'min_stock_level', type: 'number', required: false },
            { name: 'track_stock', type: 'bool', required: false },
            { name: 'tax_rate', type: 'number', required: false },
            { name: 'stock_quantity', type: 'number', required: false }
        ]
    },
    {
        name: 'loyalty_accounts',
        type: 'base',
        fields: [
            { name: 'customer', type: 'relation', collectionId: 'customers', required: true },
            { name: 'tier', type: 'relation', collectionId: 'loyalty_tiers', required: false },
            { name: 'total_points_earned', type: 'number', required: false },
            { name: 'total_points_redeemed', type: 'number', required: false },
            { name: 'current_balance', type: 'number', required: false },
            { name: 'lifetime_value', type: 'number', required: false },
            { name: 'member_since', type: 'date', required: false },
            { name: 'last_activity', type: 'date', required: false },
            { name: 'is_active', type: 'bool', required: false },
            { name: 'notes', type: 'text', required: false }
        ]
    },
    {
        name: 'user_roles',
        type: 'base',
        fields: [
            { name: 'user', type: 'relation', collectionId: '_pb_users_auth_', cascadeDelete: true, required: true },
            { name: 'role', type: 'relation', collectionId: 'roles', cascadeDelete: true, required: true }
        ]
    },
    {
        name: 'bank_transactions',
        type: 'base',
        fields: [
            { name: 'account', type: 'relation', collectionId: 'bank_accounts', cascadeDelete: false, required: true },
            { name: 'transaction_date', type: 'date', required: true },
            { name: 'type', type: 'select', maxSelect: 1, values: ['deposit', 'withdrawal', 'transfer'], required: true },
            { name: 'amount', type: 'number', required: true },
            { name: 'description', type: 'text', required: false },
            { name: 'reference_number', type: 'text', required: false },
            { name: 'related_entity_type', type: 'text', required: false },
            { name: 'related_entity_id', type: 'text', required: false }
        ]
    },
    {
        name: 'cash_register_shifts',
        type: 'base',
        fields: [
            { name: 'user', type: 'relation', collectionId: '_pb_users_auth_', required: true },
            { name: 'terminal_id', type: 'text', required: false },
            { name: 'opened_at', type: 'date', required: true },
            { name: 'closed_at', type: 'date', required: false },
            { name: 'opening_balance', type: 'number', required: true },
            { name: 'closing_balance', type: 'number', required: false },
            { name: 'expected_balance', type: 'number', required: false },
            { name: 'total_cash_sales', type: 'number', required: false },
            { name: 'total_card_sales', type: 'number', required: false },
            { name: 'total_upi_sales', type: 'number', required: false },
            { name: 'total_cash_refunds', type: 'number', required: false },
            { name: 'cash_added', type: 'number', required: false },
            { name: 'cash_removed', type: 'number', required: false },
            { name: 'variance', type: 'number', required: false },
            { name: 'variance_notes', type: 'text', required: false },
            { name: 'status', type: 'select', maxSelect: 1, values: ['open', 'closed', 'suspended'], required: true },
            { name: 'notes', type: 'text', required: false }
        ]
    },

    // --- LEVEL 3 ---
    {
        name: 'product_variants',
        type: 'base',
        fields: [
            { name: 'product', type: 'relation', collectionId: 'products', cascadeDelete: true, required: true },
            { name: 'variant_name', type: 'text', required: true },
            { name: 'sku_suffix', type: 'text', required: false },
            { name: 'price_adjustment', type: 'number', required: false },
            { name: 'stock_level', type: 'number', required: true },
            { name: 'low_stock_threshold', type: 'number', required: false },
            { name: 'size', type: 'text', required: false },
            { name: 'color', type: 'text', required: false },
            { name: 'material', type: 'text', required: false }
        ]
    },
    {
        name: 'product_attribute_values',
        type: 'base',
        fields: [
            { name: 'product', type: 'relation', collectionId: 'products', cascadeDelete: true, required: true },
            { name: 'attribute', type: 'relation', collectionId: 'product_attributes', required: true },
            { name: 'value', type: 'text', required: true }
        ]
    },
    {
        name: 'cash_drawer_operations',
        type: 'base',
        fields: [
            { name: 'shift', type: 'relation', collectionId: 'cash_register_shifts', required: true },
            { name: 'operation_type', type: 'select', maxSelect: 1, values: ['add', 'remove', 'sale', 'refund'], required: true },
            { name: 'amount', type: 'number', required: true },
            { name: 'reason', type: 'text', required: false },
            { name: 'performed_by', type: 'text', required: false },
            { name: 'performed_at', type: 'date', required: true }
        ]
    },
    {
        name: 'loyalty_transactions',
        type: 'base',
        fields: [
            { name: 'account', type: 'relation', collectionId: 'loyalty_accounts', required: true },
            { name: 'type', type: 'select', maxSelect: 1, values: ['earn', 'redeem', 'adjust', 'expire', 'bonus'], required: true },
            { name: 'points', type: 'number', required: true },
            { name: 'balance_after', type: 'number', required: true },
            { name: 'reference_type', type: 'text', required: false },
            { name: 'reference_id', type: 'text', required: false },
            { name: 'description', type: 'text', required: false }
        ]
    },

    // --- LEVEL 4 ---
    {
        name: 'sales',
        type: 'base',
        fields: [
            { name: 'channel', type: 'select', maxSelect: 1, values: ['pos', 'shopify', 'whatsapp'], required: true },
            { name: 'subtotal', type: 'number', required: true },
            { name: 'discount', type: 'number', required: false },
            { name: 'total', type: 'number', required: true },
            { name: 'status', type: 'select', maxSelect: 1, values: ['pending', 'confirmed', 'completed', 'cancelled'], required: true },
            { name: 'payment_method', type: 'select', maxSelect: 1, values: ['cash', 'card', 'upi', 'split'], required: false },
            { name: 'customer', type: 'relation', collectionId: 'customers', required: false },
            { name: 'customer_name', type: 'text', required: false },
            { name: 'notes', type: 'text', required: false },
            { name: 'register_shift_id', type: 'relation', collectionId: 'cash_register_shifts', required: false },
            { name: 'cash_tendered', type: 'number', required: false },
            { name: 'change_given', type: 'number', required: false }
        ]
    },
    {
        name: 'sales_orders',
        type: 'base',
        fields: [
            { name: 'order_type', type: 'select', maxSelect: 1, values: ['estimate', 'sales_order'], required: true },
            { name: 'customer', type: 'relation', collectionId: 'customers', required: false },
            { name: 'customer_name', type: 'text', required: true },
            { name: 'customer_phone', type: 'text', required: false },
            { name: 'customer_email', type: 'text', required: false },
            { name: 'billing_address', type: 'text', required: false },
            { name: 'shipping_address', type: 'text', required: false },
            { name: 'order_date', type: 'date', required: true },
            { name: 'valid_until', type: 'date', required: false },
            { name: 'expected_delivery_date', type: 'date', required: false },
            { name: 'status', type: 'select', maxSelect: 1, values: ['draft', 'sent', 'confirmed', 'shipped', 'delivered', 'cancelled', 'invoiced'], required: true },
            { name: 'notes', type: 'text', required: false },
            { name: 'internal_notes', type: 'text', required: false },
            { name: 'subtotal', type: 'number', required: true },
            { name: 'tax_total', type: 'number', required: false },
            { name: 'discount_total', type: 'number', required: false },
            { name: 'shipping_charges', type: 'number', required: false },
            { name: 'total', type: 'number', required: true },
            { name: 'order_number', type: 'text', required: false }
        ]
    },
    {
        name: 'purchase_orders',
        type: 'base',
        fields: [
            { name: 'po_number', type: 'text', required: false },
            { name: 'vendor', type: 'relation', collectionId: 'vendors', required: true },
            { name: 'status', type: 'select', maxSelect: 1, values: ['draft', 'sent', 'partial', 'received', 'cancelled'], required: true },
            { name: 'order_date', type: 'date', required: true },
            { name: 'expected_date', type: 'date', required: false },
            { name: 'subtotal', type: 'number', required: false },
            { name: 'gst_amount', type: 'number', required: false },
            { name: 'shipping_cost', type: 'number', required: false },
            { name: 'discount_amount', type: 'number', required: false },
            { name: 'total', type: 'number', required: false },
            { name: 'shipping_address', type: 'text', required: false },
            { name: 'notes', type: 'text', required: false }
        ]
    },

    // --- LEVEL 5 ---
    {
        name: 'sale_items',
        type: 'base',
        fields: [
            { name: 'sale', type: 'relation', collectionId: 'sales', cascadeDelete: true, required: true },
            { name: 'product', type: 'relation', collectionId: 'products', required: true },
            { name: 'variant', type: 'relation', collectionId: 'product_variants', required: false },
            { name: 'quantity', type: 'number', required: true },
            { name: 'unit_price', type: 'number', required: true },
            { name: 'total_price', type: 'number', required: true },
            { name: 'remarks', type: 'text', required: false }
        ]
    },
    {
        name: 'sales_order_items',
        type: 'base',
        fields: [
            { name: 'order', type: 'relation', collectionId: 'sales_orders', cascadeDelete: true, required: true },
            { name: 'product', type: 'relation', collectionId: 'products', required: true },
            { name: 'variant', type: 'relation', collectionId: 'product_variants', required: true },
            { name: 'description', type: 'text', required: false },
            { name: 'quantity', type: 'number', required: true },
            { name: 'unit_price', type: 'number', required: true },
            { name: 'tax_rate', type: 'number', required: false },
            { name: 'discount_amount', type: 'number', required: false },
            { name: 'total', type: 'number', required: true }
        ]
    },
    {
        name: 'purchase_order_items',
        type: 'base',
        fields: [
            { name: 'po', type: 'relation', collectionId: 'purchase_orders', cascadeDelete: true, required: true },
            { name: 'variant', type: 'relation', collectionId: 'product_variants', required: false },
            { name: 'description', type: 'text', required: false },
            { name: 'hsn_code', type: 'text', required: false },
            { name: 'quantity_ordered', type: 'number', required: true },
            { name: 'quantity_received', type: 'number', required: false },
            { name: 'unit', type: 'text', required: false },
            { name: 'unit_price', type: 'number', required: true },
            { name: 'gst_rate', type: 'number', required: false },
            { name: 'gst_amount', type: 'number', required: false },
            { name: 'total_price', type: 'number', required: true }
        ]
    },
    {
        name: 'customer_interactions',
        type: 'base',
        fields: [
            { name: 'customer', type: 'relation', collectionId: 'customers', required: true },
            { name: 'interaction_type', type: 'text', required: true },
            { name: 'description', type: 'text', required: false },
            { name: 'sale', type: 'relation', collectionId: 'sales', required: false },
            { name: 'order_id', type: 'text', required: false },
            { name: 'created_by', type: 'text', required: false }
        ]
    },
    {
        name: 'vendor_products',
        type: 'base',
        fields: [
            { name: 'vendor', type: 'relation', collectionId: 'vendors', required: true },
            { name: 'variant', type: 'relation', collectionId: 'product_variants', required: true },
            { name: 'vendor_sku', type: 'text', required: false },
            { name: 'vendor_price', type: 'number', required: false },
            { name: 'lead_time_days', type: 'number', required: false }
        ]
    },

    // --- LEVEL 6 ---
    {
        name: 'goods_received_notes',
        type: 'base',
        fields: [
            { name: 'grn_number', type: 'text', required: false },
            { name: 'po', type: 'relation', collectionId: 'purchase_orders', required: false },
            { name: 'vendor', type: 'relation', collectionId: 'vendors', required: false },
            { name: 'received_date', type: 'date', required: true },
            { name: 'received_by', type: 'text', required: false },
            { name: 'notes', type: 'text', required: false }
        ]
    },

    // --- LEVEL 7 ---
    {
        name: 'grn_items',
        type: 'base',
        fields: [
            { name: 'grn', type: 'relation', collectionId: 'goods_received_notes', cascadeDelete: true, required: true },
            { name: 'po_item', type: 'relation', collectionId: 'purchase_order_items', required: false },
            { name: 'variant', type: 'relation', collectionId: 'product_variants', required: false },
            { name: 'quantity_received', type: 'number', required: true },
            { name: 'quantity_rejected', type: 'number', required: false },
            { name: 'rejection_reason', type: 'text', required: false }
        ]
    }
];

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("Logged in!");

        const OPEN_RULE = '@request.auth.id != ""';

        // --- TEARDOWN PHASE ---
        console.log("\n=== TEARDOWN PHASE ===");
        const REVERSE_COLLECTIONS = [...BLUEPRINTS].reverse();
        for (const colDef of REVERSE_COLLECTIONS) {
            try {
                const existing = await pb.collections.getFirstListItem(`name="${colDef.name}"`);
                console.log(`Deleting ${colDef.name} (id: ${existing.id})...`);
                await pb.collections.delete(existing.id);
            } catch (e) {
                // Ignore
            }
        }

        // --- TRACKING IDs ---
        // Map Name -> ID
        const collectionIds = new Map<string, string>();

        // Also add system users if needed
        try {
            const users = await pb.collections.getFirstListItem('name="users"');
            collectionIds.set('users', users.id);
            collectionIds.set('_pb_users_auth_', users.id);
        } catch { }

        // --- SETUP PHASE ---
        console.log("\n=== SETUP PHASE ===");
        for (const colDef of BLUEPRINTS) {
            console.log(`Creating ${colDef.name}...`);

            // Resolve Relation IDs
            const finalFields = colDef.fields.map(f => {
                if (f.type === 'relation' && f.collectionId) {
                    const mappedId = collectionIds.get(f.collectionId);
                    if (!mappedId) {
                        console.warn(`⚠️ Warning: Collection '${f.collectionId}' not found in map for field '${f.name}'. Using raw value.`);
                        return f; // Fallback, likely will fail if not valid ID
                    }
                    return { ...f, collectionId: mappedId };
                }
                return f;
            });

            try {
                const record = await pb.collections.create({
                    name: colDef.name,
                    type: colDef.type,
                    fields: finalFields,
                    listRule: OPEN_RULE,
                    viewRule: OPEN_RULE,
                    createRule: OPEN_RULE,
                    updateRule: OPEN_RULE,
                    deleteRule: OPEN_RULE
                });
                console.log(`✅ ${colDef.name} created (ID: ${record.id}).`);
                collectionIds.set(colDef.name, record.id);
            } catch (err: any) {
                console.error(`❌ Failed to create ${colDef.name}:`);
                if (err.response && err.response.data) {
                    console.error(JSON.stringify(err.response.data, null, 2));
                } else {
                    console.error(err);
                }
                process.exit(1);
            }
        }

        // --- POST-CREATION UPDATES (Self-Refs) ---
        console.log("\n=== POST-CREATION UPDATES ===");
        try {
            const catId = collectionIds.get('categories');
            if (catId) {
                console.log("Updating categories (adding parent relation)...");
                const cat = await pb.collections.getOne(catId);
                await pb.collections.update(catId, {
                    fields: [
                        ...cat.fields,
                        { name: 'parent', type: 'relation', collectionId: catId, required: false }
                    ]
                });
                console.log("✅ categories updated.");
            }
        } catch (e) {
            console.error("❌ Failed to update categories:", e);
        }

        console.log("-----------------------------------------");
        console.log("Master Schema Rebuild Completed");
        console.log("-----------------------------------------");

    } catch (err: any) {
        console.error("FATAL ERROR:", err);
    }
}

main();
