/**
 * Multi-Location Inventory & Stock Management Engine
 * Supports Multi-PoS Counters, Multi-Warehouses, Safe Vaults, and Inter-Location Stock Transfers.
 */

import { pb, ensureAuth, getCurrentTenantEmail, getTenantStorageKey } from "./pocketbase";
import { ClientResponseError } from "pocketbase";
import { toast } from "sonner";
import { generateId } from "./utils";

// ============================================
// TYPES
// ============================================

export type LocationType = 'warehouse' | 'pos_store' | 'vault' | 'transit';

export interface InventoryLocation {
    id: string;
    code: string;               // e.g. "POS-MAIN", "WH-01"
    name: string;               // e.g. "Main Counter 1"
    type: LocationType;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    contact_phone?: string;
    gstin?: string;
    is_active: boolean;
    is_default: boolean;        // Default source for initial inventory inward
    allow_pos_sales: boolean;   // Can POS cashiers sell directly from this location?
    color?: string;             // UI badge styling accent
    account_email?: string;
    created?: string;
    updated?: string;
}

export interface LocationStock {
    location_id: string;
    location_name?: string;
    location_code?: string;
    location_type?: LocationType;
    quantity: number;
    reserved_quantity: number;
    available_quantity: number;
    min_threshold?: number;
    updated_at?: string;
}

export interface StockTransferItem {
    product_id: string;
    variant_id: string;
    sku: string;
    name: string;
    requested_quantity: number;
    dispatched_quantity: number;
    received_quantity: number;
    unit_cost?: number;
    barcode?: string;
}

export type TransferStatus = 'draft' | 'dispatched' | 'in_transit' | 'received' | 'cancelled';

export interface StockTransfer {
    id: string;
    transfer_number: string;     // e.g. "TRF-202610-001"
    source_location_id: string;
    source_location_name?: string;
    destination_location_id: string;
    destination_location_name?: string;
    status: TransferStatus;
    items: StockTransferItem[];
    challan_id?: string;         // Linked GST Delivery Challan
    challan_number?: string;
    eway_bill_number?: string;
    carrier?: string;            // e.g. "ST Courier", "Internal Van", "Staff Carry"
    tracking_awb?: string;
    notes?: string;
    dispatched_by?: string;
    dispatched_at?: string;
    received_by?: string;
    received_at?: string;
    account_email?: string;
    created: string;
    updated: string;
}

// ============================================
// DEFAULT ENTERPRISE LOCATIONS (CLEAN GENERIC DEFAULTS)
// ============================================

export function getDefaultLocations(): InventoryLocation[] {
    const userEmail = getCurrentTenantEmail();
    return [
        {
            id: "loc_pos_main",
            code: "POS-MAIN",
            name: "Main Counter",
            type: "pos_store",
            address: "",
            city: "",
            state: "",
            pincode: "",
            contact_phone: "",
            is_active: true,
            is_default: true,
            allow_pos_sales: true,
            color: "emerald",
            account_email: userEmail,
        },
    ];
}

export const DEFAULT_LOCATIONS: InventoryLocation[] = getDefaultLocations();

const getLocationsStorageKey = () => getTenantStorageKey("luminila_inventory_locations_v1");
const getTransfersStorageKey = () => getTenantStorageKey("luminila_stock_transfers_v1");
const getProductLocStockKey = () => getTenantStorageKey("luminila_product_location_stocks_v1");

// ============================================
// LOCATION SERVICE APIS
// ============================================

/**
 * Get all active locations with local storage caching and PocketBase sync
 */
