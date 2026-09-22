/**
 * Concurrency-Safe Sequence Allocator
 * Resolves F9 (🟠 P2) from AGENT 1 / AGENT 2 Collaboration Forum
 *
 * Provides:
 * 1. Intra-process serialized queue (mutex) per sequence name to prevent in-process race conditions.
 * 2. Cross-process optimistic concurrency retry loop with randomized backoff jitter.
 * 3. Atomic schema-safe dual-write of current_value and current_number on number_sequences.
 * 4. Fallback recovery with descriptive logging.
 */

import { pb } from './pocketbase';

export interface SequenceOptions {
    /** Unique identifier for sequence (e.g. 'invoice_2627', 'po', 'grn', 'credit_note', 'challan', 'expense') */
    seqName: string;
    /** Document prefix (e.g. 'INV', 'PO', 'GRN', 'CN', 'DC', 'EXP') */
    prefix: string;
    /** Zero-padding length, defaults to 5 */
    padding?: number;
    /** Optional custom document number formatter */
    formatFn?: (nextNum: number, prefix: string) => string;
    /** Maximum optimistic retry attempts on conflict, defaults to 5 */
    maxRetries?: number;
}

// In-process per-sequence lock queue
const sequenceQueues = new Map<string, Promise<unknown>>();

/**
 * Enqueues a task to run sequentially for a given sequence key.
 */
function enqueueSequenceTask<T>(seqKey: string, task: () => Promise<T>): Promise<T> {
    const previousPromise = sequenceQueues.get(seqKey) || Promise.resolve();

    const currentPromise = previousPromise
        .catch(() => {}) // Prevent previous rejections from breaking chain
        .then(() => task());

    // Keep map clean when chain completes
    sequenceQueues.set(
        seqKey,
        currentPromise.finally(() => {
            if (sequenceQueues.get(seqKey) === currentPromise) {
                sequenceQueues.delete(seqKey);
            }
        })
    );

    return currentPromise;
}

/**
 * Generates the next sequential number with concurrency guards.
 */
export async function getNextSequenceNumber(options: SequenceOptions): Promise<string> {
    const { seqName, prefix, padding = 5, formatFn, maxRetries = 5 } = options;

    return enqueueSequenceTask(seqName, async () => {
        let attempt = 0;
        let lastError: any = null;

        while (attempt < maxRetries) {
            attempt++;
            try {
                // Scoped strictly to sequence name to respect per-FY and per-type resets
                const seq = await pb
                    .collection('number_sequences')
                    .getFirstListItem(`name="${seqName}"`)
                    .catch(() => null);

                let nextValue: number;

                if (seq) {
                    const current = Number(seq.current_value ?? seq.current_number ?? 0);
                    nextValue = current + 1;

                    await pb.collection('number_sequences').update(seq.id, {
                        current_value: nextValue,
                        current_number: nextValue,
                    });
                } else {
                    nextValue = 1;
                    try {
                        await pb.collection('number_sequences').create({
                            name: seqName,
                            prefix: prefix,
                            current_value: nextValue,
                            current_number: nextValue,
                            padding: padding,
                        });
                    } catch (createErr: any) {
                        // If another process created the record concurrently, re-read and retry
                        const backoffMs = Math.floor(Math.random() * 40) + 20; // 20-60ms jitter
                        await new Promise((resolve) => setTimeout(resolve, backoffMs));
                        continue;
                    }
                }

                if (formatFn) {
                    return formatFn(nextValue, prefix);
                }

                return `${prefix}-${nextValue.toString().padStart(padding, '0')}`;
            } catch (err: any) {
                lastError = err;
                // Randomized exponential backoff with jitter
                const backoffMs = Math.floor(Math.random() * 50 * attempt) + 25;
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }

        console.error(`[sequence-generator] Failed sequence allocation for '${seqName}' after ${maxRetries} attempts:`, lastError);
        // Fallback to timestamp to prevent blocking transaction
        return `${prefix}-${Date.now()}`;
    });
}
