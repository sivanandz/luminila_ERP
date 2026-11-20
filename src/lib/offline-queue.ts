/**
 * Luminila Offline Transaction Queue
 * Persists pending mutations locally (IndexedDB / localStorage)
 * and automatically drains/replays when connectivity is restored.
 */

import { accountScopeEmail, getCurrentTenantEmail, getTenantStorageKey, pb } from './pocketbase';

/** H-41: queued mutations without a tenant would be stranded in `_default`. */
export class OfflineQueueNotAuthenticatedError extends Error {
    constructor() {
        super('Cannot queue offline mutation without a signed-in tenant');
        this.name = 'OfflineQueueNotAuthenticatedError';
    }
}

export interface PendingMutation {
    id: string;
    timestamp: number;
    collection: string;
    action: 'create' | 'update' | 'delete';
    recordId?: string;
    data?: Record<string, unknown>;
    retries: number;
    error?: string;
    /** Tenant that queued the mutation; replay must not cross tenants (P14). */
    accountEmail?: string;
    /** Deterministic record id so a lost-response retry cannot duplicate (P3). */
    clientRecordId?: string;
    deadLetteredAt?: number;
}

const STORAGE_KEY_BASE = 'luminila_offline_mutations';
const DEAD_LETTER_KEY_BASE = 'luminila_offline_dead_letters';
/** Stop replaying a mutation after this many failures (P3). */
const MAX_RETRIES = 5;

/** Tenant-scoped key: one store's pending mutations must never replay into another (POS-10). */
function storageKey(): string {
    return getTenantStorageKey(STORAGE_KEY_BASE);
}

function deadLetterKey(): string {
    return getTenantStorageKey(DEAD_LETTER_KEY_BASE);
}

function hash32(input: string, seed: number): number {
    let hash = seed >>> 0;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
}

/**
 * Stable 15-char PocketBase record id derived from the mutation id. Replaying a
 * create after a dropped response hits a duplicate-id error instead of
 * inserting the record twice; the error is then treated as success.
 */
function clientRecordIdFor(mutationId: string): string {
    const first = hash32(mutationId, 2166136261).toString(36);
    const second = hash32(mutationId, 3339675911).toString(36);
    return `q${`${first}${second}`.padStart(14, '0').slice(0, 14)}`;
}

/** PocketBase reports a client-supplied id clash as a 400 (P3). */
function isDuplicateRecordError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as {
        status?: number;
        message?: string;
        data?: { data?: Record<string, { code?: string }> };
    };
    if (candidate.status !== 400) return false;
    const idError = candidate.data?.data?.id?.code;
    if (idError === 'validation_not_unique' || idError === 'validation_invalid_id') return true;
    return typeof candidate.message === 'string' && /already (in use|exists)/i.test(candidate.message);
}

export class OfflineQueue {
    private static isFlushing = false;

    /**
     * Get all pending mutations from storage
     */
    static getQueue(): PendingMutation[] {
        if (typeof window === 'undefined') return [];
        try {
            const raw = localStorage.getItem(storageKey());
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.error('Failed to parse offline queue:', e);
            return [];
        }
    }

    /**
     * Save queue to storage
     */
    private static saveQueue(queue: PendingMutation[]) {
        if (typeof window === 'undefined') return;
        // D-03: a quota/unavailable-storage failure here used to escape flush()
        // and (a) be misread as a network retry and (b) strand isFlushing.
        // Fail closed: keep the on-disk queue untouched and report distinctly.
        try {
            localStorage.setItem(storageKey(), JSON.stringify(queue));
            window.dispatchEvent(new CustomEvent('offline-queue:changed', { detail: { count: queue.length } }));
        } catch (error) {
            console.error('Failed to persist offline queue (storage full/unavailable):', error);
        }
    }