export async function getInventoryLocations(): Promise<InventoryLocation[]> {
    ensureAuth();
    const userEmail = getCurrentTenantEmail();
    const storageKey = getLocationsStorageKey();

    // 1. Try PocketBase
    try {
        const records = await pb.collection("inventory_locations").getFullList<InventoryLocation>({
            filter: `is_active = true && account_email = "${userEmail}"`,
            sort: "name",
        });
        if (records && records.length > 0) {
            if (typeof window !== "undefined") {
                localStorage.setItem(storageKey, JSON.stringify(records));
            }
            return records;
        }
    } catch {
        // Fallback to cache/defaults if collection doesn't exist yet
    }

    // 2. Read from local cache
    if (typeof window !== "undefined") {
        const cached = localStorage.getItem(storageKey);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            } catch {}
        }
        const fallback = getDefaultLocations();
        localStorage.setItem(storageKey, JSON.stringify(fallback));
        return fallback;
    }

    return getDefaultLocations();
}

/**
 * Get POS-eligible selling locations (Counters and Stores)
 */
export async function getPOSLocations(): Promise<InventoryLocation[]> {
    const all = await getInventoryLocations();
    return all.filter((l) => l.is_active && l.allow_pos_sales);
}

/**
 * Get Warehouses and Vaults
 */
export async function getWarehouseLocations(): Promise<InventoryLocation[]> {
    const all = await getInventoryLocations();
    return all.filter((l) => l.is_active && (l.type === "warehouse" || l.type === "vault"));
}

/**
 * Create or save a new location
 */
export async function saveInventoryLocation(loc: Partial<InventoryLocation>): Promise<InventoryLocation> {
    ensureAuth();
    const userEmail = getCurrentTenantEmail();
    const storageKey = getLocationsStorageKey();
    const id = loc.id || `loc_${generateId()}`;
    const fullLoc: InventoryLocation = {
        id,
        code: loc.code?.toUpperCase() || `LOC-${Date.now().toString(36).toUpperCase()}`,
        name: loc.name || "Unnamed Facility",
        type: loc.type || "warehouse",
        address: loc.address || "",
        city: loc.city || "",
        state: loc.state || "",
        pincode: loc.pincode || "",
        contact_phone: loc.contact_phone || "",
        gstin: loc.gstin || "",
        is_active: loc.is_active ?? true,
        is_default: loc.is_default ?? false,
        allow_pos_sales: loc.allow_pos_sales ?? (loc.type === "pos_store"),
        color: loc.color || (loc.type === "pos_store" ? "emerald" : "blue"),
        account_email: userEmail,
        updated: new Date().toISOString(),
    };

    // Try PocketBase
    try {
        if (loc.id) {
            await pb.collection("inventory_locations").update(id, fullLoc);
        } else {
            await pb.collection("inventory_locations").create(fullLoc);
        }
    } catch {
        // Fallback local persistence
    }

    if (typeof window !== "undefined") {
        const existing = await getInventoryLocations();
        const updated = existing.filter((l) => l.id !== id);
        updated.push(fullLoc);
        localStorage.setItem(storageKey, JSON.stringify(updated));
    }

    return fullLoc;
}

// ============================================
// PER-LOCATION STOCK MANAGEMENT
// ============================================

export type LocationStockMap = Record<string, Record<string, number>>; // { [variantOrProductId]: { [locationId]: quantity } }

function getLocalStockMap(): LocationStockMap {
    if (typeof window !== "undefined") {
        const raw = localStorage.getItem(getProductLocStockKey());
        if (raw) {
            try {
                return JSON.parse(raw);
            } catch {}
        }
    }
    return {};
}

function saveLocalStockMap(map: LocationStockMap) {
    if (typeof window !== "undefined") {
        localStorage.setItem(getProductLocStockKey(), JSON.stringify(map));
    }
}

/**
 * Get breakdown of stock levels across all locations for a product or variant.
 * If no breakdown has been logged yet, falls back smoothly to attributing total globalStock
 * to the default Central Warehouse, ensuring existing inventory is 100% preserved.
 */
