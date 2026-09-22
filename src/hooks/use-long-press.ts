"use client";

import { useRef, useState, useCallback, useEffect } from "react";

/**
 * Long-press gesture for mobile context actions (spec §8.4).
 * - 500ms hold triggers the action
 * - Cancels if the finger moves > 10px (allows normal scrolling)
 * - Fires a 40ms haptic pulse via navigator.vibrate on trigger
 */
export function useLongPress(onLongPress: (position: { x: number; y: number }) => void, ms = 500) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const originRef = useRef<{ x: number; y: number } | null>(null);
    const [pressing, setPressing] = useState(false);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setPressing(false);
    }, []);

    const start = useCallback(
        (e: React.TouchEvent) => {
            const touch = e.touches?.[0];
            if (!touch) return;
            originRef.current = { x: touch.clientX, y: touch.clientY };

            clearTimer();
            timerRef.current = setTimeout(() => {
                // Movement tolerance already enforced in move handler; fire haptic + action
                if (typeof navigator !== "undefined" && "vibrate" in navigator) {
                    try { navigator.vibrate?.(40); } catch { /* haptics unsupported */ }
                }
                setPressing(false);
                onLongPress({
                    x: originRef.current?.x ?? 0,
                    y: originRef.current?.y ?? 0,
                });
            }, ms);
            setPressing(true);
        },
        [ms, onLongPress, clearTimer]
    );

    const move = useCallback(
        (e: React.TouchEvent) => {
            const origin = originRef.current;
            const touch = e.touches?.[0];
            if (!origin || !touch) return;
            const dx = Math.abs(touch.clientX - origin.x);
            const dy = Math.abs(touch.clientY - origin.y);
            if (dx > 10 || dy > 10) clearTimer();
        },
        [clearTimer]
    );

    useEffect(() => clearTimer, [clearTimer]);

    return {
        pressing,
        handlers: {
            onTouchStart: start,
            onTouchMove: move,
            onTouchEnd: clearTimer,
            onTouchCancel: clearTimer,
        },
    };
}
