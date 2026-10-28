import React from "react";

/** Inline SVG set copied from the Niththigal example. */

export function BrandSymbol({ className = "brand-symbol" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 40 42" fill="none" aria-hidden="true">
            <path
                d="M20 3C10 12 10 21 20 28C30 21 30 12 20 3Z M20 28C8 28 3 20 4 12C14 13 20 18 20 28Z M20 28C32 28 37 20 36 12C26 13 20 18 20 28Z M8 32C16 37 24 37 32 32 M15 39H25"
                stroke="currentColor"
                strokeWidth="1.3"
            />
        </svg>
    );
}

export function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="6.8" />
            <path d="m16 16 5 5" />
        </svg>
    );
}

export function HeartIcon({ filled = false }: { filled?: boolean }) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" style={filled ? { fill: "currentColor" } : undefined}>
            <path d="M20.8 4.6c-2.4-2.4-6.1-1.5-8.8 1.3C9.3 3.1 5.6 2.2 3.2 4.6-.6 8.5 4.4 14.4 12 20c7.6-5.6 12.6-11.5 8.8-15.4Z" />
        </svg>
    );
}

export function BagIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7h14l1 14H4L5 7Z M8 8V6a4 4 0 0 1 8 0v2" />
        </svg>
    );
}

export function MenuIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
    );
}

export function AccountIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
        </svg>
    );
}

export function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5l14 14M19 5 5 19" />
        </svg>
    );
}

export function ArrowUpRight() {
    return <span aria-hidden>↗</span>;
}

export function ArrowRight() {
    return <span aria-hidden>→</span>;
}

export function ArrowDown() {
    return <span aria-hidden>↓</span>;
}

const PROMISE_PATHS: Record<string, React.ReactNode> = {
    heritage: <path d="m12 3 8 6-8 12L4 9l8-6Z M4 9h16M8 9l4 12 4-12M8 9l4-6 4 6" />,
    moments: <path d="M12 21S3 15 3 8a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 7-9 13-9 13Z" />,
    gift: <path d="M3 8h18v13H3zM2 5h20v4H2zM12 5v16M12 5C5 5 6 0 9 2l3 3Zm0 0c7 0 6-5 3-3l-3 3Z" />,
};

export function PromiseIcon({ name }: { name: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true">{PROMISE_PATHS[name] || PROMISE_PATHS.heritage}</svg>;
}

const BENEFIT_PATHS: Record<string, React.ReactNode> = {
    heritage: <path d="M20 5c-10 10-10 19 0 27 10-8 10-17 0-27ZM20 32C8 30 5 23 5 14c9 2 15 8 15 18Zm0 0c12-2 15-9 15-18-9 2-15 8-15 18ZM12 36h16" />,
    sparkle: <path d="m20 5 4 11 11 4-11 4-4 11-4-11-11-4 11-4 4-11ZM32 3v8m-4-4h8M7 30v8m-4-4h8" />,
    gift: <path d="M7 17h26v19H7zM5 11h30v7H5zM20 11v25M20 11C6 11 8 0 14 4l6 7Zm0 0c14 0 12-11 6-7l-6 7Z" />,
};

export function BenefitIcon({ name }: { name: string }) {
    return <svg viewBox="0 0 40 40" aria-hidden="true">{BENEFIT_PATHS[name] || BENEFIT_PATHS.heritage}</svg>;
}

const PRICE_PATHS: Record<string, React.ReactNode> = {
    tag: <path d="M20.6 4.6H30a1 1 0 0 1 1 1v9.4a2 2 0 0 1-.6 1.4L17.4 29.4a2 2 0 0 1-2.8 0L5.6 20.4a2 2 0 0 1 0-2.8L18.6 4.6a2 2 0 0 1 2-0Zm4.9 5.9h.01" />,
    gift: <path d="M4 9h16v13H4zM3 6h18v4H3zM12 6v16M12 6C6 6 7 1 9.5 2.5L12 6Zm0 0c6 0 5-5 2.5-3.5L12 6Z" />,
    truck: <path d="M3 6h10v10H3zM13 9h4l3 3v4h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm9 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
};

export function PriceIcon({ name }: { name: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true">{PRICE_PATHS[name] || PRICE_PATHS.tag}</svg>;
}

export function CopyIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="11" height="11" rx="2" />
            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
        </svg>
    );
}

export function InstagramIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <path d="M17.5 6.5h.01" />
        </svg>
    );
}

export function ReelIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="m10 9 5 3-5 3V9Z" />
        </svg>
    );
}

export function Sparkle({ className = "little-flower" }: { className?: string }) {
    return <span className={className} aria-hidden>✺</span>;
}