export async function getProductLocationStockBreakdown(
    itemId: string,
    globalStock: number = 0
): Promise<LocationStock[]> {
    const locations = await getInventoryLocations();
    const stockMap = getLocalStockMap();
    const itemStocks = stockMap[itemId] || {};

    const hasAnyStockRecorded = Object.keys(itemStocks).length > 0;

    return locations.map((loc) => {
        let qty = 0;
        if (hasAnyStockRecorded) {
            qty = Number(itemStocks[loc.id] || 0);
        } else if (loc.is_default) {
            // Default initial migration: assign existing global stock to default counter/location
            qty = globalStock;
        }

        return {
            location_id: loc.id,
            location_name: loc.name,
            location_code: loc.code,
            location_type: loc.type,
            quantity: qty,
            reserved_quantity: 0,
            available_quantity: qty,
        };
    });
}

/**
 * Get available stock at a specific location
 */
export async function getLocationStock(
    itemId: string,
    locationId: string,
    globalStock: number = 0
): Promise<number> {
    const breakdown = await getProductLocationStockBreakdown(itemId, globalStock);
    const match = breakdown.find((b) => b.location_id === locationId);
    return match ? match.quantity : 0;
}

/**
 * Adjust stock at a specific location (e.g. after POS sale or manual count)
 */
export async function adjustLocationStock(
    itemId: string,
    locationId: string,
    delta: number,
    reason: string = "POS Sale"
): Promise<{ newLocationStock: number; newTotalStock: number }> {
    const stockMap = getLocalStockMap();
    if (!stockMap[itemId]) {
        stockMap[itemId] = {};
    }

    const currentLocQty = Number(stockMap[itemId][locationId] || 0);
    const updatedLocQty = Math.max(0, currentLocQty + delta);
    stockMap[itemId][locationId] = updatedLocQty;
    saveLocalStockMap(stockMap);

    // Compute new total across all locations
    const newTotalStock = Object.values(stockMap[itemId]).reduce((sum, q) => sum + Number(q || 0), 0);

    // Audit log to activity_logs if possible
    try {
        await pb.collection("activity_logs").create({
            action: delta < 0 ? "STOCK_DEDUCT_LOCATION" : "STOCK_ADD_LOCATION",
            entity_type: "inventory_location_stock",
            entity_id: itemId,
            description: `${reason}: ${delta > 0 ? "+" : ""}${delta} units at location ${locationId}. Balance: ${updatedLocQty}`,
            metadata: JSON.stringify({ itemId, locationId, delta, balance: updatedLocQty }),
        }).catch(() => {});
    } catch {}

    return {
        newLocationStock: updatedLocQty,
        newTotalStock,
    };
}

// ============================================
// INTER-LOCATION STOCK TRANSFERS
// ============================================

export async function getStockTransfers(): Promise<StockTransfer[]> {
    ensureAuth();
    const userEmail = getCurrentTenantEmail();
    const storageKey = getTransfersStorageKey();

    try {
        const records = await pb.collection("inventory_transfers").getFullList<StockTransfer>({
            filter: `account_email = "${userEmail}"`,
            sort: "-created",
        });
        if (records && records.length > 0) {
            if (typeof window !== "undefined") {
                localStorage.setItem(storageKey, JSON.stringify(records));
            }
            return records;
        }
    } catch {}

    if (typeof window !== "undefined") {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
            try {
                return JSON.parse(raw);
            } catch {}
        }
    }
    return [];
}

/**
 * Create a new Inter-Location Stock Transfer Order
 */
