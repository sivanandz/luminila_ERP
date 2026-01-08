import PocketBase from 'pocketbase';

// Determine URL: Use localhost for default, but allow env override
const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';

export const pb = new PocketBase(PB_URL);

// Optional: Enable auto-cancellation for duplicate requests
pb.autoCancellation(false);

/**
 * Check if PocketBase is reachable
 */
export async function checkServerStatus(): Promise<boolean> {
    try {
        const health = await pb.health.check();
        return health.code === 200;
    } catch (err) {
        console.warn("PocketBase server unreachable:", err);
        return false;
    }
}
