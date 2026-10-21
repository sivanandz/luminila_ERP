/**
 * WhatsApp Stealth Event-Driven Catalog Sync Engine
 * Continuously synchronizes PocketBase inventory (add, edit, hide/unhide, delete)
 * with the phone's WhatsApp Business App catalog via the WPPConnect sidecar's
 * manual catalog edit/create/delete methods — bypassing Meta Graph API automation
 * while enforcing human-like pacing and anti-bot-detection guards.
 */

import { pb, ensureAuth, getCurrentTenantEmail, sanitizeFilter } from './pocketbase';
import { Product, ProductVariant } from '../types/database';
import { getChannelPrice } from './channel-pricing';
import { resolveProductCatalogImage } from './whatsapp-catalog';
import {
    getSessionStatus,
    createCatalogProduct,
    editCatalogProduct,
    deleteCatalogProduct,
    getCatalogProducts,
    getTenantWhatsAppSessionId,
    whatsappManager,
    CatalogProduct,
} from './whatsapp';
import { toast } from 'sonner';

// ============================================================================
// ANTI-BOT-DETECTION CONSTANTS & QUOTAS
// ============================================================================

const AUTO_SYNC_STORAGE_KEY = 'whatsapp_catalog_auto_sync';
const SETTLE_MIN_MS = 4500;
const SETTLE_MAX_MS = 8500;
const INTER_MUTATION_MIN_MS = 9000;
const INTER_MUTATION_MAX_MS = 22000;
const PRE_ACTION_READ_MIN_MS = 1200;
const PRE_ACTION_READ_MAX_MS = 2800;
const RECONCILE_MIN_MS = 6 * 60 * 1000;  // 6 minutes
const RECONCILE_MAX_MS = 10 * 60 * 1000; // 10 minutes
const MAX_MUTATIONS_PER_10_MIN = 10;
const MAX_MUTATIONS_PER_HOUR = 40;
const SELF_UPDATE_SUPPRESS_MS = 6000;

export type CatalogSyncAction = 'create' | 'update' | 'delete';

export interface QueuedCatalogTask {
    productId: string;
    action: CatalogSyncAction;
    sku?: string;
    name?: string;
    whatsappCatalogId?: string;
    queuedAt: number;
    attempts: number;
}

export interface StealthSyncTelemetry {
    enabled: boolean;
    workerState: 'idle' | 'settling' | 'inspecting' | 'mutating' | 'pacing' | 'rate_limited' | 'backoff';
    queueSize: number;
    currentProductName?: string;
    nextRunAt?: number;
    mutationsLast10Min: number;
    mutationsLastHour: number;
    lastSyncedProductName?: string;
    lastSyncedAt?: string;
    lastError?: string | null;
}

interface StoredCatalogIdentity {
    whatsappCatalogId?: string;
    sku?: string;
    name?: string;
    fingerprint?: string;
    imageSignature?: string;
}

// ============================================================================
// RUNTIME STATE
// ============================================================================

const pendingSettleTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; action: CatalogSyncAction }>();
const selfUpdateSuppression = new Map<string, number>();
const taskQueue: QueuedCatalogTask[] = [];

let isWorkerRunning = false;
let workerTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;

let isSubscribed = false;
let unsubscribeProducts: (() => void) | null = null;
let unsubscribeVariants: (() => void) | null = null;

let currentTelemetry: StealthSyncTelemetry = {
    enabled: true,
    workerState: 'idle',
    queueSize: 0,
    mutationsLast10Min: 0,
    mutationsLastHour: 0,
    lastError: null,
};

// ============================================================================
// TENANT-SCOPED STORAGE HELPERS
// ============================================================================