export async function createStockTransfer(params: {
    sourceLocationId: string;
    destinationLocationId: string;
    items: {
        productId: string;
        variantId: string;
        sku: string;
        name: string;
        quantity: number;
        unitCost?: number;
        barcode?: string;
    }[];
    notes?: string;
    carrier?: string;
    trackingAwb?: string;
    generateChallan?: boolean;
}): Promise<StockTransfer> {
    const locations = await getInventoryLocations();
    const source = locations.find((l) => l.id === params.sourceLocationId);
    const dest = locations.find((l) => l.id === params.destinationLocationId);

    if (!source || !dest) {
        throw new Error("Invalid source or destination location");
    }
    if (params.sourceLocationId === params.destinationLocationId) {
        throw new Error("Source and destination locations cannot be the same");
    }
    if (!params.items || params.items.length === 0) {
        throw new Error("Transfer must include at least one item");
    }

    const now = new Date();
    const userEmail = getCurrentTenantEmail();
    const storageKey = getTransfersStorageKey();
    const transferSeq = `TRF-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;

    const transferItems: StockTransferItem[] = params.items.map((it) => ({
        product_id: it.productId,
        variant_id: it.variantId,
        sku: it.sku,
        name: it.name,
        requested_quantity: it.quantity,
        dispatched_quantity: it.quantity,
        received_quantity: 0,
        unit_cost: it.unitCost || 0,
        barcode: it.barcode || "",
    }));

    const transfer: StockTransfer = {
        id: `trf_${generateId()}`,
        transfer_number: transferSeq,
        source_location_id: source.id,
        source_location_name: source.name,
        destination_location_id: dest.id,
        destination_location_name: dest.name,
        status: "dispatched",
        items: transferItems,
        carrier: params.carrier || "Internal Store Courier",
        tracking_awb: params.trackingAwb || "",
        notes: params.notes || `Replenishment from ${source.name} to ${dest.name}`,
        dispatched_by: pb.authStore.model?.email || "Store Admin",
        dispatched_at: now.toISOString(),
        account_email: userEmail,
        created: now.toISOString(),
        updated: now.toISOString(),
    };

    // 1. Deduct stock from source location
    for (const item of transferItems) {
        const idToDeduct = item.variant_id || item.product_id;
        await adjustLocationStock(
            idToDeduct,
            source.id,
            -item.dispatched_quantity,
            `Stock Transfer Out [${transferSeq}] to ${dest.name}`
        );
    }

    // 2. Persist transfer
    try {
        await pb.collection("inventory_transfers").create(transfer);
    } catch {}

    if (typeof window !== "undefined") {
        const existing = await getStockTransfers();
        existing.unshift(transfer);
        localStorage.setItem(storageKey, JSON.stringify(existing));
    }

    return transfer;
}

/**
 * Receive items at destination location and reconcile stock
 */
export async function receiveStockTransfer(
    transferId: string,
    receivedItems?: { variantId: string; quantity: number }[]
): Promise<StockTransfer> {
    const transfers = await getStockTransfers();
    const storageKey = getTransfersStorageKey();
    const transfer = transfers.find((t) => t.id === transferId);

    if (!transfer) {
        throw new Error("Transfer order not found");
    }
    if (transfer.status === "received") {
        throw new Error("Transfer has already been fully received");
    }

    const now = new Date().toISOString();

    // Reconcile and add stock to destination location
    for (const item of transfer.items) {
        const receivedQty = receivedItems
            ? receivedItems.find((r) => r.variantId === item.variant_id)?.quantity ?? item.dispatched_quantity
            : item.dispatched_quantity;

        item.received_quantity = receivedQty;

        const idToAdd = item.variant_id || item.product_id;
        await adjustLocationStock(
            idToAdd,
            transfer.destination_location_id,
            receivedQty,
            `Stock Transfer In [${transfer.transfer_number}] from ${transfer.source_location_name}`
        );
    }

    transfer.status = "received";
    transfer.received_by = pb.authStore.model?.email || "Store Manager";
    transfer.received_at = now;
    transfer.updated = now;

    try {
        await pb.collection("inventory_transfers").update(transfer.id, {
            status: "received",
            received_by: transfer.received_by,
            received_at: now,
            items: transfer.items,
        });
    } catch {}

    if (typeof window !== "undefined") {
        localStorage.setItem(storageKey, JSON.stringify(transfers));
    }

    return transfer;
}
