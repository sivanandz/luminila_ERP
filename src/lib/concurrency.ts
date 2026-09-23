/**
 * Generic In-Process Concurrency Coordinator
 * Provides keyed serialization to eliminate read-modify-write race conditions
 * across banking, loyalty, drawer, shift, and inventory operations (WPA-07..WPA-10).
 */

const taskQueues = new Map<string, Promise<unknown>>();

/**
 * Enqueues an async task to execute sequentially for a specific resource key.
 * Operations on different keys run concurrently in parallel.
 * Operations on the same key are strictly serialized.
 *
 * @param key Unique resource identifier (e.g. `shift_${id}`, `bank_${id}`, `loyalty_${id}`)
 * @param task Async operation returning Promise<T>
 */
export function enqueueTask<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previousPromise = taskQueues.get(key) || Promise.resolve();

    const currentPromise = previousPromise
        .catch(() => {}) // Prevent previous rejections from breaking chain
        .then(() => task());

    const cleanupPromise = currentPromise
        .catch(() => {})
        .finally(() => {
            if (taskQueues.get(key) === cleanupPromise) {
                taskQueues.delete(key);
            }
        });

    taskQueues.set(key, cleanupPromise);

    return currentPromise;
}
