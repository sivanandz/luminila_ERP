"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";

interface MarqueeTextProps {
    text: string;
    className?: string;
    speed?: number; // pixels per second for reading speed
    title?: string;
}

/**
 * Apple-grade MarqueeText component:
 * - Detects overflow via ResizeObserver & scrollWidth.
 * - Rest state: Clean, crisp text with subtle trailing fade mask (no hard cut-off).
 * - Group hover state: Buttery-smooth ping-pong marquee animation via CSS transform.
 * - Pauses at start and end for optimal human reading comprehension.
 * - Zero CPU/GPU overhead when text fits within container.
 * - Accessible (title attribute for native tooltips, respects reduced motion).
 */
export function MarqueeText({
    text,
    className = "",
    speed = 30,
    title,
}: MarqueeTextProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLSpanElement>(null);
    const [overflow, setOverflow] = useState(0);

    const calculateOverflow = useCallback(() => {
        if (!containerRef.current || !contentRef.current) return;
        const containerWidth = containerRef.current.clientWidth;
        const contentWidth = contentRef.current.scrollWidth;
        const diff = contentWidth - containerWidth;
        setOverflow(diff > 3 ? diff : 0);
    }, []);

    useEffect(() => {
        calculateOverflow();

        if (typeof ResizeObserver !== "undefined" && containerRef.current) {
            const ro = new ResizeObserver(() => {
                calculateOverflow();
            });
            ro.observe(containerRef.current);
            return () => ro.disconnect();
        }
    }, [text, calculateOverflow]);

    // Duration based on reading speed (between 2.5s and 7s)
    const duration = Math.max(2.5, Math.min(7.5, (overflow + 30) / speed));

    return (
        <div
            ref={containerRef}
            data-overflow={overflow > 0 ? "true" : "false"}
            className={`marquee-container relative min-w-0 overflow-hidden select-none ${className}`}
            title={title || text}
            style={
                overflow > 0
                    ? ({
                          "--marquee-overflow": `-${overflow + 6}px`,
                          "--marquee-duration": `${duration}s`,
                      } as React.CSSProperties)
                    : undefined
            }
        >
            <span
                ref={contentRef}
                data-overflow={overflow > 0 ? "true" : "false"}
                className={`marquee-content inline-block whitespace-nowrap will-change-transform ${
                    overflow > 0 ? "marquee-overflowing" : ""
                }`}
            >
                {text}
            </span>
        </div>
    );
}

export default MarqueeText;
