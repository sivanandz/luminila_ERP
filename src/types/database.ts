/**
 * Database Types - Auto-generated from Supabase schema
 * 
 * To regenerate, run:
 * npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts
 */

export interface Database {
    public: {
        Tables: {
            products: {
                Row: {
                    id: string;
                    sku: string;
                    name: string;
                    description: string | null;
                    category: string | null;
                    base_price: number;
                    cost_price: number | null;
                    image_url: string | null;
                    barcode_data: string | null;
                    is_active: boolean;
                    created_at: string;
                    updated_at: string;
                };
                Insert: Omit<Database["public"]["Tables"]["products"]["Row"], "id" | "created_at" | "updated_at">;
                Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
            };
            product_variants: {
                Row: {
                    id: string;
                    product_id: string;
                    sku_suffix: string;
                    variant_name: string;
                    material: string | null;
                    size: string | null;
                    color: string | null;
                    price_adjustment: number;
                    stock_level: number;
                    low_stock_threshold: number;
                    shopify_inventory_id: string | null;
                    woocommerce_product_id: number | null;
                    created_at: string;
                };
                Insert: Omit<Database["public"]["Tables"]["product_variants"]["Row"], "id" | "created_at">;
                Update: Partial<Database["public"]["Tables"]["product_variants"]["Insert"]>;
            };
            vendors: {
                Row: {
                    id: string;
                    name: string;
                    contact_name: string | null;
                    phone: string | null;
                    email: string | null;
                    address: string | null;
                    created_at: string;
                };
                Insert: Omit<Database["public"]["Tables"]["vendors"]["Row"], "id" | "created_at">;
                Update: Partial<Database["public"]["Tables"]["vendors"]["Insert"]>;
            };
            vendor_products: {
                Row: {
                    id: string;
                    vendor_id: string;
                    variant_id: string;
                    vendor_sku: string | null;
                    vendor_price: number | null;
                    lead_time_days: number;
                };
                Insert: Omit<Database["public"]["Tables"]["vendor_products"]["Row"], "id">;
                Update: Partial<Database["public"]["Tables"]["vendor_products"]["Insert"]>;
            };
            sales: {
                Row: {
                    id: string;
                    channel: "pos" | "shopify" | "woocommerce" | "whatsapp";
                    channel_order_id: string | null;
                    customer_name: string | null;
                    customer_phone: string | null;
                    customer_address: string | null;
                    subtotal: number;
                    discount: number;
                    total: number;
                    payment_method: string | null;
                    status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
                    notes: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: Omit<Database["public"]["Tables"]["sales"]["Row"], "id" | "created_at" | "updated_at">;
                Update: Partial<Database["public"]["Tables"]["sales"]["Insert"]>;
            };
            sale_items: {
                Row: {
                    id: string;
                    sale_id: string;
                    variant_id: string;
                    quantity: number;
                    unit_price: number;
                    created_at: string;
                };
                Insert: Omit<Database["public"]["Tables"]["sale_items"]["Row"], "id" | "created_at">;
                Update: Partial<Database["public"]["Tables"]["sale_items"]["Insert"]>;
            };
            stock_movements: {
                Row: {
                    id: string;
                    variant_id: string;
                    movement_type: "sale" | "purchase" | "adjustment" | "return" | "sync";
                    quantity: number;
                    reference_id: string | null;
                    source: string | null;
                    notes: string | null;
                    created_at: string;
                };
                Insert: Omit<Database["public"]["Tables"]["stock_movements"]["Row"], "id" | "created_at">;
                Update: Partial<Database["public"]["Tables"]["stock_movements"]["Insert"]>;
            };
            sales_orders: {
                Row: {
                    id: string;
                    order_number: string;
                    order_type: "estimate" | "sales_order";
                    customer_id: string | null;
                    customer_name: string | null;
                    customer_phone: string | null;
                    customer_email: string | null;
                    billing_address: string | null;
                    shipping_address: string | null;
                    order_date: string;
                    valid_until: string | null;
                    expected_delivery_date: string | null;
                    status: "draft" | "sent" | "confirmed" | "shipped" | "delivered" | "cancelled" | "invoiced";
                    subtotal: number;
                    tax_total: number;
                    discount_total: number;
                    shipping_charges: number;
                    total: number;
                    notes: string | null;
                    internal_notes: string | null;
                    created_by: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: Omit<Database["public"]["Tables"]["sales_orders"]["Row"], "id" | "order_number" | "created_at" | "updated_at">;
                Update: Partial<Database["public"]["Tables"]["sales_orders"]["Insert"]>;
            };
            sales_order_items: {
                Row: {
                    id: string;
                    order_id: string;
                    product_id: string | null;
                    variant_id: string | null;
                    description: string | null;
                    quantity: number;
                    unit_price: number;
                    tax_rate: number;
                    discount_amount: number;
                    total: number;
                };
                Insert: Omit<Database["public"]["Tables"]["sales_order_items"]["Row"], "id">;
                Update: Partial<Database["public"]["Tables"]["sales_order_items"]["Insert"]>;
            };
            purchase_orders: {
                Row: {
                    id: string;
                    po_number: string;
                    vendor_id: string | null;
                    order_date: string;
                    expected_date: string | null;
                    received_date: string | null;
                    status: "draft" | "sent" | "partial" | "received" | "cancelled";
                    subtotal: number;
                    gst_amount: number;
                    shipping_cost: number;
                    discount_amount: number;
                    total: number;
                    shipping_address: string | null;
                    notes: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: Omit<Database["public"]["Tables"]["purchase_orders"]["Row"], "id" | "created_at" | "updated_at">;
                Update: Partial<Database["public"]["Tables"]["purchase_orders"]["Insert"]>;
            };
            purchase_order_items: {
                Row: {
                    id: string;
                    po_id: string;
                    variant_id: string | null;
                    description: string | null;
                    hsn_code: string | null;
                    quantity_ordered: number;
                    quantity_received: number;
                    unit: string | null;
                    unit_price: number;
                    gst_rate: number;
                    gst_amount: number;
                    total_price: number;
                };
                Insert: Omit<Database["public"]["Tables"]["purchase_order_items"]["Row"], "id">;
                Update: Partial<Database["public"]["Tables"]["purchase_order_items"]["Insert"]>;
            };
            goods_received_notes: {
                Row: {
                    id: string;
                    grn_number: string;
                    po_id: string | null;
                    vendor_id: string | null;
                    received_date: string;
                    received_by: string | null;
                    notes: string | null;
                    created_at: string;
                };
                Insert: Omit<Database["public"]["Tables"]["goods_received_notes"]["Row"], "id" | "created_at">;
                Update: Partial<Database["public"]["Tables"]["goods_received_notes"]["Insert"]>;
            };
            grn_items: {
                Row: {
                    id: string;
                    grn_id: string;
                    po_item_id: string | null;
                    variant_id: string | null;
                    quantity_received: number;
                    quantity_rejected: number;
                    rejection_reason: string | null;
                };
                Insert: Omit<Database["public"]["Tables"]["grn_items"]["Row"], "id">;
                Update: Partial<Database["public"]["Tables"]["grn_items"]["Insert"]>;
            },
            bank_accounts: {
                Row: {
                    id: string;
                    account_name: string;
                    account_number: string | null;
                    bank_name: string | null;
                    ifsc_code: string | null;
                    currency: string;
                    opening_balance: number;
                    current_balance: number;
                    is_active: boolean;
                    created_at: string;
                    updated_at: string;
                };
                Insert: any;
                Update: any;
            },
            bank_transactions: {
                Row: {
                    id: string;
                    account_id: string;
                    transaction_date: string;
                    type: "deposit" | "withdrawal" | "transfer";
                    amount: number;
                    description: string | null;
                    reference_number: string | null;
                    related_entity_type: string | null;
                    related_entity_id: string | null;
                    created_at: string;
                    created_by: string | null;
                    updated_at: string;
                };
                Insert: any;
                Update: any;
            }
        };
        Views: Record<string, never>;
        Functions: Record<string, never>;
        Enums: {
            sales_channel: "pos" | "shopify" | "woocommerce" | "whatsapp";
            order_status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" | "draft" | "sent" | "invoiced";
            movement_type: "sale" | "purchase" | "adjustment" | "return" | "sync";
            order_type: "estimate" | "sales_order";
            po_status: "draft" | "sent" | "partial" | "received" | "cancelled";
        };
    };
}

// Convenience types for common use cases
export type Product = Database["public"]["Tables"]["products"]["Row"];
export type ProductVariant = Database["public"]["Tables"]["product_variants"]["Row"];
export type Vendor = Database["public"]["Tables"]["vendors"]["Row"];
export type Sale = Database["public"]["Tables"]["sales"]["Row"];
export type SaleItem = Database["public"]["Tables"]["sale_items"]["Row"];
export type StockMovement = Database["public"]["Tables"]["stock_movements"]["Row"];

// Extended types with relations
export interface ProductWithVariants extends Product {
    variants: ProductVariant[];
}

export interface SaleWithItems extends Sale {
    items: (SaleItem & { variant: ProductVariant & { product: Product } })[];
}

// Cart types for PoS
export interface CartItem {
    variant: ProductVariant & { product: Product };
    quantity: number;
    unit_price: number;
}

export interface Cart {
    items: CartItem[];
    subtotal: number;
    discount: number;
    total: number;
}
