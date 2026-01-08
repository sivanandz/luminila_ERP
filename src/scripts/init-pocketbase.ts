import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// Types for Collection Creation
// Ref: https://pocketbase.io/docs/api-collections/

async function main() {
    try {
        console.log("Authenticating as Admin...");
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        console.log("Logged in!");

        // Helper to create collection if not exists
        const createCollection = async (data: any) => {
            try {
                // Check if exists
                try {
                    await pb.collections.getFirstListItem(`name="${data.name}"`);
                    console.log(`Collection ${data.name} already exists. Skipping.`);
                    return;
                } catch (e) {
                    // Not found, proceed to create
                }

                // Double check by ID or Name specific lookup if needed, but getFirstListItem is robust for checks
                try {
                    await pb.collections.getOne(data.name);
                    console.log(`Collection ${data.name} exists (by ID check). Skipping.`);
                    return;
                } catch (e) { }

                console.log(`Creating collection: ${data.name}...`);
                await pb.collections.create(data);
                console.log(`✅ ${data.name} created.`);
            } catch (err: any) {
                // If error is "400", it might mean it already exists with a different config or name conflict
                if (err.status === 400 && err.response?.data?.name?.message === "The name is already in use.") {
                    console.log(`Collection ${data.name} already exists (400).`);
                } else {
                    console.error(`❌ Failed to create ${data.name}:`, err.originalError || err);
                }
            }
        };

        // --- 1. Customers ---
        await createCollection({
            name: 'customers',
            type: 'base',
            schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'phone', type: 'text', required: false },
                { name: 'email', type: 'email', required: false },
                { name: 'address', type: 'text', required: false },
                { name: 'gstin', type: 'text', required: false },
                { name: 'loyalty_points', type: 'number', required: false },
                { name: 'total_spent', type: 'number', required: false }
            ],
            indexes: [
                // 'CREATE INDEX `idx_customers_phone` ON `customers` (`phone`)',
            ]
        });

        // --- 2. Vendors ---
        await createCollection({
            name: 'vendors',
            type: 'base',
            schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'contact_name', type: 'text', required: false },
                { name: 'phone', type: 'text', required: false },
                { name: 'email', type: 'email', required: false },
                { name: 'address', type: 'text', required: false },
                { name: 'gstin', type: 'text', required: false }
            ]
        });

        // --- 3. Products ---
        await createCollection({
            name: 'products',
            type: 'base',
            schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'sku', type: 'text', required: true }, // Main SKU
                { name: 'description', type: 'text', required: false },
                { name: 'base_price', type: 'number', required: true },
                { name: 'cost_price', type: 'number', required: false },
                { name: 'category', type: 'text', required: false },
                { name: 'image_url', type: 'url', required: false }, // Use PB File in future? simple URL for now
                { name: 'barcode', type: 'text', required: false }, // Store JSON/String
                { name: 'is_active', type: 'bool', required: false }
            ],
            indexes: [
                // 'CREATE UNIQUE INDEX `idx_products_sku` ON `products` (`sku`)'
            ]
        });

        // --- 4. Product Variants (Sub-table concept in PB is separate collection) ---
        await createCollection({
            name: 'product_variants',
            type: 'base',
            schema: [
                { name: 'product', type: 'relation', collectionId: 'products', cascadeDelete: true, required: true },
                { name: 'variant_name', type: 'text', required: true }, // e.g. "Red / M"
                { name: 'sku_suffix', type: 'text', required: false },
                { name: 'price_adjustment', type: 'number', required: false }, // Added to base
                { name: 'stock_level', type: 'number', required: true },
                { name: 'low_stock_threshold', type: 'number', required: false },
                { name: 'size', type: 'text', required: false },
                { name: 'color', type: 'text', required: false },
                { name: 'material', type: 'text', required: false }
            ]
        });

        // --- 5. Sales (Orders) ---
        await createCollection({
            name: 'sales',
            type: 'base',
            schema: [
                { name: 'channel', type: 'select', options: { values: ['pos', 'shopify', 'whatsapp'] }, required: true },
                { name: 'subtotal', type: 'number', required: true },
                { name: 'discount', type: 'number', required: false },
                { name: 'total', type: 'number', required: true },
                { name: 'status', type: 'select', options: { values: ['pending', 'confirmed', 'completed', 'cancelled'] }, required: true },
                { name: 'payment_method', type: 'select', options: { values: ['cash', 'card', 'upi', 'split'] }, required: false },
                { name: 'customer', type: 'relation', collectionId: 'customers', required: false },
                { name: 'customer_name', type: 'text', required: false }, // Snapshot
                { name: 'notes', type: 'text', required: false }
            ]
        });

        // --- 6. Sale Items ---
        await createCollection({
            name: 'sale_items',
            type: 'base',
            schema: [
                { name: 'sale', type: 'relation', collectionId: 'sales', cascadeDelete: true, required: true },
                { name: 'product', type: 'relation', collectionId: 'products', required: true },
                { name: 'variant', type: 'relation', collectionId: 'product_variants', required: false },
                { name: 'quantity', type: 'number', required: true },
                { name: 'unit_price', type: 'number', required: true },
                { name: 'total_price', type: 'number', required: true },
                { name: 'remarks', type: 'text', required: false }
            ]
        });

        // --- 7. Bank Accounts ---
        await createCollection({
            name: 'bank_accounts',
            type: 'base',
            schema: [
                { name: 'account_name', type: 'text', required: true },
                { name: 'account_number', type: 'text', required: false },
                { name: 'bank_name', type: 'text', required: false },
                { name: 'ifsc_code', type: 'text', required: false },
                { name: 'currency', type: 'text', required: false }, // INR
                { name: 'opening_balance', type: 'number', required: true },
                { name: 'current_balance', type: 'number', required: true }, // Updated manually/via hooks in PB
                { name: 'is_active', type: 'bool', required: false }
            ]
        });

        // --- 8. Bank Transactions ---
        await createCollection({
            name: 'bank_transactions',
            type: 'base',
            schema: [
                { name: 'account', type: 'relation', collectionId: 'bank_accounts', cascadeDelete: false, required: true },
                { name: 'transaction_date', type: 'date', required: true },
                { name: 'type', type: 'select', options: { values: ['deposit', 'withdrawal', 'transfer'] }, required: true },
                { name: 'amount', type: 'number', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'reference_number', type: 'text', required: false },
                { name: 'related_entity_type', type: 'text', required: false }, // 'sale', 'purchase'
                { name: 'related_entity_id', type: 'text', required: false }
            ]
        });

        // --- 9. RBAC: Roles ---
        await createCollection({
            name: 'roles',
            type: 'base',
            schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'permissions', type: 'json', required: false }, // Store JSON mapping
                { name: 'is_system', type: 'bool', required: false }
            ]
        });

        // --- 10. RBAC: User Roles ---
        // Note: PocketBase 'users' collection can strict relation, but for M:N we use junction
        await createCollection({
            name: 'user_roles',
            type: 'base',
            schema: [
                { name: 'user', type: 'relation', collectionId: '_pb_users_auth_', cascadeDelete: true, required: true },
                { name: 'role', type: 'relation', collectionId: 'roles', cascadeDelete: true, required: true }
            ],
            indexes: [
                // 'CREATE UNIQUE INDEX idx_user_role ON user_roles (user, role)'
            ]
        });

        // --- 11. POS: Cash Register Shifts ---
        await createCollection({
            name: 'cash_register_shifts',
            type: 'base',
            schema: [
                { name: 'user', type: 'relation', collectionId: 'users', required: true },
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
                { name: 'status', type: 'select', options: { values: ['open', 'closed', 'suspended'] }, required: true },
                { name: 'notes', type: 'text', required: false }
            ]
        });

        // --- 12. POS: Cash Drawer Operations ---
        await createCollection({
            name: 'cash_drawer_operations',
            type: 'base',
            schema: [
                { name: 'shift', type: 'relation', collectionId: 'cash_register_shifts', required: true },
                { name: 'operation_type', type: 'select', options: { values: ['add', 'remove', 'sale', 'refund'] }, required: true },
                { name: 'amount', type: 'number', required: true },
                { name: 'reason', type: 'text', required: false },
                { name: 'performed_by', type: 'text', required: false },
                { name: 'performed_at', type: 'date', required: true }
            ]
        });

        // --- 13. Loyalty: Settings ---
        await createCollection({
            name: 'loyalty_settings',
            type: 'base',
            schema: [
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
        });

        // --- 14. Loyalty: Tiers ---
        await createCollection({
            name: 'loyalty_tiers',
            type: 'base',
            schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'min_points', type: 'number', required: true },
                { name: 'max_points', type: 'number', required: false },
                { name: 'multiplier', type: 'number', required: true },
                { name: 'discount_percent', type: 'number', required: false },
                { name: 'color', type: 'text', required: false },
                { name: 'benefits', type: 'json', required: false }
            ]
        });

        // --- 15. Loyalty: Accounts ---
        await createCollection({
            name: 'loyalty_accounts',
            type: 'base',
            schema: [
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
        });

        // --- 16. Loyalty: Transactions ---
        await createCollection({
            name: 'loyalty_transactions',
            type: 'base',
            schema: [
                { name: 'account', type: 'relation', collectionId: 'loyalty_accounts', required: true },
                { name: 'type', type: 'select', options: { values: ['earn', 'redeem', 'adjust', 'expire', 'bonus'] }, required: true },
                { name: 'points', type: 'number', required: true },
                { name: 'balance_after', type: 'number', required: true },
                { name: 'reference_type', type: 'text', required: false },
                { name: 'reference_id', type: 'text', required: false },
                { name: 'description', type: 'text', required: false }
            ]
        });

        // --- 17. Store Settings ---
        await createCollection({
            name: 'store_settings',
            type: 'base',
            schema: [
                { name: 'key', type: 'text', required: true },
                { name: 'value', type: 'text', required: false }
            ]
        });

        // --- 18. Invoices ---
        await createCollection({
            name: 'invoices',
            type: 'base',
            schema: [
                { name: 'invoice_number', type: 'text', required: true },
                { name: 'invoice_date', type: 'date', required: true },
                { name: 'invoice_type', type: 'select', options: { values: ['regular', 'credit_note', 'debit_note'] }, required: true },
                { name: 'seller_gstin', type: 'text', required: false },
                { name: 'seller_name', type: 'text', required: false },
                { name: 'seller_address', type: 'text', required: false },
                { name: 'seller_state_code', type: 'text', required: false },
                { name: 'buyer_name', type: 'text', required: true },
                { name: 'buyer_gstin', type: 'text', required: false },
                { name: 'buyer_phone', type: 'text', required: false },
                { name: 'buyer_email', type: 'email', required: false },
                { name: 'buyer_address', type: 'text', required: false },
                { name: 'buyer_state_code', type: 'text', required: false },
                { name: 'place_of_supply', type: 'text', required: false },
                { name: 'sale', type: 'relation', options: { collectionId: 'sales', maxSelect: 1 }, required: false },
                { name: 'taxable_value', type: 'number', required: true },
                { name: 'cgst_amount', type: 'number', required: false },
                { name: 'sgst_amount', type: 'number', required: false },
                { name: 'igst_amount', type: 'number', required: false },
                { name: 'cess_amount', type: 'number', required: false },
                { name: 'total_tax', type: 'number', required: true },
                { name: 'discount_amount', type: 'number', required: false },
                { name: 'shipping_charges', type: 'number', required: false },
                { name: 'grand_total', type: 'number', required: true },
                { name: 'amount_in_words', type: 'text', required: false },
                { name: 'is_reverse_charge', type: 'bool', required: false },
                { name: 'transport_mode', type: 'text', required: false },
                { name: 'vehicle_number', type: 'text', required: false },
                { name: 'payment_terms', type: 'text', required: false },
                { name: 'due_date', type: 'date', required: false },
                { name: 'is_paid', type: 'bool', required: false },
                { name: 'paid_amount', type: 'number', required: false },
                { name: 'notes', type: 'text', required: false },
                { name: 'internal_notes', type: 'text', required: false }
            ]
        });

        // --- 19. Invoice Items ---
        await createCollection({
            name: 'invoice_items',
            type: 'base',
            schema: [
                { name: 'invoice', type: 'relation', options: { collectionId: 'invoices', maxSelect: 1 }, required: true },
                { name: 'variant', type: 'relation', options: { collectionId: 'product_variants', maxSelect: 1 }, required: false },
                { name: 'sr_no', type: 'number', required: true },
                { name: 'description', type: 'text', required: true },
                { name: 'hsn_code', type: 'text', required: false },
                { name: 'quantity', type: 'number', required: true },
                { name: 'unit', type: 'text', required: false },
                { name: 'unit_price', type: 'number', required: true },
                { name: 'discount_percent', type: 'number', required: false },
                { name: 'discount_amount', type: 'number', required: false },
                { name: 'taxable_amount', type: 'number', required: true },
                { name: 'gst_rate', type: 'number', required: false },
                { name: 'cgst_rate', type: 'number', required: false },
                { name: 'cgst_amount', type: 'number', required: false },
                { name: 'sgst_rate', type: 'number', required: false },
                { name: 'sgst_amount', type: 'number', required: false },
                { name: 'igst_rate', type: 'number', required: false },
                { name: 'igst_amount', type: 'number', required: false },
                { name: 'cess_rate', type: 'number', required: false },
                { name: 'cess_amount', type: 'number', required: false },
                { name: 'total_amount', type: 'number', required: true }
            ]
        });

        // --- 20. Invoice Payments ---
        await createCollection({
            name: 'invoice_payments',
            type: 'base',
            schema: [
                { name: 'invoice', type: 'relation', options: { collectionId: 'invoices', maxSelect: 1 }, required: true },
                { name: 'amount', type: 'number', required: true },
                { name: 'payment_date', type: 'date', required: true },
                { name: 'payment_method', type: 'select', options: { values: ['cash', 'card', 'upi', 'bank_transfer', 'cheque'] }, required: true },
                { name: 'reference', type: 'text', required: false },
                { name: 'recorded_by', type: 'text', required: false }
            ]
        });

        // --- 21. Purchase Orders ---
        await createCollection({
            name: 'purchase_orders',
            type: 'base',
            schema: [
                { name: 'po_number', type: 'text', required: true },
                { name: 'vendor', type: 'relation', options: { collectionId: 'vendors', maxSelect: 1 }, required: false },
                { name: 'status', type: 'select', options: { values: ['draft', 'sent', 'partial', 'received', 'cancelled'] }, required: true },
                { name: 'order_date', type: 'date', required: true },
                { name: 'expected_date', type: 'date', required: false },
                { name: 'received_date', type: 'date', required: false },
                { name: 'subtotal', type: 'number', required: true },
                { name: 'gst_amount', type: 'number', required: false },
                { name: 'shipping_cost', type: 'number', required: false },
                { name: 'discount_amount', type: 'number', required: false },
                { name: 'total', type: 'number', required: true },
                { name: 'shipping_address', type: 'text', required: false },
                { name: 'notes', type: 'text', required: false },
                { name: 'internal_notes', type: 'text', required: false }
            ]
        });

        // --- 22. Purchase Order Items ---
        await createCollection({
            name: 'purchase_order_items',
            type: 'base',
            schema: [
                { name: 'purchase_order', type: 'relation', options: { collectionId: 'purchase_orders', maxSelect: 1 }, required: true },
                { name: 'variant', type: 'relation', options: { collectionId: 'product_variants', maxSelect: 1 }, required: false },
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
        });

        // --- 23. Goods Received Notes ---
        await createCollection({
            name: 'goods_received_notes',
            type: 'base',
            schema: [
                { name: 'grn_number', type: 'text', required: true },
                { name: 'purchase_order', type: 'relation', options: { collectionId: 'purchase_orders', maxSelect: 1 }, required: false },
                { name: 'vendor', type: 'relation', options: { collectionId: 'vendors', maxSelect: 1 }, required: false },
                { name: 'received_date', type: 'date', required: true },
                { name: 'received_by', type: 'text', required: false },
                { name: 'notes', type: 'text', required: false }
            ]
        });

        // --- 24. GRN Items ---
        await createCollection({
            name: 'grn_items',
            type: 'base',
            schema: [
                { name: 'grn', type: 'relation', options: { collectionId: 'goods_received_notes', maxSelect: 1 }, required: true },
                { name: 'po_item', type: 'relation', options: { collectionId: 'purchase_order_items', maxSelect: 1 }, required: false },
                { name: 'variant', type: 'relation', options: { collectionId: 'product_variants', maxSelect: 1 }, required: false },
                { name: 'quantity_received', type: 'number', required: true },
                { name: 'quantity_rejected', type: 'number', required: false },
                { name: 'rejection_reason', type: 'text', required: false }
            ]
        });

        // --- 25. Credit Notes ---
        await createCollection({
            name: 'credit_notes',
            type: 'base',
            schema: [
                { name: 'credit_note_number', type: 'text', required: true },
                { name: 'original_invoice', type: 'relation', options: { collectionId: 'invoices', maxSelect: 1 }, required: false },
                { name: 'original_sale', type: 'relation', options: { collectionId: 'sales', maxSelect: 1 }, required: false },
                { name: 'return_reason', type: 'select', options: { values: ['defective', 'wrong_item', 'customer_request', 'damaged', 'size_exchange', 'other'] }, required: true },
                { name: 'notes', type: 'text', required: false },
                { name: 'buyer_name', type: 'text', required: true },
                { name: 'buyer_address', type: 'text', required: false },
                { name: 'buyer_gstin', type: 'text', required: false },
                { name: 'buyer_state_code', type: 'text', required: false },
                { name: 'taxable_value', type: 'number', required: true },
                { name: 'cgst_amount', type: 'number', required: false },
                { name: 'sgst_amount', type: 'number', required: false },
                { name: 'igst_amount', type: 'number', required: false },
                { name: 'total_tax', type: 'number', required: false },
                { name: 'grand_total', type: 'number', required: true },
                { name: 'status', type: 'select', options: { values: ['pending', 'approved', 'refunded', 'cancelled'] }, required: true },
                { name: 'refund_method', type: 'text', required: false },
                { name: 'refund_reference', type: 'text', required: false },
                { name: 'refunded_at', type: 'date', required: false }
            ]
        });

        // --- 26. Credit Note Items ---
        await createCollection({
            name: 'credit_note_items',
            type: 'base',
            schema: [
                { name: 'credit_note', type: 'relation', options: { collectionId: 'credit_notes', maxSelect: 1 }, required: true },
                { name: 'variant', type: 'relation', options: { collectionId: 'product_variants', maxSelect: 1 }, required: false },
                { name: 'original_invoice_item', type: 'relation', options: { collectionId: 'invoice_items', maxSelect: 1 }, required: false },
                { name: 'description', type: 'text', required: true },
                { name: 'hsn_code', type: 'text', required: false },
                { name: 'quantity', type: 'number', required: true },
                { name: 'unit_price', type: 'number', required: true },
                { name: 'discount_percent', type: 'number', required: false },
                { name: 'discount_amount', type: 'number', required: false },
                { name: 'taxable_amount', type: 'number', required: true },
                { name: 'gst_rate', type: 'number', required: false },
                { name: 'cgst_amount', type: 'number', required: false },
                { name: 'sgst_amount', type: 'number', required: false },
                { name: 'igst_amount', type: 'number', required: false },
                { name: 'total_amount', type: 'number', required: true },
                { name: 'stock_restored', type: 'bool', required: false }
            ]
        });

        // --- 27. Discounts ---
        await createCollection({
            name: 'discounts',
            type: 'base',
            schema: [
                { name: 'code', type: 'text', required: true },
                { name: 'name', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'discount_type', type: 'select', options: { values: ['percentage', 'fixed', 'buy_x_get_y'] }, required: true },
                { name: 'value', type: 'number', required: true },
                { name: 'max_discount', type: 'number', required: false },
                { name: 'min_purchase', type: 'number', required: false },
                { name: 'min_items', type: 'number', required: false },
                { name: 'applies_to', type: 'select', options: { values: ['all', 'category', 'product', 'customer_type'] }, required: false },
                { name: 'applies_to_ids', type: 'json', required: false },
                { name: 'usage_limit', type: 'number', required: false },
                { name: 'per_customer_limit', type: 'number', required: false },
                { name: 'used_count', type: 'number', required: false },
                { name: 'start_date', type: 'date', required: false },
                { name: 'end_date', type: 'date', required: false },
                { name: 'is_active', type: 'bool', required: false }
            ]
        });

        // --- 28. Discount Usage ---
        await createCollection({
            name: 'discount_usage',
            type: 'base',
            schema: [
                { name: 'discount', type: 'relation', options: { collectionId: 'discounts', maxSelect: 1 }, required: true },
                { name: 'customer', type: 'relation', options: { collectionId: 'customers', maxSelect: 1 }, required: false },
                { name: 'sale', type: 'relation', options: { collectionId: 'sales', maxSelect: 1 }, required: false },
                { name: 'invoice', type: 'relation', options: { collectionId: 'invoices', maxSelect: 1 }, required: false },
                { name: 'discount_amount', type: 'number', required: true },
                { name: 'order_value', type: 'number', required: true }
            ]
        });

        // --- 29. Expense Categories ---
        await createCollection({
            name: 'expense_categories',
            type: 'base',
            schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'is_active', type: 'bool', required: false }
            ]
        });

        // --- 30. Expenses ---
        await createCollection({
            name: 'expenses',
            type: 'base',
            schema: [
                { name: 'expense_number', type: 'text', required: true },
                { name: 'date', type: 'date', required: true },
                { name: 'category', type: 'relation', options: { collectionId: 'expense_categories', maxSelect: 1 }, required: false },
                { name: 'amount', type: 'number', required: true },
                { name: 'payment_mode', type: 'select', options: { values: ['cash', 'card', 'upi', 'bank_transfer', 'cheque', 'other'] }, required: false },
                { name: 'payee', type: 'text', required: false },
                { name: 'description', type: 'text', required: false },
                { name: 'receipt_url', type: 'url', required: false },
                { name: 'reference_number', type: 'text', required: false }
            ]
        });

        // --- 31. Stock Movements ---
        await createCollection({
            name: 'stock_movements',
            type: 'base',
            schema: [
                { name: 'variant', type: 'relation', options: { collectionId: 'product_variants', maxSelect: 1 }, required: true },
                { name: 'movement_type', type: 'select', options: { values: ['sale', 'purchase', 'adjustment', 'return', 'sync'] }, required: true },
                { name: 'quantity', type: 'number', required: true },
                { name: 'reference_id', type: 'text', required: false },
                { name: 'source', type: 'text', required: false },
                { name: 'notes', type: 'text', required: false }
            ]
        });

        // --- 32. Activity Logs ---
        await createCollection({
            name: 'activity_logs',
            type: 'base',
            schema: [
                { name: 'action', type: 'text', required: true },
                { name: 'entity_type', type: 'text', required: true },
                { name: 'entity_id', type: 'text', required: false },
                { name: 'description', type: 'text', required: true },
                { name: 'old_values', type: 'json', required: false },
                { name: 'new_values', type: 'json', required: false },
                { name: 'user_id', type: 'text', required: false },
                { name: 'user_name', type: 'text', required: false }
            ]
        });

        // --- 33. Delivery Challans ---
        await createCollection({
            name: 'delivery_challans',
            type: 'base',
            schema: [
                { name: 'challan_number', type: 'text', required: true },
                { name: 'challan_date', type: 'date', required: true },
                { name: 'challan_type', type: 'select', options: { values: ['job_work', 'stock_transfer', 'sale_return', 'exhibition', 'approval', 'other'] }, required: true },
                { name: 'status', type: 'select', options: { values: ['draft', 'issued', 'in_transit', 'delivered', 'returned', 'cancelled'] }, required: true },
                { name: 'consignor_name', type: 'text', required: true },
                { name: 'consignor_gstin', type: 'text', required: false },
                { name: 'consignor_address', type: 'text', required: false },
                { name: 'consignee_name', type: 'text', required: true },
                { name: 'consignee_gstin', type: 'text', required: false },
                { name: 'consignee_address', type: 'text', required: false },
                { name: 'place_of_supply', type: 'text', required: false },
                { name: 'vehicle_number', type: 'text', required: false },
                { name: 'transporter_name', type: 'text', required: false },
                { name: 'transport_mode', type: 'text', required: false },
                { name: 'eway_bill_number', type: 'text', required: false },
                { name: 'total_quantity', type: 'number', required: false },
                { name: 'total_value', type: 'number', required: false },
                { name: 'reason', type: 'text', required: false },
                { name: 'notes', type: 'text', required: false },
                { name: 'expected_delivery_date', type: 'date', required: false },
                { name: 'delivered_at', type: 'date', required: false }
            ]
        });

        // --- 34. Delivery Challan Items ---
        await createCollection({
            name: 'delivery_challan_items',
            type: 'base',
            schema: [
                { name: 'challan', type: 'relation', options: { collectionId: 'delivery_challans', maxSelect: 1 }, required: true },
                { name: 'product', type: 'relation', options: { collectionId: 'products', maxSelect: 1 }, required: false },
                { name: 'variant', type: 'relation', options: { collectionId: 'product_variants', maxSelect: 1 }, required: false },
                { name: 'sr_no', type: 'number', required: true },
                { name: 'description', type: 'text', required: true },
                { name: 'hsn_code', type: 'text', required: false },
                { name: 'quantity', type: 'number', required: true },
                { name: 'unit', type: 'text', required: false },
                { name: 'unit_price', type: 'number', required: false },
                { name: 'total', type: 'number', required: false },
                { name: 'remarks', type: 'text', required: false }
            ]
        });

        // --- 35. Sales Orders ---
        await createCollection({
            name: 'sales_orders',
            type: 'base',
            schema: [
                { name: 'order_number', type: 'text', required: true },
                { name: 'order_type', type: 'select', options: { values: ['estimate', 'sales_order'] }, required: true },
                { name: 'customer', type: 'relation', options: { collectionId: 'customers', maxSelect: 1 }, required: false },
                { name: 'customer_name', type: 'text', required: false },
                { name: 'customer_phone', type: 'text', required: false },
                { name: 'billing_address', type: 'text', required: false },
                { name: 'shipping_address', type: 'text', required: false },
                { name: 'order_date', type: 'date', required: true },
                { name: 'valid_until', type: 'date', required: false },
                { name: 'expected_delivery_date', type: 'date', required: false },
                { name: 'status', type: 'select', options: { values: ['draft', 'sent', 'confirmed', 'shipped', 'delivered', 'cancelled', 'invoiced'] }, required: true },
                { name: 'subtotal', type: 'number', required: true },
                { name: 'tax_total', type: 'number', required: false },
                { name: 'discount_total', type: 'number', required: false },
                { name: 'shipping_charges', type: 'number', required: false },
                { name: 'total', type: 'number', required: true },
                { name: 'notes', type: 'text', required: false }
            ]
        });

        // --- 36. Sales Order Items ---
        await createCollection({
            name: 'sales_order_items',
            type: 'base',
            schema: [
                { name: 'order', type: 'relation', options: { collectionId: 'sales_orders', maxSelect: 1 }, required: true },
                { name: 'product', type: 'relation', options: { collectionId: 'products', maxSelect: 1 }, required: false },
                { name: 'variant', type: 'relation', options: { collectionId: 'product_variants', maxSelect: 1 }, required: false },
                { name: 'description', type: 'text', required: false },
                { name: 'quantity', type: 'number', required: true },
                { name: 'unit_price', type: 'number', required: true },
                { name: 'tax_rate', type: 'number', required: false },
                { name: 'discount_amount', type: 'number', required: false },
                { name: 'total', type: 'number', required: true }
            ]
        });

        // --- 37. Customer Interactions ---
        await createCollection({
            name: 'customer_interactions',
            type: 'base',
            schema: [
                { name: 'customer', type: 'relation', options: { collectionId: 'customers', maxSelect: 1 }, required: true },
                { name: 'interaction_type', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'sale', type: 'relation', options: { collectionId: 'sales', maxSelect: 1 }, required: false },
                { name: 'order', type: 'relation', options: { collectionId: 'sales_orders', maxSelect: 1 }, required: false },
                { name: 'created_by', type: 'text', required: false }
            ]
        });

        // --- 38. Number Sequences (for auto-numbering) ---
        await createCollection({
            name: 'number_sequences',
            type: 'base',
            schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'prefix', type: 'text', required: false },
                { name: 'current_value', type: 'number', required: true },
                { name: 'padding', type: 'number', required: false }
            ]
        });

        console.log("-----------------------------------------");
        console.log("Schema Migration Completed Successfully");
        console.log("-----------------------------------------");

    } catch (err: any) {
        console.error("FATAL ERROR during migration:", err);
    }
}

main();