    /**
     * Enqueue a new mutation
     */
    static enqueue(
        collection: string,
        action: 'create' | 'update' | 'delete',
        data?: Record<string, unknown>,
        recordId?: string
    ): PendingMutation {
        const queue = this.getQueue();
        // H-41: `getCurrentTenantEmail()` falls back to "default" when there is
        // no session, which mints a namespace that is never replayed after login.
        const accountEmail = accountScopeEmail();
        if (!accountEmail) throw new OfflineQueueNotAuthenticatedError();

        // P14: repeated edits to one record collapse into a single replay.
        if (action === 'update' && recordId) {
            const existingIndex = queue.findIndex(
                (mutation) =>
                    mutation.collection === collection &&
                    mutation.action === 'update' &&
                    mutation.recordId === recordId
            );
            if (existingIndex >= 0) {
                const merged: PendingMutation = {
                    ...queue[existingIndex],
                    timestamp: Date.now(),
                    // D-07: a re-edit is a new payload; it must not inherit the
                    // old attempt count or error, or the next failure dead-letters it.
                    retries: 0,
                    error: undefined,
                    data: { ...(queue[existingIndex].data || {}), ...(data || {}) },
                    accountEmail: queue[existingIndex].accountEmail || accountEmail,
                };
                queue[existingIndex] = merged;
                this.saveQueue(queue);
                return merged;
            }
        }

        const id = `mut_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const mutation: PendingMutation = {
            id,
            timestamp: Date.now(),
            collection,
            action,
            recordId,
            // Stamp the tenant at enqueue time: replaying after a different
            // account signs in must not create rows under that account.
            // Create payloads are stamped too; the caller cannot override it.
            data: action === 'create'
                ? { ...(data || {}), account_email: accountEmail || (data?.account_email as string) || '' }
                : data,
            retries: 0,
            accountEmail,
            clientRecordId: action === 'create' ? clientRecordIdFor(id) : undefined,
        };

        queue.push(mutation);
        this.saveQueue(queue);
        return mutation;
    }

    /**
     * H-41: recover mutations stranded in the `_default` namespace by an older
     * build that queued them with no session. Merge by id so a real tenant
     * queue is never lost, and restamp ownership on every recovered row.
     */
    static rekeyDefaultQueue(tenant: string): void {
        if (typeof window === 'undefined' || !tenant) return;
        const pairs: Array<[string, string]> = [
            [`${STORAGE_KEY_BASE}_default`, `${STORAGE_KEY_BASE}_${tenant}`],
            [`${DEAD_LETTER_KEY_BASE}_default`, `${DEAD_LETTER_KEY_BASE}_${tenant}`],
        ];
        for (const [from, to] of pairs) {
            try {
                const raw = localStorage.getItem(from);
                if (!raw) continue;
                const stranded = JSON.parse(raw) as PendingMutation[];
                if (!Array.isArray(stranded) || stranded.length === 0) {
                    localStorage.removeItem(from);
                    continue;
                }
                const targetRaw = localStorage.getItem(to);
                const target: PendingMutation[] = targetRaw ? JSON.parse(targetRaw) : [];
                const seen = new Set(target.map((row) => row.id));
                for (const row of stranded) {
                    if (seen.has(row.id)) continue;
                    target.push({
                        ...row,
                        accountEmail: tenant,
                        data: row.data ? { ...row.data, account_email: tenant } : row.data,
                    });
                    seen.add(row.id);
                }
                localStorage.setItem(to, JSON.stringify(target));
                localStorage.removeItem(from);
            } catch (error) {
                console.error('Could not recover stranded offline queue:', error);
            }
        }
    }

    /**
     * Remove a successfully processed mutation
     */
    static remove(mutationId: string) {
        const queue = this.getQueue().filter((m) => m.id !== mutationId);
        this.saveQueue(queue);
    }

    /**
     * H-42: a concurrent edit merges into a NEW object with the same id and a
     * newer timestamp. Remove only the exact version we actually replayed.
     */
    private static removeIfUnchanged(mutationId: string, seenTimestamp: number): boolean {
        const queue = this.getQueue();
        const row = queue.find((m) => m.id === mutationId);
        if (!row || row.timestamp !== seenTimestamp) return false;
        this.saveQueue(queue.filter((m) => m.id !== mutationId));
        return true;
    }

    /**
     * Persist a single mutation's retry state without rewriting the whole
     * in-memory snapshot. Rewriting the snapshot could resurrect mutations that
     * were already removed earlier in the same flush (P3).
     */
    private static persistMutation(mutation: PendingMutation) {
        const queue = this.getQueue();
        const index = queue.findIndex((m) => m.id === mutation.id);
        // H-42: never overwrite a newer merged edit with the stale in-flight row.
        if (index >= 0 && queue[index].timestamp === mutation.timestamp) {
            queue[index] = mutation;
            this.saveQueue(queue);
        }
    }

    private static deadLetter(mutation: PendingMutation) {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(deadLetterKey());
            const letters: PendingMutation[] = raw ? JSON.parse(raw) : [];
            letters.push({ ...mutation, deadLetteredAt: Date.now() });
            localStorage.setItem(deadLetterKey(), JSON.stringify(letters));
        } catch (error) {
            console.error('Failed to store offline dead letter:', error);
        }
        this.remove(mutation.id);
    }

    /** Mutations that exhausted their retry budget, kept for inspection. */
    static getDeadLetters(): PendingMutation[] {
        if (typeof window === 'undefined') return [];
        try {
            const raw = localStorage.getItem(deadLetterKey());
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    static clearDeadLetters() {
        if (typeof window === 'undefined') return;
        localStorage.removeItem(deadLetterKey());
    }

    /**
     * Flush / drain all pending mutations against PocketBase
     */
    static async flush(): Promise<{ processed: number; failed: number }> {
        if (this.isFlushing || typeof window === 'undefined') {
            return { processed: 0, failed: 0 };
        }

        const queue = this.getQueue();
        if (queue.length === 0) return { processed: 0, failed: 0 };

        this.isFlushing = true;
        let processed = 0;
        let failed = 0;
        const currentTenant = getCurrentTenantEmail();

        // D-03: any throw in the drain must still release the flush lock, or
        // every later "online"/manual drain silently reports success forever.
        try {
        for (const mutation of queue) {
            // P14: never replay one tenant's mutation under another account.
            if (mutation.accountEmail && currentTenant && mutation.accountEmail !== currentTenant) {
                continue;
            }
            // P3: a poison mutation must not retry forever.
            if (mutation.retries >= MAX_RETRIES) {
                this.deadLetter(mutation);
                failed++;
                continue;
            }

            try {
                if (mutation.action === 'create' && mutation.data) {
                    // A deterministic id makes the retry idempotent when the
                    // first attempt actually reached the server (P3).
                    const payload = mutation.clientRecordId
                        ? { ...mutation.data, id: mutation.clientRecordId }
                        : mutation.data;
                    await pb.collection(mutation.collection).create(payload);
                } else if (mutation.action === 'update' && mutation.recordId && mutation.data) {
                    await pb.collection(mutation.collection).update(mutation.recordId, mutation.data);
                } else if (mutation.action === 'delete' && mutation.recordId) {
                    await pb.collection(mutation.collection).delete(mutation.recordId);
                }
                if (!this.removeIfUnchanged(mutation.id, mutation.timestamp)) {
                    // A newer merged edit replaced this row while the replay was
                    // in flight; leave it queued so the merged payload replays.
                    continue;
                }
                processed++;
            } catch (err) {
                // The record was created by the previous, lost-response attempt.
                // Confirm it exists before dropping the mutation, so a collection
                // that refuses client-supplied ids is not silently "deduplicated".
                if (mutation.action === 'create' && mutation.clientRecordId && isDuplicateRecordError(err)) {
                    const existing = await pb
                        .collection(mutation.collection)
                        .getOne(mutation.clientRecordId)
                        .catch(() => null);
                    if (existing) {
                        if (!this.removeIfUnchanged(mutation.id, mutation.timestamp)) continue;
                        processed++;
                        continue;
                    }
                }

                console.warn(`Failed to process mutation ${mutation.id}:`, err);
                mutation.retries++;
                mutation.error = err instanceof Error ? err.message || 'Replay failed' : String(err);
                if (mutation.retries >= MAX_RETRIES) {
                    this.deadLetter(mutation);
                } else {
                    // Persist only this row; saving the local snapshot would
                    // re-add mutations already removed earlier in this pass.
                    this.persistMutation(mutation);
                }
                failed++;
                // If network is completely unreachable, stop draining early
                if (
                    (typeof err === 'object' && err !== null && 'status' in err && err.status === 0) ||
                    (typeof err === 'object' && err !== null && 'name' in err && err.name === 'ClientResponseError 0')
                ) {
                    break;
                }
            }
        }
        } finally {
            this.isFlushing = false;
        }
        return { processed, failed };
    }

    /**
     * Clear all pending items
     */
    static clear() {
        this.saveQueue([]);
    }
}
