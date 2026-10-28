"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveal-on-scroll entrance. Direction-aware (up | left | right | scale),
 * staggered via the `delay` prop rendered as a transition-delay variable.
 * Falls back to visible when IntersectionObserver is unavailable or the
 * visitor prefers reduced motion (the CSS side also hard-disables).
 */
export function Reveal({
    children,
    className = "",
    delay = 0,
    direction = "up",
    as: Tag = "div",
}: {
    children: React.ReactNode;
    className?: string;
    delay?: number;
    direction?: "up" | "left" | "right" | "scale";
    as?: "div" | "section" | "article" | "li";
}) {
    const ref = useRef<HTMLElement | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (typeof IntersectionObserver === "undefined") {
            setVisible(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        setVisible(true);
                        observer.disconnect();
                    }
                }
            },
            { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <Tag
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ref={ref as any}
            className={`nt-reveal ${visible ? "nt-visible" : ""} ${className}`.trim()}
            data-dir={direction}
            style={delay ? ({ "--nt-delay": `${delay}ms` } as React.CSSProperties) : undefined}
        >
            {children}
        </Tag>
    );
}
