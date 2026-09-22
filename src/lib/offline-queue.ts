/**
 * Luminila Offline Transaction Queue
 * Persists pending mutations locally (IndexedDB / localStorage)
 * and automatically drains/replays when connectivity is restored.
 */

import { pb } from './pocketbase';

export interface PendingMutation {
    id: string;
    timestamp: number;
    collection: string;
    action: 'create' | 'update' | 'delete';
    recordId?: string;
    data?: Record<string, any>;
    retries: number;
    error?: string;
}

const STORAGE_KEY = 'luminila_offline_mutations';

export class OfflineQueue {
    private static isFlushing = false;

    /**
     * Get all pending mutations from storage
     */
    static getQueue(): PendingMutation[] {
        if (typeof window === 'undefined') return [];
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
        window.dispatchEvent(new CustomEvent('offline-queue:changed', { detail: { count: queue.length } }));
    }

    /**
     * Enqueue a new mutation
     */
    static enqueue(
        collection: string,
        action: 'create' | 'update' | 'delete',
        data?: Record<string, any>,
        recordId?: string
    ): PendingMutation {
        const queue = this.getQueue();
        const mutation: PendingMutation = {
            id: `mut_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            timestamp: Date.now(),
            collection,
            action,
            recordId,
            data,
            retries: 0,
        };

        queue.push(mutation);
        this.saveQueue(queue);
        return mutation;
    }

    /**
     * Remove a successfully processed mutation
     */
    static remove(mutationId: string) {
        const queue = this.getQueue().filter((m) => m.id !== mutationId);
        this.saveQueue(queue);
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

        for (const mutation of queue) {
            try {
                if (mutation.action === 'create' && mutation.data) {
                    await pb.collection(mutation.collection).create(mutation.data);
                } else if (mutation.action === 'update' && mutation.recordId && mutation.data) {
                    await pb.collection(mutation.collection).update(mutation.recordId, mutation.data);
                } else if (mutation.action === 'delete' && mutation.recordId) {
                    await pb.collection(mutation.collection).delete(mutation.recordId);
                }
                this.remove(mutation.id);
                processed++;
            } catch (err: any) {
                console.warn(`Failed to process mutation ${mutation.id}:`, err);
                mutation.retries++;
                mutation.error = err?.message || 'Replay failed';
                failed++;
                // If network is completely unreachable, stop draining early
                if (err?.status === 0 || err?.name === 'ClientResponseError 0') {
                    break;
                }
            }
        }

        this.isFlushing = false;
        return { processed, failed };
    }

    /**
     * Clear all pending items
     */
    static clear() {
        this.saveQueue([]);
    }
}
