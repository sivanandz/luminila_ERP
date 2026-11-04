/**
 * Batch Label Print Queue Service
 * Allows bulk-selecting products in /inventory, receiving POs, or adding products
 * to queue up barcode labels for printing in /labels.
 *
 * Persisted in tenant-scoped localStorage.
 */

import { getTenantStorageKey } from "./pocketbase";

export interface QueuedLabelItem {
    sku: string;
    name: string;
    price: number;
    quantity: number;
    category?: string;
    hsn_code?: string;
    craft?: string;
    plating?: string;
    occasion?: string;
    base_metal?: string;
}

const getQueueStorageKey = () => getTenantStorageKey("luminila_label_print_queue_v1");

/**
 * Push items into the tenant's label print queue.
 */
export function pushToLabelQueue(items: QueuedLabelItem[]): void {
    if (typeof window === "undefined" || items.length === 0) return;
    const key = getQueueStorageKey();
    const existing = peekLabelQueue();

    const mergedMap = new Map<string, QueuedLabelItem>();
    for (const it of existing) {
        mergedMap.set(it.sku, { ...it });
    }

    for (const it of items) {
        if (!it.sku) continue;
        const current = mergedMap.get(it.sku);
        if (current) {
            current.quantity += Math.max(1, it.quantity);
        } else {
            mergedMap.set(it.sku, {
                ...it,
                quantity: Math.max(1, it.quantity),
            });
        }
    }

    localStorage.setItem(key, JSON.stringify(Array.from(mergedMap.values())));
}

/**
 * View the current label queue without clearing it.
 */
export function peekLabelQueue(): QueuedLabelItem[] {
    if (typeof window === "undefined") return [];
    const key = getQueueStorageKey();
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Read and clear the label queue (atomic handover to /labels).
 */
export function consumeLabelQueue(): QueuedLabelItem[] {
    const items = peekLabelQueue();
    if (typeof window !== "undefined" && items.length > 0) {
        localStorage.removeItem(getQueueStorageKey());
    }
    return items;
}