function getTenantStorageSuffix(): string {
    const email = getCurrentTenantEmail();
    return email ? `_${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : '_default';
}

function getIdentityMapKey(): string {
    return `whatsapp_catalog_id_map${getTenantStorageSuffix()}`;
}

function getMutationHistoryKey(): string {
    return `whatsapp_stealth_mutations${getTenantStorageSuffix()}`;
}

function getPersistedQueueKey(): string {
    return `whatsapp_stealth_queue${getTenantStorageSuffix()}`;
}

function loadIdentityMap(): Record<string, StoredCatalogIdentity> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(getIdentityMapKey());
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveIdentityRecord(productId: string, record: StoredCatalogIdentity): void {
    if (typeof window === 'undefined' || !productId) return;
    try {
        const map = loadIdentityMap();
        map[productId] = { ...(map[productId] || {}), ...record };
        localStorage.setItem(getIdentityMapKey(), JSON.stringify(map));
    } catch {
        // Ignore storage quota errors
    }
}

function removeIdentityRecord(productId: string): void {
    if (typeof window === 'undefined' || !productId) return;
    try {
        const map = loadIdentityMap();
        delete map[productId];
        localStorage.setItem(getIdentityMapKey(), JSON.stringify(map));
    } catch {
        // Ignore
    }
}

function loadMutationTimestamps(): number[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(getMutationHistoryKey());
        const parsed: number[] = raw ? JSON.parse(raw) : [];
        const cutoff = Date.now() - 60 * 60 * 1000;
        return parsed.filter((ts) => typeof ts === 'number' && ts > cutoff);
    } catch {
        return [];
    }
}

function recordMutationTimestamp(): void {
    if (typeof window === 'undefined') return;
    try {
        const list = loadMutationTimestamps();
        list.push(Date.now());
        localStorage.setItem(getMutationHistoryKey(), JSON.stringify(list));
    } catch {
        // Ignore
    }
}

function persistQueue(): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(getPersistedQueueKey(), JSON.stringify(taskQueue));
    } catch {
        // Ignore
    }
}

function restorePersistedQueue(): void {
    if (typeof window === 'undefined') return;
    try {
        const raw = localStorage.getItem(getPersistedQueueKey());
        if (!raw) return;
        const saved: QueuedCatalogTask[] = JSON.parse(raw);
        if (Array.isArray(saved)) {
            for (const item of saved) {
                if (item?.productId && !taskQueue.some((q) => q.productId === item.productId)) {
                    taskQueue.push({ ...item, attempts: 0 });
                }
            }
        }
    } catch {
        // Ignore
    }
}

// ============================================================================
// HUMAN JITTER & FINGERPRINT HELPERS
// ============================================================================

/**
 * Triangular-distributed random integer between [minMs, maxMs].
 * Clusters around the center like natural human interaction times.
 */
function humanDelayMs(minMs: number, maxMs: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const triangular = (u1 + u2) / 2;
    const microNoise = (Math.random() - 0.5) * 400;
    return Math.max(minMs, Math.round(minMs + triangular * (maxMs - minMs) + microNoise));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildProductDescription(product: { description?: string; category?: string; sku: string }): string {
    const base = (product.description || product.category || 'Jewelry').trim();
    if (base.includes(`SKU: ${product.sku}`)) {
        return base;
    }
    return `${base}\n\nSKU: ${product.sku}\nLuminila Jewels`;
}

function computeCatalogFingerprint(params: {
    name: string;
    price: number;
    description: string;
    isHidden: boolean;
    sku: string;
}): string {
    return [
        params.name.trim(),
        Math.round(Number(params.price) || 0),
        params.description.trim(),
        params.isHidden ? 'hidden' : 'visible',
        (params.sku || '').trim().toUpperCase(),
    ].join('||');
}

function computeImageSignature(img?: string | null): string {
    if (!img) return '';
    const trimmed = img.trim();
    return `${trimmed.length}:${trimmed.slice(0, 48)}:${trimmed.slice(-48)}`;
}

function emitTelemetry(patch?: Partial<StealthSyncTelemetry>): void {
    const timestamps = loadMutationTimestamps();
    const tenMinCutoff = Date.now() - 10 * 60 * 1000;
    currentTelemetry = {
        ...currentTelemetry,
        ...patch,
        enabled: isAutoSyncEnabled(),
        queueSize: taskQueue.length + pendingSettleTimers.size,
        mutationsLast10Min: timestamps.filter((t) => t > tenMinCutoff).length,
        mutationsLastHour: timestamps.length,
    };
    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('whatsapp:stealth-sync-status', {
                detail: currentTelemetry,
            })
        );
    }
}

export function getStealthSyncStatus(): StealthSyncTelemetry {
    const timestamps = loadMutationTimestamps();
    const tenMinCutoff = Date.now() - 10 * 60 * 1000;
    return {
        ...currentTelemetry,
        enabled: isAutoSyncEnabled(),
        queueSize: taskQueue.length + pendingSettleTimers.size,
        mutationsLast10Min: timestamps.filter((t) => t > tenMinCutoff).length,
        mutationsLastHour: timestamps.length,
    };
}

// ============================================================================
// PREFERENCES & PUBLIC QUEUE API
// ============================================================================

export function isAutoSyncEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    const val = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
    return val === null ? true : val === 'true';
}

export function setAutoSyncEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(AUTO_SYNC_STORAGE_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(
        new CustomEvent('whatsapp:auto-sync-status', {
            detail: { enabled },
        })
    );
    emitTelemetry({ enabled, workerState: enabled ? currentTelemetry.workerState : 'idle' });
    if (enabled && taskQueue.length > 0) {
        scheduleNextWorkerTick(humanDelayMs(1500, 3500));
    }
}

function markSelfProductUpdate(productId: string): void {
    selfUpdateSuppression.set(productId, Date.now() + SELF_UPDATE_SUPPRESS_MS);
}

function isSuppressedSelfUpdate(productId: string): boolean {
    const until = selfUpdateSuppression.get(productId);
    if (!until) return false;
    if (Date.now() < until) return true;
    selfUpdateSuppression.delete(productId);
    return false;
}

/**
 * Queue a product for human-paced stealth catalog sync
 */
export function queueProductCatalogSync(
    productId: string,
    action: CatalogSyncAction = 'update',
    metadata?: { sku?: string; name?: string; whatsappCatalogId?: string }
): void {
    if (!isAutoSyncEnabled()) return;
    if (!productId) return;

    if (action !== 'delete' && isSuppressedSelfUpdate(productId)) {
        return;
    }

    if (metadata && (metadata.whatsappCatalogId || metadata.sku || metadata.name)) {
        saveIdentityRecord(productId, {
            whatsappCatalogId: metadata.whatsappCatalogId,
            sku: metadata.sku,
            name: metadata.name,
        });
    }

    const existingSettle = pendingSettleTimers.get(productId);
    if (existingSettle) {
        clearTimeout(existingSettle.timer);
    }

    // Coalesce action priority: delete overrides create/update
    const mergedAction: CatalogSyncAction =
        action === 'delete'
            ? 'delete'
            : existingSettle?.action === 'create'
                ? 'create'
                : action;

    const settleMs = humanDelayMs(SETTLE_MIN_MS, SETTLE_MAX_MS);
    emitTelemetry({ workerState: isWorkerRunning ? currentTelemetry.workerState : 'settling' });

    const timer = setTimeout(() => {
        pendingSettleTimers.delete(productId);
        enqueueSettledTask({
            productId,
            action: mergedAction,
            sku: metadata?.sku,
            name: metadata?.name,
            whatsappCatalogId: metadata?.whatsappCatalogId,
            queuedAt: Date.now(),
            attempts: 0,
        });
    }, settleMs);

    pendingSettleTimers.set(productId, { timer, action: mergedAction });
}

function enqueueSettledTask(task: QueuedCatalogTask): void {
    const existingIdx = taskQueue.findIndex((t) => t.productId === task.productId);
    if (existingIdx >= 0) {
        const prev = taskQueue[existingIdx];
        taskQueue[existingIdx] = {
            ...prev,
            ...task,
            action: task.action === 'delete' ? 'delete' : prev.action === 'create' ? 'create' : task.action,
        };
    } else {
        taskQueue.push(task);
    }
    persistQueue();
    emitTelemetry();

    if (!isWorkerRunning && !workerTimer) {
        scheduleNextWorkerTick(humanDelayMs(1500, 4000));
    }
}

function scheduleNextWorkerTick(delayMs: number, state: StealthSyncTelemetry['workerState'] = 'pacing'): void {
    if (workerTimer) {
        clearTimeout(workerTimer);
    }
    const nextRunAt = Date.now() + delayMs;
    emitTelemetry({ workerState: taskQueue.length > 0 ? state : 'idle', nextRunAt: taskQueue.length > 0 ? nextRunAt : undefined });

    workerTimer = setTimeout(() => {
        workerTimer = null;
        void processNextCatalogTask();
    }, delayMs);
}

/**
 * Check if rate-limit sliding window allows a mutation right now.
 * Returns 0 if allowed, or milliseconds to wait until window frees up.
 */
function getRateLimitWaitMs(): number {
    const timestamps = loadMutationTimestamps();
    const now = Date.now();
    const tenMinCutoff = now - 10 * 60 * 1000;
    const recent10Min = timestamps.filter((t) => t > tenMinCutoff);

    if (recent10Min.length >= MAX_MUTATIONS_PER_10_MIN) {
        const oldestIn10Min = Math.min(...recent10Min);
        return Math.max(5000, oldestIn10Min + 10 * 60 * 1000 - now + humanDelayMs(2000, 6000));
    }

    if (timestamps.length >= MAX_MUTATIONS_PER_HOUR) {
        const oldestInHour = Math.min(...timestamps);
        return Math.max(10000, oldestInHour + 60 * 60 * 1000 - now + humanDelayMs(3000, 8000));
    }

    return 0;
}

async function processNextCatalogTask(): Promise<void> {
    if (isWorkerRunning) return;
    if (!isAutoSyncEnabled() || taskQueue.length === 0) {
        emitTelemetry({ workerState: 'idle', currentProductName: undefined, nextRunAt: undefined });
        return;
    }

    const rateWait = getRateLimitWaitMs();
    if (rateWait > 0) {
        console.log(`[wa-stealth-sync] Anti-bot rate limit guard active; waiting ${Math.round(rateWait / 1000)}s`);
        scheduleNextWorkerTick(rateWait, 'rate_limited');
        return;
    }

    isWorkerRunning = true;
    const task = taskQueue[0];

    try {
        emitTelemetry({
            workerState: 'inspecting',
            currentProductName: task.name || task.sku || task.productId,
            nextRunAt: undefined,
        });

        const res = await executeProductCatalogSync(task.productId, task.action, true, task);

        if (res.skipped) {
            // No actual mutation was sent over WhatsApp Web; pop task and advance quickly
            taskQueue.shift();
            persistQueue();
            consecutiveFailures = 0;
            isWorkerRunning = false;
            if (taskQueue.length > 0) {
                scheduleNextWorkerTick(humanDelayMs(1500, 3500), 'pacing');
            } else {
                emitTelemetry({ workerState: 'idle', currentProductName: undefined, nextRunAt: undefined });
            }
            return;
        }

        if (res.success) {
            recordMutationTimestamp();
            taskQueue.shift();
            persistQueue();
            consecutiveFailures = 0;
            emitTelemetry({
                lastSyncedProductName: res.productName || task.name || task.sku || task.productId,
                lastSyncedAt: new Date().toISOString(),
                lastError: null,
            });
            isWorkerRunning = false;

            if (taskQueue.length > 0) {
                // Human-paced inter-mutation delay (9s - 22s)
                const nextDelay = humanDelayMs(INTER_MUTATION_MIN_MS, INTER_MUTATION_MAX_MS);
                scheduleNextWorkerTick(nextDelay, 'pacing');
            } else {
                emitTelemetry({ workerState: 'idle', currentProductName: undefined, nextRunAt: undefined });
            }
            return;
        }

        // Handle transient failure / sidecar offline with exponential backoff
        consecutiveFailures++;
        task.attempts = (task.attempts || 0) + 1;
        if (task.attempts >= 4) {
            // Drop permanently failing task after 4 attempts so queue never deadlocks
            taskQueue.shift();
        }
        persistQueue();
        isWorkerRunning = false;

        const backoffBase = Math.min(180000, 30000 * Math.pow(2, Math.min(consecutiveFailures - 1, 3)));
        const backoffMs = backoffBase + humanDelayMs(2000, 8000);
        emitTelemetry({ lastError: res.error || 'Sidecar sync deferred' });
        if (taskQueue.length > 0) {
            scheduleNextWorkerTick(backoffMs, 'backoff');
        } else {
            emitTelemetry({ workerState: 'idle', currentProductName: undefined, nextRunAt: undefined });
        }
    } catch (err) {
        isWorkerRunning = false;
        consecutiveFailures++;
        task.attempts = (task.attempts || 0) + 1;
        if (task.attempts >= 4) {
            taskQueue.shift();
        }
        persistQueue();
        const backoffMs = 35000 + humanDelayMs(3000, 9000);
        emitTelemetry({ lastError: err instanceof Error ? err.message : String(err) });
        if (taskQueue.length > 0) {
            scheduleNextWorkerTick(backoffMs, 'backoff');
        } else {
            emitTelemetry({ workerState: 'idle', currentProductName: undefined, nextRunAt: undefined });
        }
    }
}

/**
 * Legacy Meta Catalog Batch helper (retained for optional manual invocation)
 */
export async function syncMetaCatalogBatch(
    productIds?: string[],
    action: 'CREATE' | 'UPDATE' | 'DELETE' = 'UPDATE',
    all = false
): Promise<{ success: boolean; message?: string; total_processed?: number; configured?: boolean }> {
    try {
        ensureAuth();
        const token = pb.authStore.token || '';
        const accountEmail = getCurrentTenantEmail();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/catalog/batch', {
            method: 'POST',
            headers,
            body: JSON.stringify({ productIds, action, all, account_email: accountEmail }),
        });
        const data = await res.json();
        return data;
    } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Execute a single product catalog sync via the WPPConnect sidecar using manual edit/create/delete methods.
 */
export async function executeProductCatalogSync(
    productId: string,
    action: string = 'update',
    showNotification = true,
    queuedMeta?: Partial<QueuedCatalogTask>
): Promise<{ success: boolean; skipped?: boolean; productName?: string; error?: string }> {
    try {
        const tenantEmail = getCurrentTenantEmail();
        const sessionId =
            getTenantWhatsAppSessionId(tenantEmail) ||
            whatsappManager.getSessionIdSafe() ||
            'luminila';

        // 1. Verify the tenant's WhatsApp sidecar session is actively CONNECTED
        const sessionStatus = await getSessionStatus(sessionId);
        if (sessionStatus !== 'CONNECTED') {
            return {
                success: false,
                error: `WhatsApp session "${sessionId}" is ${sessionStatus.toLowerCase()}`,
            };
        }

        const identityMap = loadIdentityMap();
        const cachedIdentity = identityMap[productId];

        // 2. Fetch the target product from PocketBase
        type SyncProductRecord = Product & {
            whatsapp_catalog_id?: string;
            whatsapp_last_synced?: string;
            image_data?: string;
            account_email?: string;
        };

        let product: SyncProductRecord | null = null;
        if (action !== 'delete') {
            try {
                const fetched = await pb.collection('products').getOne<SyncProductRecord>(productId);
                // Dual-layer tenant isolation guard
                if (
                    tenantEmail &&
                    fetched.account_email &&
                    fetched.account_email.toLowerCase() !== tenantEmail.toLowerCase()
                ) {
                    return { success: true, skipped: true };
                }
                product = fetched;
            } catch {
                product = null;
            }
        }

        // 3. Handle product deletion (when action === 'delete' or record was deleted from PocketBase)
        if (action === 'delete' || !product) {
            let waCatalogIdToDelete =
                queuedMeta?.whatsappCatalogId || cachedIdentity?.whatsappCatalogId;
            const targetSku = queuedMeta?.sku || cachedIdentity?.sku;
            const targetName = queuedMeta?.name || cachedIdentity?.name || 'Removed Item';

            if (!waCatalogIdToDelete && targetSku) {
                const liveCatalog = await getCatalogProducts(sessionId);
                const matched = liveCatalog.find(
                    (p) => p.retailerId && p.retailerId.toLowerCase() === targetSku.toLowerCase()
                );
                if (matched?.id) {
                    waCatalogIdToDelete = String(matched.id);
                }
            }

            if (!waCatalogIdToDelete) {
                removeIdentityRecord(productId);
                return { success: true, skipped: true };
            }

            // Human pre-action pause
            await sleep(humanDelayMs(PRE_ACTION_READ_MIN_MS, PRE_ACTION_READ_MAX_MS));
            emitTelemetry({ workerState: 'mutating', currentProductName: targetName });

            const deletedOk = await deleteCatalogProduct(sessionId, waCatalogIdToDelete);
            if (deletedOk) {
                removeIdentityRecord(productId);
                if (showNotification) {
                    toast.success(`Removed from WhatsApp Catalog: ${targetName}`);
                }
                return { success: true, productName: targetName };
            }
            return { success: false, error: 'Sidecar failed to delete product from WhatsApp catalog' };
        }

        // 4. Fetch product variants to compute real-time stock level
        let totalStock = 1;
        let hasVariants = false;
        try {
            const variants = await pb.collection('product_variants').getFullList<ProductVariant & { account_email?: string }>({
                filter: `product = "${sanitizeFilter(productId)}"`,
            });
            const validVariants = tenantEmail
                ? variants.filter((v) => !v.account_email || v.account_email.toLowerCase() === tenantEmail.toLowerCase())
                : variants;
            if (validVariants.length > 0) {
                hasVariants = true;
                totalStock = validVariants.reduce((sum, v) => sum + (v.stock_level || 0), 0);
            }
        } catch (variantErr) {
            console.warn('[wa-stealth-sync] Failed to fetch variants:', variantErr);
        }

        // 5. Compute target WhatsApp catalog state
        const targetPrice = getChannelPrice(product, 'whatsapp');
        const isHidden = !product.is_active || (hasVariants && totalStock <= 0);
        const formattedDescription = buildProductDescription(product);
        const productUrl = `https://luminila.com/product/${product.sku}`;
        const resolvedImage = resolveProductCatalogImage(product);
        const imageSignature = computeImageSignature(product.image_data || product.image_url);
        const targetFingerprint = computeCatalogFingerprint({
            name: product.name,
            price: targetPrice,
            description: formattedDescription,
            isHidden,
            sku: product.sku,
        });

        // 6. Inspect live WhatsApp catalog to resolve existing item and check for no-op diff
        const liveCatalog = await getCatalogProducts(sessionId);
        let waCatalogId = product.whatsapp_catalog_id || cachedIdentity?.whatsappCatalogId;
        let matchedLiveItem: CatalogProduct | undefined;

        if (waCatalogId) {
            matchedLiveItem = liveCatalog.find((p) => String(p.id) === String(waCatalogId));
        }
        if (!matchedLiveItem && product.sku) {
            matchedLiveItem = liveCatalog.find(
                (p) => p.retailerId && p.retailerId.toLowerCase() === product!.sku.toLowerCase()
            );
            if (matchedLiveItem) {
                waCatalogId = String(matchedLiveItem.id);
            }
        }

        if (matchedLiveItem && waCatalogId) {
            const livePrice = Number(matchedLiveItem.price) || 0;
            const liveHidden = Boolean(matchedLiveItem.isHidden);
            const liveName = (matchedLiveItem.name || '').trim();
            const liveDesc = (matchedLiveItem.description || '').trim();
            const imageChanged =
                Boolean(cachedIdentity?.imageSignature) &&
                cachedIdentity?.imageSignature !== imageSignature;

            const isAlreadyInSync =
                liveName === product.name.trim() &&
                Math.abs(livePrice - targetPrice) < 1 &&
                liveHidden === isHidden &&
                liveDesc === formattedDescription &&
                !imageChanged;

            if (isAlreadyInSync) {
                saveIdentityRecord(product.id, {
                    whatsappCatalogId: waCatalogId,
                    sku: product.sku,
                    name: product.name,
                    fingerprint: targetFingerprint,
                    imageSignature,
                });
                if (!product.whatsapp_catalog_id) {
                    markSelfProductUpdate(product.id);
                    await pb.collection('products').update(product.id, {
                        whatsapp_catalog_id: waCatalogId,
                        whatsapp_last_synced: new Date().toISOString(),
                    }).catch(() => {});
                }
                return { success: true, skipped: true, productName: product.name };
            }

            // Human pre-action reading pause before sending editProduct
            await sleep(humanDelayMs(PRE_ACTION_READ_MIN_MS, PRE_ACTION_READ_MAX_MS));
            emitTelemetry({ workerState: 'mutating', currentProductName: product.name });

            const editRes = await editCatalogProduct(sessionId, waCatalogId, {
                name: product.name,
                price: targetPrice,
                currency: 'INR',
                description: formattedDescription,
                url: productUrl,
                retailerId: product.sku,
                isHidden,
                ...(imageChanged && resolvedImage ? { image: resolvedImage } : {}),
            });

            if (editRes.success) {
                saveIdentityRecord(product.id, {
                    whatsappCatalogId: waCatalogId,
                    sku: product.sku,
                    name: product.name,
                    fingerprint: targetFingerprint,
                    imageSignature,
                });
                markSelfProductUpdate(product.id);
                await pb.collection('products').update(product.id, {
                    whatsapp_catalog_id: waCatalogId,
                    whatsapp_last_synced: new Date().toISOString(),
                }).catch(() => {});

                if (showNotification) {
                    toast.success(`WhatsApp Catalog Updated: ${product.name}`, {
                        description: `₹${targetPrice.toLocaleString('en-IN')} • ${isHidden ? 'Hidden (Out of Stock / Inactive)' : `Active (${totalStock} in stock)`}`,
                    });
                }
                return { success: true, productName: product.name };
            }

            return { success: false, error: editRes.error || 'Failed to edit WhatsApp catalog item' };
        }

        // 7. Product is not in live WhatsApp catalog yet: skip creation if hidden/inactive/out-of-stock
        if (isHidden) {
            return { success: true, skipped: true, productName: product.name };
        }

        // Human pre-action pause before creating product
        await sleep(humanDelayMs(PRE_ACTION_READ_MIN_MS, PRE_ACTION_READ_MAX_MS));
        emitTelemetry({ workerState: 'mutating', currentProductName: product.name });

        const createRes = await createCatalogProduct(sessionId, {
            name: product.name,
            price: targetPrice,
            description: formattedDescription,
            currency: 'INR',
            retailerId: product.sku,
            image: resolvedImage,
            url: productUrl,
            isHidden: false,
        });

        if (createRes.success && createRes.productId) {
            saveIdentityRecord(product.id, {
                whatsappCatalogId: createRes.productId,
                sku: product.sku,
                name: product.name,
                fingerprint: targetFingerprint,
                imageSignature,
            });
            markSelfProductUpdate(product.id);
            await pb.collection('products').update(product.id, {
                whatsapp_catalog_id: createRes.productId,
                whatsapp_last_synced: new Date().toISOString(),
            }).catch(() => {});

            if (showNotification) {
                toast.success(`Added to WhatsApp Catalog: ${product.name}`, {
                    description: `Published at ₹${targetPrice.toLocaleString('en-IN')}`,
                });
            }
            return { success: true, productName: product.name };
        }

        return { success: false, error: createRes.error || 'Could not create WhatsApp catalog product' };
    } catch (err) {
        console.error('[wa-stealth-sync] Unexpected error during sync:', err);
        return { success: false, error: (err as Error)?.message || String(err) };
    }
}

