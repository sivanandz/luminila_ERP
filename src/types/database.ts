/**
 * PocketBase Collection Types
 * Native types for Luminila Inventory Management
 */

// ===========================================
// BASE RECORD TYPE
// ===========================================

/** Base fields present on every PocketBase record */
export interface PBRecord {
    id: string;
    created: string;
    updated: string;
    collectionId?: string;
    collectionName?: string;
}

// ===========================================
// PRODUCT COLLECTIONS
// ===========================================

export interface Product extends PBRecord {
    sku: string;
    name: string;
    description?: string;
    category?: string;
    base_price: number;
    cost_price?: number;
    image_url?: string;
    barcode?: string;
    is_active: boolean;
}

export interface ProductVariant extends PBRecord {
    product: string; // Relation → products
    variant_name: string;
    sku_suffix?: string;
    price_adjustment: number;
    stock_level: number;
    low_stock_threshold: number;
    size?: string;
    color?: string;
    material?: string;
    shopify_inventory_id?: string;
    woocommerce_product_id?: number;
    expand?: {
        product?: Product;
    };
}

// ===========================================
// SALES COLLECTIONS
// ===========================================

export type SalesChannel = 'pos' | 'shopify' | 'woocommerce' | 'whatsapp';
export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

export interface Sale extends PBRecord {
    channel: SalesChannel;
    channel_order_id?: string;
    customer_name?: string;
    customer_phone?: string;
    customer_address?: string;
    customer?: string; // Relation → customers
    subtotal: number;
    discount: number;
    total: number;
    payment_method?: string;
    status: OrderStatus;
    notes?: string;
}

export interface SaleItem extends PBRecord {
    sale: string; // Relation → sales
    variant: string; // Relation → product_variants
    quantity: number;
    unit_price: number;
    total_price: number;
}

// ===========================================
// STOCK
// ===========================================

export type MovementType = 'sale' | 'purchase' | 'adjustment' | 'return' | 'sync';

export interface StockMovement extends PBRecord {
    variant: string; // Relation → product_variants
    movement_type: MovementType;
    quantity: number;
    reference_id?: string;
    source?: string;
    notes?: string;
}

// ===========================================
// VENDOR COLLECTIONS
// ===========================================

export interface Vendor extends PBRecord {
    name: string;
    contact_name?: string;
    phone?: string;
    email?: string;
    address?: string;
}

export interface VendorProduct extends PBRecord {
    vendor: string; // Relation → vendors
    variant: string; // Relation → product_variants
    vendor_sku?: string;
    vendor_price?: number;
    lead_time_days: number;
}

// ===========================================
// ORDERS
// ===========================================

export type SalesOrderType = 'estimate' | 'sales_order';
export type SalesOrderStatus = 'draft' | 'sent' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'invoiced';

export interface SalesOrder extends PBRecord {
    order_number: string;
    order_type: SalesOrderType;
    customer?: string; // Relation → customers
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    billing_address?: string;
    shipping_address?: string;
    order_date: string;
    valid_until?: string;
    expected_delivery_date?: string;
    status: SalesOrderStatus;
    subtotal: number;
    tax_total: number;
    discount_total: number;
    shipping_charges: number;
    total: number;
    notes?: string;
    internal_notes?: string;
    created_by?: string;
}

export interface SalesOrderItem extends PBRecord {
    order: string; // Relation → sales_orders
    product?: string; // Relation → products
    variant?: string; // Relation → product_variants
    description?: string;
    quantity: number;
    unit_price: number;
    tax_rate: number;
    discount_amount: number;
    total: number;
}

// ===========================================
// PURCHASE ORDERS
// ===========================================

export type POStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';

export interface PurchaseOrder extends PBRecord {
    po_number: string;
    vendor?: string; // Relation → vendors
    order_date: string;
    expected_date?: string;
    received_date?: string;
    status: POStatus;
    subtotal: number;
    gst_amount: number;
    shipping_cost: number;
    discount_amount: number;
    total: number;
    shipping_address?: string;
    notes?: string;
}

export interface PurchaseOrderItem extends PBRecord {
    po: string; // Relation → purchase_orders
    variant?: string; // Relation → product_variants
    description?: string;
    hsn_code?: string;
    quantity_ordered: number;
    quantity_received: number;
    unit?: string;
    unit_price: number;
    gst_rate: number;
    gst_amount: number;
    total_price: number;
}

export interface GoodsReceivedNote extends PBRecord {
    grn_number: string;
    po?: string; // Relation → purchase_orders
    vendor?: string; // Relation → vendors
    received_date: string;
    received_by?: string;
    notes?: string;
}

export interface GRNItem extends PBRecord {
    grn: string; // Relation → goods_received_notes
    po_item?: string; // Relation → purchase_order_items
    variant?: string; // Relation → product_variants
    quantity_received: number;
    quantity_rejected: number;
    rejection_reason?: string;
}

// ===========================================
// COMPOSITE / UI TYPES
// ===========================================

export interface ProductWithVariants extends Product {
    variants: ProductVariant[];
}

export interface SaleWithItems extends Sale {
    items: (SaleItem & { variant: ProductVariant & { product: Product } })[];
}

// Cart types for PoS
export interface CartItem {
    variant: ProductVariant & { expand?: { product?: Product } };
    quantity: number;
    unit_price: number;
}

export interface Cart {
    items: CartItem[];
    subtotal: number;
    discount: number;
    total: number;
}
