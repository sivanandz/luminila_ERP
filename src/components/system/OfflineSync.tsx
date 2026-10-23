"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { OfflineQueue } from "@/lib/offline-queue";

/**
 * Activates the offline queue: drains it when the browser comes back online,
 * retries on an interval, and shows a small status pill while offline or while
 * mutations are waiting. Audit entries are the first producer (activity.ts
 * enqueues when the database is unreachable).
 */
export function OfflineSync() {
    const [online, setOnline] = useState(true);
    const [count, setCount] = useState(0);
    const [flushing, setFlushing] = useState(false);
    const flushingRef = useRef(false);

    const refresh = useCallback(() => {
        setCount(OfflineQueue.getQueue().length);
    }, []);

    const flush = useCallback(async (announce: boolean) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        if (flushingRef.current) return;

        flushingRef.current = true;
        setFlushing(true);
        try {
            const { processed, failed } = await OfflineQueue.flush();
            refresh();
            if (announce && processed > 0) {
                toast.success(`${processed} queued change${processed === 1 ? "" : "s"} synced`);
            }
            if (announce && failed > 0) {
                toast.error(`${failed} queued change${failed === 1 ? "" : "s"} could not be synced yet`);
            }
        } catch (error) {
            console.error("Offline flush failed:", error);
        } finally {
            flushingRef.current = false;
            setFlushing(false);
        }
    }, [refresh]);

    useEffect(() => {
        setOnline(navigator.onLine);
        refresh();

        if (navigator.onLine) {
            void flush(false);
        }

        const handleOnline = () => {
            setOnline(true);
            void flush(true);
        };
        const handleOffline = () => {
            setOnline(false);
            toast("Offline: queued changes will sync when the connection returns");
        };
        const handleQueueChanged = () => refresh();

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);
        window.addEventListener("offline-queue:changed", handleQueueChanged as EventListener);

        const interval = window.setInterval(() => {
            if (navigator.onLine && OfflineQueue.getQueue().length > 0) {
                void flush(false);
            }
        }, 30_000);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            window.removeEventListener("offline-queue:changed", handleQueueChanged as EventListener);
            window.clearInterval(interval);
        };
    }, [flush, refresh]);

    if (online && count === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-xs shadow-lg">
            {online ? (
                <>
                    <RefreshCw className={`w-3.5 h-3.5 ${flushing ? "animate-spin" : ""}`} />
                    <span>{count} change{count === 1 ? "" : "s"} waiting</span>
                </>
            ) : (
                <>
                    <CloudOff className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-amber-400">
                        Offline{count > 0 ? ` · ${count} queued` : ""}
                    </span>
                </>
            )}
            <button
                type="button"
                onClick={() => void flush(true)}
                disabled={!online || flushing || count === 0}
                className="ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary disabled:opacity-40"
            >
                Sync now
            </button>
        </div>
    );
}