/**
 * Periodic Background Drift Reconciler:
 * Compares PocketBase inventory against live WhatsApp Business App catalog
 * and enqueues any missing, price/status-drifted, or removed items into the stealth queue.
 */
export async function triggerStealthCatalogReconcile(): Promise<{ queued: number }> {
    if (!isAutoSyncEnabled()) return { queued: 0 };

    try {
        const tenantEmail = getCurrentTenantEmail();
        const sessionId =
            getTenantWhatsAppSessionId(tenantEmail) ||
            whatsappManager.getSessionIdSafe() ||
            'luminila';

        const status = await getSessionStatus(sessionId);
        if (status !== 'CONNECTED') return { queued: 0 };

        type ReconcileProduct = Product & {
            whatsapp_catalog_id?: string;
            image_data?: string;
            account_email?: string;
        };

        const filterStr = tenantEmail
            ? `account_email = "${sanitizeFilter(tenantEmail)}"`
            : undefined;

        const [rawProducts, rawVariants, liveCatalog] = await Promise.all([
            pb.collection('products').getFullList<ReconcileProduct>({
                filter: filterStr,
                sort: '-updated',
            }),
            pb.collection('product_variants').getFullList<ProductVariant & { account_email?: string }>({
                filter: filterStr,
            }).catch(() => [] as (ProductVariant & { account_email?: string })[]),
            getCatalogProducts(sessionId),
        ]);

        const products = tenantEmail
            ? rawProducts.filter((p) => !p.account_email || p.account_email.toLowerCase() === tenantEmail.toLowerCase())
            : rawProducts;

        const stockByProduct = new Map<string, { count: number; total: number }>();
        for (const v of rawVariants) {
            if (!v.product) continue;
            if (tenantEmail && v.account_email && v.account_email.toLowerCase() !== tenantEmail.toLowerCase()) continue;
            const prev = stockByProduct.get(v.product) || { count: 0, total: 0 };
            stockByProduct.set(v.product, {
                count: prev.count + 1,
                total: prev.total + (v.stock_level || 0),
            });
        }

        let queuedCount = 0;

        for (const p of products) {
            saveIdentityRecord(p.id, {
                whatsappCatalogId: p.whatsapp_catalog_id,
                sku: p.sku,
                name: p.name,
            });

            const varInfo = stockByProduct.get(p.id);
            const totalStock = varInfo ? varInfo.total : 1;
            const shouldBeHidden = !p.is_active || (varInfo ? totalStock <= 0 : false);
            const targetPrice = getChannelPrice(p, 'whatsapp');

            const matchedLive = liveCatalog.find(
                (w) =>
                    (p.whatsapp_catalog_id && String(w.id) === String(p.whatsapp_catalog_id)) ||
                    (p.sku && w.retailerId && w.retailerId.toLowerCase() === p.sku.toLowerCase())
            );

            if (!matchedLive) {
                if (!shouldBeHidden) {
                    enqueueSettledTask({
                        productId: p.id,
                        action: 'create',
                        sku: p.sku,
                        name: p.name,
                        queuedAt: Date.now(),
                        attempts: 0,
                    });
                    queuedCount++;
                }
            } else {
                const livePrice = Number(matchedLive.price) || 0;
                const liveHidden = Boolean(matchedLive.isHidden);
                const liveName = (matchedLive.name || '').trim();
                if (
                    liveName !== p.name.trim() ||
                    Math.abs(livePrice - targetPrice) >= 1 ||
                    liveHidden !== shouldBeHidden
                ) {
                    enqueueSettledTask({
                        productId: p.id,
                        action: 'update',
                        sku: p.sku,
                        name: p.name,
                        whatsappCatalogId: String(matchedLive.id),
                        queuedAt: Date.now(),
                        attempts: 0,
                    });
                    queuedCount++;
                }
            }
        }

        return { queued: queuedCount };
    } catch (err) {
        console.warn('[wa-stealth-sync] Background drift check skipped:', err);
        return { queued: 0 };
    }
}

function scheduleNextReconcile(initial = false): void {
    if (reconcileTimer) {
        clearTimeout(reconcileTimer);
    }
    const delayMs = initial
        ? humanDelayMs(18000, 32000)
        : humanDelayMs(RECONCILE_MIN_MS, RECONCILE_MAX_MS);

    reconcileTimer = setTimeout(async () => {
        await triggerStealthCatalogReconcile();
        scheduleNextReconcile(false);
    }, delayMs);
}

/**
 * Initialize PocketBase real-time event listeners and background stealth drift reconciler
 */
export function initWhatsAppEventSync(): () => void {
    if (typeof window === 'undefined') {
        return () => {};
    }

    if (isSubscribed) {
        return () => {};
    }

    isSubscribed = true;
    restorePersistedQueue();
    if (taskQueue.length > 0 && isAutoSyncEnabled()) {
        scheduleNextWorkerTick(humanDelayMs(3000, 7000), 'pacing');
    }
    scheduleNextReconcile(true);

    // 1. Subscribe to Product changes (create, edit, deactivate, delete)
    pb.collection('products')
        .subscribe('*', (e) => {
            if (!isAutoSyncEnabled()) return;
            const record = e.record as Product & { whatsapp_catalog_id?: string; account_email?: string };
            if (!record?.id) return;

            const tenantEmail = getCurrentTenantEmail();
            if (
                tenantEmail &&
                record.account_email &&
                record.account_email.toLowerCase() !== tenantEmail.toLowerCase()
            ) {
                return;
            }

            const action = (e.action as CatalogSyncAction) || 'update';
            queueProductCatalogSync(record.id, action, {
                sku: record.sku,
                name: record.name,
                whatsappCatalogId: record.whatsapp_catalog_id,
            });
        })
        .then(() => {
            unsubscribeProducts = () => {
                pb.collection('products').unsubscribe('*').catch(() => {});
            };
        })
        .catch((err) => {
            console.error('[wa-stealth-sync] Failed to subscribe to products:', err);
        });

    // 2. Subscribe to Variant changes (POS stock decrements, stock adjustments)
    pb.collection('product_variants')
        .subscribe('*', (e) => {
            if (!isAutoSyncEnabled()) return;
            const record = e.record as ProductVariant & { account_email?: string };
            if (!record?.product) return;

            const tenantEmail = getCurrentTenantEmail();
            if (
                tenantEmail &&
                record.account_email &&
                record.account_email.toLowerCase() !== tenantEmail.toLowerCase()
            ) {
                return;
            }

            queueProductCatalogSync(record.product, 'update');
        })
        .then(() => {
            unsubscribeVariants = () => {
                pb.collection('product_variants').unsubscribe('*').catch(() => {});
            };
        })
        .catch((err) => {
            console.error('[wa-stealth-sync] Failed to subscribe to product_variants:', err);
        });

    return () => {
        isSubscribed = false;
        if (unsubscribeProducts) unsubscribeProducts();
        if (unsubscribeVariants) unsubscribeVariants();
        if (workerTimer) clearTimeout(workerTimer);
        if (reconcileTimer) clearTimeout(reconcileTimer);
    };
}
