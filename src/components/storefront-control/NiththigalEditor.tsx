"use client";

import React, { useMemo, useRef, useState } from "react";
import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    BookOpen,
    HelpCircle,
    Image as ImageIcon,
    Layers,
    LayoutTemplate,
    Megaphone,
    Palette,
    Plus,
    RotateCcw,
    Search,
    ShieldCheck,
    Sliders,
    Sparkles,
    Star,
    Store,
    Tag,
    Trash2,
    Upload,
    type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    NITHTHIGAL_DEFAULTS,
    NITHTHIGAL_SECTION_LABELS,
    type NiththigalContent,
    type NtBenefitItem,
    type NtFooterLink,
    type NtHeroSlide,
    type NtInstagramPost,
    type NtNavItem,
    type NtPricingItem,
    type NtPromiseItem,
    type NtSection,
    type NtTestimonial,
} from "@/lib/niththigal-content";

type EditorTab =
    | "brand"
    | "hero"
    | "promise"
    | "collection"
    | "promo"
    | "story"
    | "benefits"
    | "testimonials"
    | "instagram"
    | "pricing"
    | "faq"
    | "finalCta"
    | "footer"
    | "info"
    | "commerce"
    | "theme"
    | "sections";

const TABS: { id: EditorTab; label: string; icon: LucideIcon; hint: string }[] = [
    { id: "brand", label: "Brand & Navigation", icon: Store, hint: "Announcement, wordmark, desktop and mobile links" },
    { id: "hero", label: "Hero", icon: ImageIcon, hint: "Campaign image, headline, CTAs and captions" },
    { id: "promise", label: "Promise Strip", icon: ShieldCheck, hint: "The three social-proof promises" },
    { id: "collection", label: "Product Showcase", icon: Layers, hint: "Heading, filters, labels and price copy" },
    { id: "promo", label: "Promo Band", icon: Tag, hint: "Coupon code, discount and copy" },
    { id: "story", label: "Brand Story", icon: BookOpen, hint: "Heritage band, stamp and signature" },
    { id: "benefits", label: "Benefits", icon: Sparkles, hint: "Three emotional benefit cards" },
    { id: "testimonials", label: "Community Stories", icon: Star, hint: "Quote cards and rating note" },
    { id: "instagram", label: "Instagram", icon: LayoutTemplate, hint: "Handle, CTA and post cards" },
    { id: "pricing", label: "Retail Price Story", icon: Tag, hint: "Live from-price anchor and value cards" },
    { id: "faq", label: "FAQ", icon: HelpCircle, hint: "Questions, answers and intro" },
    { id: "finalCta", label: "Final CTA", icon: ArrowRight, hint: "Closing heading and button" },
    { id: "footer", label: "Footer", icon: LayoutTemplate, hint: "Columns, saved link, note and legal line" },
    { id: "info", label: "Info Dialogs", icon: HelpCircle, hint: "Shipping, privacy and jewellery care" },
    { id: "commerce", label: "Search & Bag Copy", icon: Search, hint: "Search, saved, bag and product dialog labels" },
    { id: "theme", label: "Theme", icon: Palette, hint: "Palette, typography and fonts" },
    { id: "sections", label: "Sections & Order", icon: Sliders, hint: "Show, hide and reorder every section" },
];

const FONT_OPTIONS = {
    heading: ["Cormorant Garamond", "Playfair Display", "DM Serif Display", "Lora", "Libre Baskerville"],
    body: ["Manrope", "Inter", "Plus Jakarta Sans", "Jost", "DM Sans"],
};

const IMAGE_PRESETS = [
    { label: "Hero campaign", value: "/niththigal/hero.webp" },
    { label: "Lakshmi necklace", value: "/niththigal/necklace.webp" },
    { label: "Temple jhumkas", value: "/niththigal/jhumka.webp" },
    { label: "Heritage bangles", value: "/niththigal/bangles.webp" },
    { label: "Diary 1", value: "/instagram/post-1.jpg" },
    { label: "Diary 2", value: "/instagram/post-2.jpg" },
    { label: "Diary 3", value: "/instagram/post-3.jpg" },
];

const PALETTES = [
    {
        name: "Niththigal lime",
        colors: NITHTHIGAL_DEFAULTS.theme.colors,
    },
    {
        name: "Ivory atelier",
        colors: {
            cream: "#faf8f2",
            paper: "#f2eee5",
            green: "#193d32",
            greenDeep: "#16372e",
            ink: "#243a30",
            muted: "#656c5e",
            gold: "#a78043",
            line: "#dedfd4",
        },
    },
    {
        name: "Temple rose",
        colors: {
            cream: "#f7f0ec",
            paper: "#efe3dc",
            green: "#3d2626",
            greenDeep: "#321d1d",
            ink: "#3b2a2a",
            muted: "#78615f",
            gold: "#b07d4f",
            line: "#e4d3c9",
        },
    },
];

export function getStorefrontOrigin(): string {
    const configured = process.env.NEXT_PUBLIC_STOREFRONT_URL;
    if (configured) return configured.replace(/\/$/, "");
    if (process.env.NODE_ENV !== "production") return "http://localhost:3001";
    if (typeof window !== "undefined") return window.location.origin;
    return "";
}

export function assetUrl(url: string): string {
    if (!url) return "";
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    return `${getStorefrontOrigin()}${url.startsWith("/") ? "" : "/"}${url}`;
}

function moveAt<T>(items: T[], index: number, direction: -1 | 1): T[] {
    const target = index + direction;
    if (target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

function updateAt<T>(items: T[], index: number, patch: Partial<T>): T[] {
    return items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
    );
}

function Field({
    label,
    value,
    onChange,
    placeholder,
    hint,
    type = "text",
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    hint?: string;
    type?: string;
}) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs font-medium">{label}</Label>
            <Input
                type={type}
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
                className="h-9 text-sm"
            />
            {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

function Area({
    label,
    value,
    onChange,
    rows = 3,
    hint,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    rows?: number;
    hint?: string;
    placeholder?: string;
}) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs font-medium">{label}</Label>
            <Textarea
                value={value}
                rows={rows}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
                className="text-sm leading-relaxed"
            />
            {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

function Toggle({
    label,
    checked,
    onChange,
    hint,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    hint?: string;
}) {
    return (
        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 px-3 py-2.5">
            <div>
                <p className="text-xs font-medium">{label}</p>
                {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
            </div>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    );
}

function SelectField({
    label,
    value,
    onChange,
    options,
    hint,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    hint?: string;
}) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs font-medium">{label}</Label>
            <Select value={value} onValueChange={(next) => next && onChange(next)}>
                <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

function ImageField({
    label,
    value,
    onChange,
    hint,
    recommended,
    minWidth = 800,
    maxKb = 900,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    hint?: string;
    recommended?: string;
    minWidth?: number;
    maxKb?: number;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [error, setError] = useState("");
    const [warning, setWarning] = useState("");
    const [dimensions, setDimensions] = useState("");

    const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        setError("");
        setWarning("");
        setDimensions("");

        const extensionOk = /\.(svg|png|jpe?g|webp|avif|gif)$/i.test(file.name);
        if (!file.type.startsWith("image/") && !extensionOk) {
            setError("Choose an image file (SVG, PNG, JPEG, WebP or AVIF).");
            return;
        }
        if (file.size > maxKb * 1024) {
            setError(
                `This file is ${Math.round(file.size / 1024)} KB. Keep it under ${maxKb} KB; use a URL in the field above for a larger original.`
            );
            return;
        }

        try {
            const dataUrl = await readFileAsDataUrl(file);
            const { width, height } = await imageDimensions(dataUrl);
            const vector = /svg/i.test(file.type) || /\.svg$/i.test(file.name);

            if (!vector && width > 0 && height > 0) {
                setDimensions(`${width} × ${height} px`);
                if (width < minWidth) {
                    setWarning(
                        `Only ${width} px wide. ${recommended || `Use at least ${minWidth} px`}.`
                    );
                }
            } else {
                setDimensions("Vector / uploaded image");
            }

            onChange(dataUrl);
        } catch {
            setError("Could not read this image. Try exporting it again.");
        }
    };

    return (
        <div className="space-y-2.5 rounded-xl border bg-background p-3.5 shadow-xs">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <Label className="text-xs font-medium">{label}</Label>
                    {recommended ? (
                        <p className="text-[10px] text-muted-foreground">
                            Recommended: {recommended}
                        </p>
                    ) : null}
                </div>
                {value ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-destructive"
                        onClick={() => {
                            onChange("");
                            setDimensions("");
                            setWarning("");
                            setError("");
                        }}
                    >
                        Remove
                    </Button>
                ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
                <div className="grid h-24 w-full shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted sm:w-32">
                    {value ? (
                        <img
                            src={assetUrl(value)}
                            alt=""
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                    {value.startsWith("data:") ? (
                        <p className="rounded-md border bg-muted/40 px-2.5 py-2 text-[10px] text-muted-foreground">
                            Uploaded picture is embedded in the CMS record. Remove it to
                            switch back to a URL.
                        </p>
                    ) : (
                        <Input
                            value={value}
                            onChange={(event) => onChange(event.target.value)}
                            placeholder="/niththigal/hero.webp or https://…"
                            className="h-9 text-sm"
                        />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 text-xs"
                            onClick={() => inputRef.current?.click()}
                        >
                            <Upload className="h-3.5 w-3.5" />
                            {value ? "Replace picture" : "Upload picture"}
                        </Button>
                        <input
                            ref={inputRef}
                            type="file"
                            accept="image/svg+xml,image/png,image/webp,image/jpeg,image/avif"
                            className="hidden"
                            onChange={handleFile}
                        />
                        {dimensions ? (
                            <span className="text-[10px] text-muted-foreground">
                                {dimensions}
                            </span>
                        ) : null}
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {IMAGE_PRESETS.map((preset) => (
                    <button
                        key={preset.value}
                        type="button"
                        onClick={() => onChange(preset.value)}
                        className={`overflow-hidden rounded-md border transition hover:ring-2 hover:ring-primary/40 ${
                            value === preset.value ? "ring-2 ring-primary" : ""
                        }`}
                        title={preset.label}
                    >
                        <img
                            src={assetUrl(preset.value)}
                            alt={preset.label}
                            className="h-9 w-9 object-cover"
                        />
                    </button>
                ))}
            </div>

            {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
            {warning ? <p className="text-[10px] text-amber-600">{warning}</p> : null}
            {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

function ItemShell({
    index,
    label,
    onRemove,
    onUp,
    onDown,
    children,
}: {
    index: number;
    label: string;
    onRemove: () => void;
    onUp: () => void;
    onDown: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-3 rounded-xl border bg-background p-3.5 shadow-xs">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label} {index + 1}
                </span>
                <div className="flex items-center gap-0.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={onUp}
                        disabled={index === 0}
                        aria-label={`Move ${label.toLowerCase()} up`}
                    >
                        <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={onDown}
                        aria-label={`Move ${label.toLowerCase()} down`}
                    >
                        <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={onRemove}
                        aria-label={`Remove ${label.toLowerCase()}`}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
            {children}
        </div>
    );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <Button type="button" variant="outline" size="sm" onClick={onClick} className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> {label}
        </Button>
    );
}

type BrandAssetKind = "logo" | "wordmark" | "lockup";

const BRAND_ASSET_SPECS: Record<
    BrandAssetKind,
    {
        label: string;
        recommended: string;
        display: string;
        minWidth: number;
        maxKb: number;
        ratio: [number, number];
        hint: string;
    }
> = {
    logo: {
        label: "Logo mark",
        recommended: "512 × 512 px · 1:1",
        display: "Renders 40 px high desktop / 34 px mobile",
        minWidth: 128,
        maxKb: 400,
        ratio: [0.8, 1.25],
        hint: "Square mark. SVG preferred; transparent PNG/WebP otherwise.",
    },
    wordmark: {
        label: "Wordmark",
        recommended: "600 × 200 px · 3:1",
        display: "Renders 38 px high desktop / 30 px mobile, up to 180 px wide",
        minWidth: 300,
        maxKb: 400,
        ratio: [2.2, 4.2],
        hint: "Text-only lockup. SVG preferred; transparent PNG/WebP otherwise.",
    },
    lockup: {
        label: "Combined lockup (optional)",
        recommended: "600 × 180 px · 3.33:1 with tagline",
        display: "Renders 54 px high desktop / 42 px mobile, up to 220 px wide",
        minWidth: 400,
        maxKb: 600,
        ratio: [2.8, 4.4],
        hint: "One file containing mark + wordmark. Use 600 × 130 px (4.6:1) without a tagline.",
    },
};

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Read failed"));
        reader.readAsDataURL(file);
    });
}

function imageDimensions(
    dataUrl: string
): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () =>
            resolve({
                width: image.naturalWidth || 0,
                height: image.naturalHeight || 0,
            });
        image.onerror = () => resolve({ width: 0, height: 0 });
        image.src = dataUrl;
    });
}

function LogoUploadField({
    kind,
    value,
    alt,
    naturalWidth,
    naturalHeight,
    onChange,
    onRemove,
    onAltChange,
}: {
    kind: BrandAssetKind;
    value: string;
    alt: string;
    naturalWidth: number;
    naturalHeight: number;
    onChange: (dataUrl: string, width: number, height: number) => void;
    onRemove: () => void;
    onAltChange: (value: string) => void;
}) {
    const spec = BRAND_ASSET_SPECS[kind];
    const inputRef = useRef<HTMLInputElement>(null);
    const [error, setError] = useState("");
    const [warning, setWarning] = useState("");

    const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        setError("");
        setWarning("");

        const extensionOk = /\.(svg|png|jpe?g|webp)$/i.test(file.name);
        if (
            !/^image\/(png|jpeg|webp|svg\+xml)$/i.test(file.type) &&
            !extensionOk
        ) {
            setError("Choose an SVG, PNG, WebP or JPEG image.");
            return;
        }
        if (file.size > spec.maxKb * 1024) {
            setError(
                `This file is ${Math.round(file.size / 1024)} KB. Keep it under ${spec.maxKb} KB so the CMS record stays light.`
            );
            return;
        }

        try {
            const dataUrl = await readFileAsDataUrl(file);
            const { width, height } = await imageDimensions(dataUrl);
            const vector = /svg/i.test(file.type) || /\.svg$/i.test(file.name);

            if (!vector && width) {
                const warnings: string[] = [];
                if (width < spec.minWidth) {
                    warnings.push(
                        `Only ${width} px wide; ${spec.recommended.split("·")[0].trim()} is recommended for sharp retina rendering.`
                    );
                }
                if (height > 0) {
                    const ratio = width / height;
                    if (ratio < spec.ratio[0] || ratio > spec.ratio[1]) {
                        warnings.push(
                            `Aspect ratio is ${ratio.toFixed(2)}:1; the expected range is ${spec.ratio[0]}–${spec.ratio[1]}:1.`
                        );
                    }
                }
                setWarning(warnings.join(" "));
            }

            // SVG dimensions from the browser are often a default 300×150;
            // leave them unset so the image uses its own viewBox ratio.
            onChange(dataUrl, vector ? 0 : width, vector ? 0 : height);
        } catch {
            setError("Could not read this image. Try exporting it again.");
        }
    };

    return (
        <div className="space-y-3 rounded-xl border bg-background p-3.5 shadow-xs">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <p className="text-xs font-semibold">{spec.label}</p>
                    <p className="text-[10px] text-muted-foreground">{spec.recommended}</p>
                </div>
                {value ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-destructive"
                        onClick={onRemove}
                    >
                        Remove
                    </Button>
                ) : null}
            </div>

            <div
                className="grid h-28 place-items-center overflow-hidden rounded-lg border p-3"
                style={{
                    backgroundImage:
                        "linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
                }}
            >
                {value ? (
                    <img
                        src={value}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                    />
                ) : (
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => inputRef.current?.click()}
                >
                    <Upload className="h-3.5 w-3.5" />
                    {value ? "Replace file" : "Choose file"}
                </Button>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/svg+xml,image/png,image/webp,image/jpeg"
                    className="hidden"
                    onChange={handleFile}
                />
                {value ? (
                    <span className="text-[10px] text-muted-foreground">
                        {naturalWidth > 0 && naturalHeight > 0
                            ? `${naturalWidth} × ${naturalHeight} px`
                            : "Vector / image uploaded"}
                    </span>
                ) : null}
            </div>

            <div className="space-y-1">
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                    {spec.display}. {spec.hint}
                </p>
                {error ? <p className="text-[10px] text-destructive">{error}</p> : null}
                {warning ? <p className="text-[10px] text-amber-600">{warning}</p> : null}
            </div>

            <Field
                label="Alt text"
                value={alt}
                onChange={onAltChange}
                hint="Read by screen readers and shown if the image cannot load."
            />
        </div>
    );
}

function BrandResolutionGuide() {
    return (
        <div className="space-y-2 rounded-xl border bg-muted/20 p-3.5">
            <p className="text-xs font-semibold">Resolution guide</p>
            <div className="grid gap-2 text-[10px] leading-relaxed text-muted-foreground sm:grid-cols-3">
                <p>
                    <strong className="text-foreground">Logo only</strong>
                    <br />
                    512 × 512 px (1:1). Renders 40 px high desktop / 34 px mobile.
                    Minimum 128 × 128. At 2×/3× that is 80/120 px tall.
                </p>
                <p>
                    <strong className="text-foreground">Wordmark only</strong>
                    <br />
                    600 × 200 px (3:1). Renders 38 px high desktop / 30 px mobile,
                    up to 180 px wide. Minimum 300 × 100. At 3× the text needs
                    roughly 426 px of width.
                </p>
                <p>
                    <strong className="text-foreground">Logo + wordmark</strong>
                    <br />
                    Upload both; composed at about 186 × 55 px desktop / 142 × 43 px
                    mobile. Or upload one combined lockup at 600 × 180 px (3.33:1)
                    with tagline, or 600 × 130 px (4.6:1) without.
                </p>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
                SVG is preferred. Otherwise use transparent PNG or WebP, trim
                transparent padding, and keep each file under 400 KB (600 KB for a
                combined lockup). Files are embedded in the CMS record, so no
                separate media server is required.
            </p>
        </div>
    );
}

export function NiththigalEditor({
    value,
    onChange,
    onReset,
    inventoryTenant,
}: {
    value: NiththigalContent;
    onChange: (value: NiththigalContent) => void;
    onReset: () => void;
    inventoryTenant?: string;
}) {
    const [tab, setTab] = useState<EditorTab>("brand");
    const data = value || NITHTHIGAL_DEFAULTS;

    const patch = <K extends keyof NiththigalContent>(
        key: K,
        next: Partial<NiththigalContent[K]>
    ) => {
        const current = data[key];
        const merged =
            current && typeof current === "object" && !Array.isArray(current)
                ? { ...current, ...next }
                : next;
        onChange({ ...data, [key]: merged } as NiththigalContent);
    };

    const sections = useMemo(
        () => [...data.sections].sort((a, b) => a.order - b.order),
        [data.sections]
    );

    const brandModeMissing =
        (data.brand.logoMode === "logo" && !data.brand.logoUrl) ||
        (data.brand.logoMode === "wordmark" && !data.brand.wordmarkUrl) ||
        (data.brand.logoMode === "both" &&
            (!data.brand.logoUrl || !data.brand.wordmarkUrl)) ||
        (data.brand.logoMode === "lockup" && !data.brand.lockupUrl);

    const addHeroSlide = () => {
        const slide: NtHeroSlide = {
            id: `slide-${Date.now()}`,
            // Empty fields inherit the single-image copy above; this avoids
            // duplicating an embedded data URL when a slide is first added.
            imageUrl: "",
            imageAlt: "",
            captionLabel: "",
            captionText: "",
            tagTitle: "",
            tagSub: "",
            tagHref: "",
            verticalCaption: "",
        };
        patch("hero", {
            slides: [...data.hero.slides, slide],
            slideshow: { ...data.hero.slideshow, enabled: true },
        });
    };

    const updateSections = (next: NtSection[]) =>
        onChange({
            ...data,
            sections: next.map((section, index) => ({ ...section, order: index + 1 })),
        });

    const activeTab = TABS.find((item) => item.id === tab) || TABS[0];

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        Niththigal Storefront
                        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                            Full CMS
                        </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1 text-xs">
                        Every visible section, label, image and theme token. Changes save with the
                        main “Save Changes” button.
                    </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                    <a
                        href={getStorefrontOrigin() || "/"}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ variant: "outline", size: "sm" }) + " gap-1.5 text-xs"}
                    >
                        View storefront <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                    <Button type="button" variant="outline" size="sm" onClick={onReset} className="gap-1.5 text-xs">
                        <RotateCcw className="h-3.5 w-3.5" /> Reset to example
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
                    <div className="space-y-2">
                        <div className="lg:hidden">
                            <Select value={tab} onValueChange={(next) => setTab(next as EditorTab)}>
                                <SelectTrigger className="h-10 text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TABS.map((item) => (
                                        <SelectItem key={item.id} value={item.id}>
                                            {item.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <nav className="hidden max-h-[calc(100dvh-9rem)] flex-col gap-0.5 overflow-y-auto pr-1 lg:sticky lg:top-4 lg:flex">
                            {TABS.map((item) => {
                                const Icon = item.icon;
                                const active = item.id === tab;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setTab(item.id)}
                                        className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                                            active
                                                ? "bg-primary/10 text-primary"
                                                : "text-muted-foreground hover:bg-muted"
                                        }`}
                                    >
                                        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>
                                            <span className="block text-xs font-semibold">{item.label}</span>
                                            <span className="block text-[10px] leading-snug opacity-70">
                                                {item.hint}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </nav>
                    </div>

                    <div className="min-w-0 space-y-4">
                        <div className="rounded-lg border bg-muted/30 px-3.5 py-2.5">
                            <p className="text-xs font-semibold">{activeTab.label}</p>
                            <p className="text-[11px] text-muted-foreground">{activeTab.hint}</p>
                        </div>

                        {tab === "brand" && (
                            <div className="space-y-5">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Brand name" value={data.brand.name} onChange={(v) => patch("brand", { name: v })} />
                                    <Field label="Tagline under the wordmark" value={data.brand.tagline} onChange={(v) => patch("brand", { tagline: v })} />
                                </div>

                                <div className="space-y-4 rounded-xl border bg-muted/20 p-3.5">
                                    <div>
                                        <p className="text-xs font-semibold">Logo &amp; wordmark</p>
                                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                                            Upload a mark, a wordmark, or both. Auto prefers a combined
                                            lockup, then logo + wordmark, then whichever single file
                                            exists. The example symbol and text remain the fallback.
                                        </p>
                                    </div>

                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <SelectField
                                            label="Lockup mode"
                                            value={data.brand.logoMode}
                                            onChange={(v) =>
                                                patch("brand", {
                                                    logoMode: v as NiththigalContent["brand"]["logoMode"],
                                                })
                                            }
                                            options={[
                                                { value: "auto", label: "Auto (recommended)" },
                                                { value: "logo", label: "Logo only" },
                                                { value: "wordmark", label: "Wordmark only" },
                                                { value: "both", label: "Logo + wordmark" },
                                                { value: "lockup", label: "Combined lockup" },
                                            ]}
                                            hint="Auto falls back if the selected mode has no file."
                                        />
                                        <Toggle
                                            label="Show tagline under the wordmark"
                                            checked={data.brand.showTagline}
                                            onChange={(v) => patch("brand", { showTagline: v })}
                                            hint="Ignored for logo-only and combined-lockup modes."
                                        />
                                    </div>

                                    {brandModeMissing ? (
                                        <p className="text-[10px] text-amber-600">
                                            The selected mode is missing an upload. The storefront
                                            falls back to Auto until that file is added.
                                        </p>
                                    ) : null}

                                    <div className="grid gap-3 xl:grid-cols-3">
                                        <LogoUploadField
                                            kind="logo"
                                            value={data.brand.logoUrl}
                                            alt={data.brand.logoAlt}
                                            naturalWidth={data.brand.logoNaturalWidth}
                                            naturalHeight={data.brand.logoNaturalHeight}
                                            onChange={(url, width, height) =>
                                                patch("brand", {
                                                    logoUrl: url,
                                                    logoNaturalWidth: width,
                                                    logoNaturalHeight: height,
                                                })
                                            }
                                            onRemove={() =>
                                                patch("brand", {
                                                    logoUrl: "",
                                                    logoNaturalWidth: 0,
                                                    logoNaturalHeight: 0,
                                                })
                                            }
                                            onAltChange={(v) => patch("brand", { logoAlt: v })}
                                        />
                                        <LogoUploadField
                                            kind="wordmark"
                                            value={data.brand.wordmarkUrl}
                                            alt={data.brand.wordmarkAlt}
                                            naturalWidth={data.brand.wordmarkNaturalWidth}
                                            naturalHeight={data.brand.wordmarkNaturalHeight}
                                            onChange={(url, width, height) =>
                                                patch("brand", {
                                                    wordmarkUrl: url,
                                                    wordmarkNaturalWidth: width,
                                                    wordmarkNaturalHeight: height,
                                                })
                                            }
                                            onRemove={() =>
                                                patch("brand", {
                                                    wordmarkUrl: "",
                                                    wordmarkNaturalWidth: 0,
                                                    wordmarkNaturalHeight: 0,
                                                })
                                            }
                                            onAltChange={(v) => patch("brand", { wordmarkAlt: v })}
                                        />
                                        <LogoUploadField
                                            kind="lockup"
                                            value={data.brand.lockupUrl}
                                            alt={data.brand.lockupAlt}
                                            naturalWidth={data.brand.lockupNaturalWidth}
                                            naturalHeight={data.brand.lockupNaturalHeight}
                                            onChange={(url, width, height) =>
                                                patch("brand", {
                                                    lockupUrl: url,
                                                    lockupNaturalWidth: width,
                                                    lockupNaturalHeight: height,
                                                })
                                            }
                                            onRemove={() =>
                                                patch("brand", {
                                                    lockupUrl: "",
                                                    lockupNaturalWidth: 0,
                                                    lockupNaturalHeight: 0,
                                                })
                                            }
                                            onAltChange={(v) => patch("brand", { lockupAlt: v })}
                                        />
                                    </div>

                                    <BrandResolutionGuide />
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Announcement text" value={data.announcement.text} onChange={(v) => patch("announcement", { text: v })} />
                                    <Field label="Announcement star" value={data.announcement.star} onChange={(v) => patch("announcement", { star: v })} />
                                </div>
                                <Field label="Announcement extra line" value={data.announcement.extra} onChange={(v) => patch("announcement", { extra: v })} hint="Hidden on mobile, as in the example." />

                                <p className="rounded-lg border bg-muted/20 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
                                    Products and category chips come from active Inventory
                                    listings. Category links are generated from those inventory
                                    categories; the filter field orders them, while the label is
                                    only used for non-category links such as Our story.
                                </p>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold">Desktop navigation</p>
                                        <AddButton
                                            label="Add link"
                                            onClick={() => patch("brand", { nav: [...data.brand.nav, { label: "New link", href: "#collection" }] })}
                                        />
                                    </div>
                                    {data.brand.nav.map((item, index) => (
                                        <ItemShell
                                            key={`${item.label}-${index}`}
                                            index={index}
                                            label="Link"
                                            onUp={() => patch("brand", { nav: moveAt(data.brand.nav, index, -1) })}
                                            onDown={() => patch("brand", { nav: moveAt(data.brand.nav, index, 1) })}
                                            onRemove={() => patch("brand", { nav: data.brand.nav.filter((_, i) => i !== index) })}
                                        >
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <Field label="Label" value={item.label} onChange={(v) => patch("brand", { nav: updateAt<NtNavItem>(data.brand.nav, index, { label: v }) })} />
                                                <Field label="Href" value={item.href} onChange={(v) => patch("brand", { nav: updateAt<NtNavItem>(data.brand.nav, index, { href: v }) })} />
                                                <Field label="Catalogue filter (optional)" value={item.filter || ""} onChange={(v) => patch("brand", { nav: updateAt<NtNavItem>(data.brand.nav, index, { filter: v }) })} hint="e.g. Earrings, Necklaces, Bangles" />
                                            </div>
                                        </ItemShell>
                                    ))}
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold">Mobile navigation</p>
                                        <AddButton
                                            label="Add link"
                                            onClick={() => patch("brand", { mobileNav: [...data.brand.mobileNav, { label: "New link", href: "#collection" }] })}
                                        />
                                    </div>
                                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                                        Category rows are generated automatically from active
                                        inventory categories. Use this list for non-category
                                        links only.
                                    </p>
                                    {data.brand.mobileNav.map((item, index) => (
                                        <ItemShell
                                            key={`${item.label}-mobile-${index}`}
                                            index={index}
                                            label="Mobile link"
                                            onUp={() => patch("brand", { mobileNav: moveAt(data.brand.mobileNav, index, -1) })}
                                            onDown={() => patch("brand", { mobileNav: moveAt(data.brand.mobileNav, index, 1) })}
                                            onRemove={() => patch("brand", { mobileNav: data.brand.mobileNav.filter((_, i) => i !== index) })}
                                        >
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <Field label="Label" value={item.label} onChange={(v) => patch("brand", { mobileNav: updateAt<NtNavItem>(data.brand.mobileNav, index, { label: v }) })} />
                                                <Field label="Href" value={item.href} onChange={(v) => patch("brand", { mobileNav: updateAt<NtNavItem>(data.brand.mobileNav, index, { href: v }) })} />
                                                <Field label="Catalogue filter (optional)" value={item.filter || ""} onChange={(v) => patch("brand", { mobileNav: updateAt<NtNavItem>(data.brand.mobileNav, index, { filter: v }) })} />
                                            </div>
                                        </ItemShell>
                                    ))}
                                </div>

                                <div className="grid gap-3 sm:grid-cols-3">
                                    <Field label="WhatsApp number" value={data.contact.whatsappPhone} onChange={(v) => patch("contact", { whatsappPhone: v })} hint="Used by info-dialog CTAs." />
                                    <Field label="Support email" value={data.contact.supportEmail} onChange={(v) => patch("contact", { supportEmail: v })} />
                                    <Field label="Instagram URL" value={data.contact.instagramUrl} onChange={(v) => patch("contact", { instagramUrl: v })} />
                                </div>
                            </div>
                        )}

                        {tab === "hero" && (
                            <div className="space-y-4">
                                <Field label="Eyebrow" value={data.hero.eyebrow} onChange={(v) => patch("hero", { eyebrow: v })} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Headline line 1" value={data.hero.titleLine1} onChange={(v) => patch("hero", { titleLine1: v })} />
                                    <Field label="Headline line 2 prefix" value={data.hero.titleLine2Prefix} onChange={(v) => patch("hero", { titleLine2Prefix: v })} />
                                    <Field label="Emphasised tail" value={data.hero.titleEmphasis} onChange={(v) => patch("hero", { titleEmphasis: v })} />
                                </div>
                                <Area label="Description" value={data.hero.description} onChange={(v) => patch("hero", { description: v })} rows={3} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Primary CTA" value={data.hero.primaryCta} onChange={(v) => patch("hero", { primaryCta: v })} />
                                    <Field label="Primary CTA link" value={data.hero.primaryHref} onChange={(v) => patch("hero", { primaryHref: v })} />
                                    <Field label="Secondary CTA" value={data.hero.secondaryCta} onChange={(v) => patch("hero", { secondaryCta: v })} />
                                    <Field label="Secondary CTA link" value={data.hero.secondaryHref} onChange={(v) => patch("hero", { secondaryHref: v })} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Note title" value={data.hero.noteTitle} onChange={(v) => patch("hero", { noteTitle: v })} />
                                    <Field label="Note text" value={data.hero.noteText} onChange={(v) => patch("hero", { noteText: v })} />
                                </div>
                                <ImageField
                                    label="Hero image"
                                    value={data.hero.imageUrl}
                                    onChange={(v) => patch("hero", { imageUrl: v })}
                                    recommended="1600 × 2000 px portrait (4:5) or larger"
                                    minWidth={900}
                                    maxKb={1200}
                                    hint="The hero crops to a portrait frame; keep the subject centred and leave room around the face."
                                />
                                <Field label="Hero image alt text" value={data.hero.imageAlt} onChange={(v) => patch("hero", { imageAlt: v })} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Image caption label" value={data.hero.imageCaptionLabel} onChange={(v) => patch("hero", { imageCaptionLabel: v })} />
                                    <Field label="Image caption line" value={data.hero.imageCaptionText} onChange={(v) => patch("hero", { imageCaptionText: v })} />
                                    <Field label="Glass tag title" value={data.hero.imageTagTitle} onChange={(v) => patch("hero", { imageTagTitle: v })} />
                                    <Field label="Glass tag small line" value={data.hero.imageTagSub} onChange={(v) => patch("hero", { imageTagSub: v })} />
                                    <Field label="Glass tag link" value={data.hero.imageTagHref} onChange={(v) => patch("hero", { imageTagHref: v })} />
                                    <Field label="Vertical caption" value={data.hero.verticalCaption} onChange={(v) => patch("hero", { verticalCaption: v })} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Bottom microcopy" value={data.hero.bottomText} onChange={(v) => patch("hero", { bottomText: v })} />
                                    <Field label="Scroll button label" value={data.hero.scrollLabel} onChange={(v) => patch("hero", { scrollLabel: v })} />
                                </div>

                                <div className="space-y-4 rounded-xl border bg-muted/20 p-3.5">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <p className="text-xs font-semibold">Hero slideshow</p>
                                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                                Optional. When enabled with slides, the single image
                                                above becomes the fallback. Every slide can have its
                                                own image, caption, glass tag and vertical caption.
                                                New slides inherit the single-image copy until you
                                                override a field.
                                            </p>
                                        </div>
                                        <Toggle
                                            label="Enable slideshow"
                                            checked={data.hero.slideshow.enabled}
                                            onChange={(v) =>
                                                patch("hero", {
                                                    slideshow: {
                                                        ...data.hero.slideshow,
                                                        enabled: v,
                                                    },
                                                })
                                            }
                                            hint="When off, the single image above is used."
                                        />
                                    </div>

                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <SelectField
                                            label="Autoplay interval"
                                            value={String(data.hero.slideshow.intervalSeconds)}
                                            onChange={(v) =>
                                                patch("hero", {
                                                    slideshow: {
                                                        ...data.hero.slideshow,
                                                        intervalSeconds: Number(v) || 6,
                                                    },
                                                })
                                            }
                                            options={[3, 4, 5, 6, 8, 10, 12, 15].map((seconds) => ({
                                                value: String(seconds),
                                                label: `${seconds} seconds`,
                                            }))}
                                            hint="Autoplay pauses on hover or focus and respects reduced-motion preferences."
                                        />
                                        <div className="flex items-end">
                                            <AddButton label="Add slide" onClick={addHeroSlide} />
                                        </div>
                                    </div>

                                    {data.hero.slideshow.enabled &&
                                    data.hero.slides.length === 0 ? (
                                        <p className="text-[10px] text-amber-600">
                                            Add at least one slide, or the single image above
                                            will keep rendering.
                                        </p>
                                    ) : null}

                                    {data.hero.slides.map((slide, index) => (
                                        <ItemShell
                                            key={slide.id || index}
                                            index={index}
                                            label="Slide"
                                            onUp={() =>
                                                patch("hero", {
                                                    slides: moveAt(data.hero.slides, index, -1),
                                                })
                                            }
                                            onDown={() =>
                                                patch("hero", {
                                                    slides: moveAt(data.hero.slides, index, 1),
                                                })
                                            }
                                            onRemove={() =>
                                                patch("hero", {
                                                    slides: data.hero.slides.filter(
                                                        (_, slideIndex) => slideIndex !== index
                                                    ),
                                                })
                                            }
                                        >
                                            <ImageField
                                                label={`Slide ${index + 1} image`}
                                                value={slide.imageUrl}
                                                onChange={(v) =>
                                                    patch("hero", {
                                                        slides: updateAt<NtHeroSlide>(
                                                            data.hero.slides,
                                                            index,
                                                            { imageUrl: v }
                                                        ),
                                                    })
                                                }
                                                recommended="1600 × 2000 px portrait (4:5) or larger"
                                                minWidth={900}
                                                maxKb={1000}
                                                hint="Leave the caption and tag fields empty to fall back to the single-image copy above."
                                            />
                                            <Field
                                                label="Alt text"
                                                value={slide.imageAlt}
                                                onChange={(v) =>
                                                    patch("hero", {
                                                        slides: updateAt<NtHeroSlide>(
                                                            data.hero.slides,
                                                            index,
                                                            { imageAlt: v }
                                                        ),
                                                    })
                                                }
                                            />
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <Field
                                                    label="Caption label"
                                                    value={slide.captionLabel}
                                                    onChange={(v) =>
                                                        patch("hero", {
                                                            slides: updateAt<NtHeroSlide>(
                                                                data.hero.slides,
                                                                index,
                                                                { captionLabel: v }
                                                            ),
                                                        })
                                                    }
                                                />
                                                <Field
                                                    label="Caption line"
                                                    value={slide.captionText}
                                                    onChange={(v) =>
                                                        patch("hero", {
                                                            slides: updateAt<NtHeroSlide>(
                                                                data.hero.slides,
                                                                index,
                                                                { captionText: v }
                                                            ),
                                                        })
                                                    }
                                                />
                                                <Field
                                                    label="Glass tag title"
                                                    value={slide.tagTitle}
                                                    onChange={(v) =>
                                                        patch("hero", {
                                                            slides: updateAt<NtHeroSlide>(
                                                                data.hero.slides,
                                                                index,
                                                                { tagTitle: v }
                                                            ),
                                                        })
                                                    }
                                                />
                                                <Field
                                                    label="Glass tag small line"
                                                    value={slide.tagSub}
                                                    onChange={(v) =>
                                                        patch("hero", {
                                                            slides: updateAt<NtHeroSlide>(
                                                                data.hero.slides,
                                                                index,
                                                                { tagSub: v }
                                                            ),
                                                        })
                                                    }
                                                />
                                                <Field
                                                    label="Glass tag link"
                                                    value={slide.tagHref}
                                                    onChange={(v) =>
                                                        patch("hero", {
                                                            slides: updateAt<NtHeroSlide>(
                                                                data.hero.slides,
                                                                index,
                                                                { tagHref: v }
                                                            ),
                                                        })
                                                    }
                                                />
                                                <Field
                                                    label="Vertical caption"
                                                    value={slide.verticalCaption}
                                                    onChange={(v) =>
                                                        patch("hero", {
                                                            slides: updateAt<NtHeroSlide>(
                                                                data.hero.slides,
                                                                index,
                                                                { verticalCaption: v }
                                                            ),
                                                        })
                                                    }
                                                />
                                            </div>
                                        </ItemShell>
                                    ))}
                                </div>
                            </div>
                        )}

                        {tab === "promise" && (
                            <div className="space-y-4">
                                <p className="text-xs text-muted-foreground">
                                    Three promises form the social-proof strip under the hero. Icons:
                                    heritage, moments, gift.
                                </p>
                                <div className="space-y-3">
                                    <AddButton label="Add promise" onClick={() => patch("promise", { items: [...data.promise.items, { icon: "heritage", text: "New promise" }] })} />
                                    {data.promise.items.map((item, index) => (
                                        <ItemShell
                                            key={`${item.icon}-${index}`}
                                            index={index}
                                            label="Promise"
                                            onUp={() => patch("promise", { items: moveAt(data.promise.items, index, -1) })}
                                            onDown={() => patch("promise", { items: moveAt(data.promise.items, index, 1) })}
                                            onRemove={() => patch("promise", { items: data.promise.items.filter((_, i) => i !== index) })}
                                        >
                                            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                                                <SelectField
                                                    label="Icon"
                                                    value={item.icon}
                                                    onChange={(v) => patch("promise", { items: updateAt<NtPromiseItem>(data.promise.items, index, { icon: v as NtPromiseItem["icon"] }) })}
                                                    options={[
                                                        { value: "heritage", label: "Heritage diamond" },
                                                        { value: "moments", label: "Heart / moments" },
                                                        { value: "gift", label: "Gift" },
                                                    ]}
                                                />
                                                <Field label="Promise text" value={item.text} onChange={(v) => patch("promise", { items: updateAt<NtPromiseItem>(data.promise.items, index, { text: v }) })} />
                                            </div>
                                        </ItemShell>
                                    ))}
                                </div>
                            </div>
                        )}

                        {tab === "collection" && (
                            <div className="space-y-4">
                                <p className="rounded-lg border bg-muted/20 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
                                    The product grid and category chips are loaded live
                                    from active Inventory listings for{" "}
                                    <strong className="text-foreground">
                                        {inventoryTenant || "the bound tenant"}
                                    </strong>
                                    . The copy below only controls presentation; category
                                    names, product names, prices and images are never
                                    hardcoded.
                                </p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Eyebrow" value={data.collection.eyebrow} onChange={(v) => patch("collection", { eyebrow: v })} />
                                    <Field label="Heading line" value={data.collection.headingLine1} onChange={(v) => patch("collection", { headingLine1: v })} />
                                    <Field label="Heading emphasis" value={data.collection.headingEmphasis} onChange={(v) => patch("collection", { headingEmphasis: v })} />
                                    <Field label="All-pieces filter label" value={data.collection.allLabel} onChange={(v) => patch("collection", { allLabel: v })} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Supporting line 1" value={data.collection.supportingLine1} onChange={(v) => patch("collection", { supportingLine1: v })} />
                                    <Field label="Supporting line 2" value={data.collection.supportingLine2} onChange={(v) => patch("collection", { supportingLine2: v })} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Count template (singular)" value={data.collection.countSingular} onChange={(v) => patch("collection", { countSingular: v })} hint="Use {count} for the number." />
                                    <Field label="Count template (plural)" value={data.collection.countPlural} onChange={(v) => patch("collection", { countPlural: v })} hint="Use {count} for the number." />
                                    <Field label="Footer left" value={data.collection.footLeft} onChange={(v) => patch("collection", { footLeft: v })} />
                                    <Field label="Footer right prefix" value={data.collection.footRightPrefix} onChange={(v) => patch("collection", { footRightPrefix: v })} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <Field label="Price fallback" value={data.collection.minPriceFallback} onChange={(v) => patch("collection", { minPriceFallback: v })} />
                                    <Field label="Badge fallback" value={data.collection.productBadgeFallback} onChange={(v) => patch("collection", { productBadgeFallback: v })} />
                                    <Field label="Product type suffix" value={data.collection.productTypeSuffix} onChange={(v) => patch("collection", { productTypeSuffix: v })} />
                                    <Field label="Quick-view label" value={data.collection.quickViewLabel} onChange={(v) => patch("collection", { quickViewLabel: v })} />
                                    <Field label="Add button label" value={data.collection.addLabel} onChange={(v) => patch("collection", { addLabel: v })} />
                                    <Field label="Sold-out label" value={data.collection.soldOutLabel} onChange={(v) => patch("collection", { soldOutLabel: v })} />
                                    <Field label="Price unit: pair" value={data.collection.priceUnitPair} onChange={(v) => patch("collection", { priceUnitPair: v })} />
                                    <Field label="Price unit: single" value={data.collection.priceUnitSingle} onChange={(v) => patch("collection", { priceUnitSingle: v })} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Loading label" value={data.collection.loadingLabel} onChange={(v) => patch("collection", { loadingLabel: v })} />
                                    <Field label="Empty label" value={data.collection.emptyLabel} onChange={(v) => patch("collection", { emptyLabel: v })} />
                                </div>
                            </div>
                        )}

                        {tab === "promo" && (
                            <div className="space-y-4">
                                <Toggle label="Show promo band" checked={data.promo.enabled} onChange={(v) => patch("promo", { enabled: v })} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Eyebrow" value={data.promo.eyebrow} onChange={(v) => patch("promo", { eyebrow: v })} />
                                    <Field label="Heading line" value={data.promo.headingPlain} onChange={(v) => patch("promo", { headingPlain: v })} />
                                    <Field label="Heading emphasis" value={data.promo.headingEmphasis} onChange={(v) => patch("promo", { headingEmphasis: v })} />
                                    <Field label="Discount badge" value={data.promo.discount} onChange={(v) => patch("promo", { discount: v })} />
                                    <Field
                                        label="Coupon code"
                                        value={data.promo.code}
                                        onChange={(v) => patch("promo", { code: v })}
                                        hint="Checkout currently accepts FESTIVE10 (10% above ₹1,499) and MYCART49 (₹49 above ₹799); other codes will be rejected at checkout."
                                    />
                                    <Field label="Description" value={data.promo.description} onChange={(v) => patch("promo", { description: v })} />
                                    <Field label="Copy button" value={data.promo.ctaLabel} onChange={(v) => patch("promo", { ctaLabel: v })} />
                                    <Field label="Copied state" value={data.promo.copiedLabel} onChange={(v) => patch("promo", { copiedLabel: v })} />
                                </div>
                                <Area label="Small note" value={data.promo.note} onChange={(v) => patch("promo", { note: v })} rows={2} />
                            </div>
                        )}

                        {tab === "story" && (
                            <div className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Eyebrow" value={data.story.eyebrow} onChange={(v) => patch("story", { eyebrow: v })} />
                                    <Field label="CTA label" value={data.story.cta} onChange={(v) => patch("story", { cta: v })} />
                                    <Field label="Heading plain" value={data.story.headingPlain} onChange={(v) => patch("story", { headingPlain: v })} />
                                    <Field label="Heading emphasis" value={data.story.headingEmphasis} onChange={(v) => patch("story", { headingEmphasis: v })} />
                                </div>
                                <Area label="Paragraph 1" value={data.story.paragraph1} onChange={(v) => patch("story", { paragraph1: v })} rows={3} />
                                <Area label="Paragraph 2" value={data.story.paragraph2} onChange={(v) => patch("story", { paragraph2: v })} rows={3} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="CTA link" value={data.story.ctaHref} onChange={(v) => patch("story", { ctaHref: v })} />
                                    <Field label="Signature" value={data.story.signature} onChange={(v) => patch("story", { signature: v })} />
                                    <Field label="Stamp top" value={data.story.stampTop} onChange={(v) => patch("story", { stampTop: v })} />
                                    <Field label="Stamp bottom" value={data.story.stampBottom} onChange={(v) => patch("story", { stampBottom: v })} />
                                    <Field label="Photo caption" value={data.story.photoCaption} onChange={(v) => patch("story", { photoCaption: v })} />
                                </div>
                                <ImageField
                                    label="Story image"
                                    value={data.story.imageUrl}
                                    onChange={(v) => patch("story", { imageUrl: v })}
                                    recommended="1200 × 1200 px square, or 1200 × 1500 px portrait; the frame crops to about 596 × 756 px"
                                    minWidth={800}
                                    maxKb={900}
                                    hint="The stamp and photo caption sit over the image; keep important details away from the edges."
                                />
                                <Field label="Story image alt text" value={data.story.imageAlt} onChange={(v) => patch("story", { imageAlt: v })} />
                            </div>
                        )}

                        {tab === "benefits" && (
                            <div className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Eyebrow" value={data.benefits.eyebrow} onChange={(v) => patch("benefits", { eyebrow: v })} />
                                    <Field label="Heading plain" value={data.benefits.headingPlain} onChange={(v) => patch("benefits", { headingPlain: v })} />
                                    <Field label="Heading emphasis" value={data.benefits.headingEmphasis} onChange={(v) => patch("benefits", { headingEmphasis: v })} />
                                </div>
                                <AddButton label="Add benefit" onClick={() => patch("benefits", { items: [...data.benefits.items, { icon: "sparkle", title: "New benefit", text: "" }] })} />
                                {data.benefits.items.map((item, index) => (
                                    <ItemShell
                                        key={`${item.title}-${index}`}
                                        index={index}
                                        label="Benefit"
                                        onUp={() => patch("benefits", { items: moveAt(data.benefits.items, index, -1) })}
                                        onDown={() => patch("benefits", { items: moveAt(data.benefits.items, index, 1) })}
                                        onRemove={() => patch("benefits", { items: data.benefits.items.filter((_, i) => i !== index) })}
                                    >
                                        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                                            <SelectField
                                                label="Icon"
                                                value={item.icon}
                                                onChange={(v) => patch("benefits", { items: updateAt<NtBenefitItem>(data.benefits.items, index, { icon: v as NtBenefitItem["icon"] }) })}
                                                options={[
                                                    { value: "heritage", label: "Heritage motif" },
                                                    { value: "sparkle", label: "Sparkle" },
                                                    { value: "gift", label: "Gift" },
                                                ]}
                                            />
                                            <Field label="Title" value={item.title} onChange={(v) => patch("benefits", { items: updateAt<NtBenefitItem>(data.benefits.items, index, { title: v }) })} />
                                        </div>
                                        <Area label="Text" value={item.text} onChange={(v) => patch("benefits", { items: updateAt<NtBenefitItem>(data.benefits.items, index, { text: v }) })} rows={2} />
                                    </ItemShell>
                                ))}
                            </div>
                        )}

                        {tab === "testimonials" && (
                            <div className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Eyebrow" value={data.testimonials.eyebrow} onChange={(v) => patch("testimonials", { eyebrow: v })} />
                                    <Field label="Heading plain" value={data.testimonials.headingPlain} onChange={(v) => patch("testimonials", { headingPlain: v })} />
                                    <Field label="Heading emphasis" value={data.testimonials.headingEmphasis} onChange={(v) => patch("testimonials", { headingEmphasis: v })} />
                                    <Field label="Stars" value={data.testimonials.stars} onChange={(v) => patch("testimonials", { stars: v })} />
                                    <Field label="Note line" value={data.testimonials.noteLine} onChange={(v) => patch("testimonials", { noteLine: v })} />
                                    <Field label="Small note" value={data.testimonials.note} onChange={(v) => patch("testimonials", { note: v })} />
                                </div>
                                <AddButton label="Add story" onClick={() => patch("testimonials", { items: [...data.testimonials.items, { quote: "", authorLabel: "", authorTitle: "", avatar: "" }] })} />
                                {data.testimonials.items.map((item, index) => (
                                    <ItemShell
                                        key={`${item.authorLabel}-${index}`}
                                        index={index}
                                        label="Story"
                                        onUp={() => patch("testimonials", { items: moveAt(data.testimonials.items, index, -1) })}
                                        onDown={() => patch("testimonials", { items: moveAt(data.testimonials.items, index, 1) })}
                                        onRemove={() => patch("testimonials", { items: data.testimonials.items.filter((_, i) => i !== index) })}
                                    >
                                        <Area label="Quote" value={item.quote} onChange={(v) => patch("testimonials", { items: updateAt<NtTestimonial>(data.testimonials.items, index, { quote: v }) })} rows={3} />
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <Field label="Author label" value={item.authorLabel} onChange={(v) => patch("testimonials", { items: updateAt<NtTestimonial>(data.testimonials.items, index, { authorLabel: v }) })} />
                                            <Field label="Author subtitle" value={item.authorTitle} onChange={(v) => patch("testimonials", { items: updateAt<NtTestimonial>(data.testimonials.items, index, { authorTitle: v }) })} />
                                            <Field label="Avatar letter" value={item.avatar} onChange={(v) => patch("testimonials", { items: updateAt<NtTestimonial>(data.testimonials.items, index, { avatar: v }) })} hint="One or two characters inside the circular monogram." />
                                        </div>
                                    </ItemShell>
                                ))}
                            </div>
                        )}

                        {tab === "instagram" && (
                            <div className="space-y-4">
                                <Toggle label="Show Instagram section" checked={data.instagram.enabled} onChange={(v) => patch("instagram", { enabled: v })} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Eyebrow" value={data.instagram.eyebrow} onChange={(v) => patch("instagram", { eyebrow: v })} />
                                    <Field label="Heading" value={data.instagram.heading} onChange={(v) => patch("instagram", { heading: v })} />
                                    <Field label="Handle" value={data.instagram.handle} onChange={(v) => patch("instagram", { handle: v })} />
                                    <Field label="CTA label" value={data.instagram.ctaLabel} onChange={(v) => patch("instagram", { ctaLabel: v })} />
                                    <Field label="CTA URL" value={data.instagram.ctaHref} onChange={(v) => patch("instagram", { ctaHref: v })} hint="Leave empty to hide the follow link." />
                                </div>
                                <AddButton label="Add post" onClick={() => patch("instagram", { posts: [...data.instagram.posts, { id: `post-${Date.now()}`, imageUrl: "/instagram/post-1.jpg", url: "", caption: "", type: "post" }] })} />
                                {data.instagram.posts.map((post, index) => (
                                    <ItemShell
                                        key={`${post.id}-${index}`}
                                        index={index}
                                        label="Post"
                                        onUp={() => patch("instagram", { posts: moveAt(data.instagram.posts, index, -1) })}
                                        onDown={() => patch("instagram", { posts: moveAt(data.instagram.posts, index, 1) })}
                                        onRemove={() => patch("instagram", { posts: data.instagram.posts.filter((_, i) => i !== index) })}
                                    >
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <SelectField
                                                label="Type"
                                                value={post.type}
                                                onChange={(v) => patch("instagram", { posts: updateAt<NtInstagramPost>(data.instagram.posts, index, { type: v as NtInstagramPost["type"] }) })}
                                                options={[
                                                    { value: "post", label: "Post" },
                                                    { value: "reel", label: "Reel" },
                                                ]}
                                            />
                                            <Field label="Post URL" value={post.url} onChange={(v) => patch("instagram", { posts: updateAt<NtInstagramPost>(data.instagram.posts, index, { url: v }) })} />
                                        </div>
                                        <ImageField
                                            label="Image"
                                            value={post.imageUrl}
                                            onChange={(v) =>
                                                patch("instagram", {
                                                    posts: updateAt<NtInstagramPost>(
                                                        data.instagram.posts,
                                                        index,
                                                        { imageUrl: v }
                                                    ),
                                                })
                                            }
                                            recommended="1080 × 1350 px portrait (4:5)"
                                            minWidth={600}
                                            maxKb={600}
                                            hint="Posts display in a 4:5 card; the caption overlays the bottom of the image."
                                        />
                                        <Area label="Caption" value={post.caption} onChange={(v) => patch("instagram", { posts: updateAt<NtInstagramPost>(data.instagram.posts, index, { caption: v }) })} rows={2} />
                                    </ItemShell>
                                ))}
                            </div>
                        )}

                        {tab === "pricing" && (
                            <div className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Eyebrow" value={data.pricing.eyebrow} onChange={(v) => patch("pricing", { eyebrow: v })} />
                                    <Field label="Heading plain" value={data.pricing.headingPlain} onChange={(v) => patch("pricing", { headingPlain: v })} />
                                    <Field label="Heading emphasis" value={data.pricing.headingEmphasis} onChange={(v) => patch("pricing", { headingEmphasis: v })} />
                                    <Field label="CTA" value={data.pricing.cta} onChange={(v) => patch("pricing", { cta: v })} />
                                    <Field label="CTA link" value={data.pricing.ctaHref} onChange={(v) => patch("pricing", { ctaHref: v })} />
                                </div>
                                <Area label="Description" value={data.pricing.text} onChange={(v) => patch("pricing", { text: v })} rows={3} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Anchor label" value={data.pricing.anchorLabel} onChange={(v) => patch("pricing", { anchorLabel: v })} />
                                    <Field label="Anchor note" value={data.pricing.anchorNote} onChange={(v) => patch("pricing", { anchorNote: v })} />
                                    <Field label="Currency symbol" value={data.pricing.currency} onChange={(v) => patch("pricing", { currency: v })} />
                                    <Field
                                        label="Price override"
                                        value={data.pricing.priceOverride}
                                        onChange={(v) => patch("pricing", { priceOverride: v })}
                                        hint="Blank uses the lowest live catalogue price; if no products are available, the Collection tab's price fallback is shown."
                                    />
                                </div>
                                <AddButton label="Add value card" onClick={() => patch("pricing", { items: [...data.pricing.items, { icon: "tag", title: "New promise", text: "" }] })} />
                                {data.pricing.items.map((item, index) => (
                                    <ItemShell
                                        key={`${item.title}-${index}`}
                                        index={index}
                                        label="Value card"
                                        onUp={() => patch("pricing", { items: moveAt(data.pricing.items, index, -1) })}
                                        onDown={() => patch("pricing", { items: moveAt(data.pricing.items, index, 1) })}
                                        onRemove={() => patch("pricing", { items: data.pricing.items.filter((_, i) => i !== index) })}
                                    >
                                        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                                            <SelectField
                                                label="Icon"
                                                value={item.icon}
                                                onChange={(v) => patch("pricing", { items: updateAt<NtPricingItem>(data.pricing.items, index, { icon: v as NtPricingItem["icon"] }) })}
                                                options={[
                                                    { value: "tag", label: "Price tag" },
                                                    { value: "gift", label: "Gift" },
                                                    { value: "truck", label: "Delivery" },
                                                ]}
                                            />
                                            <Field label="Title" value={item.title} onChange={(v) => patch("pricing", { items: updateAt<NtPricingItem>(data.pricing.items, index, { title: v }) })} />
                                        </div>
                                        <Area label="Text" value={item.text} onChange={(v) => patch("pricing", { items: updateAt<NtPricingItem>(data.pricing.items, index, { text: v }) })} rows={2} />
                                    </ItemShell>
                                ))}
                                <Field label="Footer note" value={data.pricing.footNote} onChange={(v) => patch("pricing", { footNote: v })} />
                            </div>
                        )}

                        {tab === "faq" && (
                            <div className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Eyebrow" value={data.faq.eyebrow} onChange={(v) => patch("faq", { eyebrow: v })} />
                                    <Field label="Heading plain" value={data.faq.headingPlain} onChange={(v) => patch("faq", { headingPlain: v })} />
                                    <Field label="Heading emphasis" value={data.faq.headingEmphasis} onChange={(v) => patch("faq", { headingEmphasis: v })} />
                                    <Field label="Decoration" value={data.faq.decoration} onChange={(v) => patch("faq", { decoration: v })} />
                                </div>
                                <Area label="Intro text" value={data.faq.text} onChange={(v) => patch("faq", { text: v })} rows={2} />
                                <AddButton label="Add question" onClick={() => patch("faq", { items: [...data.faq.items, { question: "New question", answer: "" }] })} />
                                {data.faq.items.map((item, index) => (
                                    <ItemShell
                                        key={`${item.question}-${index}`}
                                        index={index}
                                        label="Question"
                                        onUp={() => patch("faq", { items: moveAt(data.faq.items, index, -1) })}
                                        onDown={() => patch("faq", { items: moveAt(data.faq.items, index, 1) })}
                                        onRemove={() => patch("faq", { items: data.faq.items.filter((_, i) => i !== index) })}
                                    >
                                        <Field label="Question" value={item.question} onChange={(v) => patch("faq", { items: updateAt(data.faq.items, index, { question: v }) })} />
                                        <Area label="Answer" value={item.answer} onChange={(v) => patch("faq", { items: updateAt(data.faq.items, index, { answer: v }) })} rows={3} />
                                    </ItemShell>
                                ))}
                            </div>
                        )}

                        {tab === "finalCta" && (
                            <div className="space-y-4">
                                <Field label="Eyebrow" value={data.finalCta.eyebrow} onChange={(v) => patch("finalCta", { eyebrow: v })} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Heading plain" value={data.finalCta.headingPlain} onChange={(v) => patch("finalCta", { headingPlain: v })} />
                                    <Field label="Heading emphasis" value={data.finalCta.headingEmphasis} onChange={(v) => patch("finalCta", { headingEmphasis: v })} />
                                    <Field label="CTA" value={data.finalCta.cta} onChange={(v) => patch("finalCta", { cta: v })} />
                                    <Field label="CTA link" value={data.finalCta.ctaHref} onChange={(v) => patch("finalCta", { ctaHref: v })} />
                                </div>
                                <Area label="Text" value={data.finalCta.text} onChange={(v) => patch("finalCta", { text: v })} rows={2} />
                                <Field
                                    label="Flower / decoration"
                                    value={data.finalCta.decoration}
                                    onChange={(v) => patch("finalCta", { decoration: v })}
                                    hint="Decorative glyph above the eyebrow. Set empty to hide it."
                                />
                            </div>
                        )}

                        {tab === "footer" && (
                            <div className="space-y-4">
                                <p className="text-[10px] leading-relaxed text-muted-foreground">
                                    Brand name, tagline, logo and wordmark live under
                                    Brand &amp; Navigation. Everything else in the footer is
                                    edited here. Link rows with a catalogue filter are
                                    regenerated from active inventory categories; the filter
                                    field orders them and their labels come from inventory.
                                </p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Description line 1" value={data.footer.descriptionLine1} onChange={(v) => patch("footer", { descriptionLine1: v })} />
                                    <Field label="Description line 2" value={data.footer.descriptionLine2} onChange={(v) => patch("footer", { descriptionLine2: v })} />
                                    <Field label="Location line" value={data.footer.location} onChange={(v) => patch("footer", { location: v })} />
                                    <Field label="Saved-favourites label" value={data.footer.savedLabel} onChange={(v) => patch("footer", { savedLabel: v })} />
                                </div>
                                {data.footer.columns.map((column, columnIndex) => (
                                    <div className="space-y-3 rounded-xl border bg-background p-3.5" key={`${column.title}-${columnIndex}`}>
                                        <Field label={`Column ${columnIndex + 1} title`} value={column.title} onChange={(v) => patch("footer", { columns: updateAt(data.footer.columns, columnIndex, { title: v }) })} />
                                        <AddButton
                                            label="Add link"
                                            onClick={() =>
                                                patch("footer", {
                                                    columns: updateAt(data.footer.columns, columnIndex, {
                                                        links: [...column.links, { label: "New link", href: "#collection", action: "none" }],
                                                    }),
                                                })
                                            }
                                        />
                                        {column.links.map((link, linkIndex) => (
                                            <ItemShell
                                                key={`${link.label}-${linkIndex}`}
                                                index={linkIndex}
                                                label="Link"
                                                onUp={() => patch("footer", { columns: updateAt(data.footer.columns, columnIndex, { links: moveAt(column.links, linkIndex, -1) }) })}
                                                onDown={() => patch("footer", { columns: updateAt(data.footer.columns, columnIndex, { links: moveAt(column.links, linkIndex, 1) }) })}
                                                onRemove={() => patch("footer", { columns: updateAt(data.footer.columns, columnIndex, { links: column.links.filter((_, i) => i !== linkIndex) }) })}
                                            >
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <Field label="Label" value={link.label} onChange={(v) => patch("footer", { columns: updateAt(data.footer.columns, columnIndex, { links: updateAt<NtFooterLink>(column.links, linkIndex, { label: v }) }) })} />
                                                    <Field label="Href" value={link.href} onChange={(v) => patch("footer", { columns: updateAt(data.footer.columns, columnIndex, { links: updateAt<NtFooterLink>(column.links, linkIndex, { href: v }) }) })} />
                                                    <SelectField
                                                        label="Action"
                                                        value={link.action}
                                                        onChange={(v) => patch("footer", { columns: updateAt(data.footer.columns, columnIndex, { links: updateAt<NtFooterLink>(column.links, linkIndex, { action: v as NtFooterLink["action"] }) }) })}
                                                        options={[
                                                            { value: "none", label: "Navigate" },
                                                            { value: "saved", label: "Open saved" },
                                                            { value: "shipping", label: "Open shipping" },
                                                            { value: "privacy", label: "Open privacy" },
                                                            { value: "care", label: "Open care" },
                                                            { value: "search", label: "Open search" },
                                                        ]}
                                                    />
                                                    <Field label="Catalogue filter (optional)" value={link.filter || ""} onChange={(v) => patch("footer", { columns: updateAt(data.footer.columns, columnIndex, { links: updateAt<NtFooterLink>(column.links, linkIndex, { filter: v }) }) })} />
                                                </div>
                                            </ItemShell>
                                        ))}
                                    </div>
                                ))}
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Note top line" value={data.footer.noteTop} onChange={(v) => patch("footer", { noteTop: v })} />
                                    <Field label="Note line 1" value={data.footer.noteLine1} onChange={(v) => patch("footer", { noteLine1: v })} />
                                    <Field label="Note line 2" value={data.footer.noteLine2} onChange={(v) => patch("footer", { noteLine2: v })} />
                                    <Field label="Note emphasis" value={data.footer.noteEmphasis} onChange={(v) => patch("footer", { noteEmphasis: v })} />
                                    <Field
                                        label="Note accent"
                                        value={data.footer.noteAccent}
                                        onChange={(v) => patch("footer", { noteAccent: v })}
                                        hint="Decorative glyphs under the note. Spaces are preserved; set empty to hide."
                                    />
                                    <Field label="Bottom left" value={data.footer.bottomLeft} onChange={(v) => patch("footer", { bottomLeft: v })} hint="{year} is replaced automatically." />
                                    <Field label="Bottom right" value={data.footer.bottomRight} onChange={(v) => patch("footer", { bottomRight: v })} />
                                    <Field
                                        label="Bottom-right accent"
                                        value={data.footer.bottomRightAccent}
                                        onChange={(v) => patch("footer", { bottomRightAccent: v })}
                                        hint="Set empty to hide the trailing glyph."
                                    />
                                </div>
                                <Area label="Legal / studio note" value={data.footer.legalNote} onChange={(v) => patch("footer", { legalNote: v })} rows={2} />
                            </div>
                        )}

                        {tab === "info" && (
                            <div className="space-y-5">
                                {(["shipping", "privacy", "care"] as const).map((key) => (
                                    <div className="space-y-3 rounded-xl border bg-background p-3.5" key={key}>
                                        <p className="text-xs font-semibold capitalize">{key}</p>
                                        <Field label="Dialog title" value={data.info[key].title} onChange={(v) => patch("info", { [key]: { ...data.info[key], title: v } })} />
                                        <Area label="Body" value={data.info[key].body} onChange={(v) => patch("info", { [key]: { ...data.info[key], body: v } })} rows={6} hint="Separate paragraphs with a blank line." />
                                        <Field label="CTA label" value={data.info[key].cta} onChange={(v) => patch("info", { [key]: { ...data.info[key], cta: v } })} />
                                    </div>
                                ))}
                            </div>
                        )}

                        {tab === "commerce" && (
                            <div className="space-y-4">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Search dialog title" value={data.ui.searchTitle} onChange={(v) => patch("ui", { searchTitle: v })} />
                                    <Field label="Search placeholder" value={data.ui.searchPlaceholder} onChange={(v) => patch("ui", { searchPlaceholder: v })} />
                                    <Field label="Saved dialog title" value={data.ui.savedTitle} onChange={(v) => patch("ui", { savedTitle: v })} />
                                    <Field label="Close label" value={data.ui.closeLabel} onChange={(v) => patch("ui", { closeLabel: v })} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Area label="Search empty state" value={data.ui.searchEmpty} onChange={(v) => patch("ui", { searchEmpty: v })} rows={2} />
                                    <Area label="Saved empty state" value={data.ui.savedEmpty} onChange={(v) => patch("ui", { savedEmpty: v })} rows={2} />
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Bag eyebrow" value={data.ui.cartEyebrow} onChange={(v) => patch("ui", { cartEyebrow: v })} />
                                    <Field label="Bag title" value={data.ui.cartTitle} onChange={(v) => patch("ui", { cartTitle: v })} />
                                    <Field label="Empty bag title" value={data.ui.cartEmptyTitle} onChange={(v) => patch("ui", { cartEmptyTitle: v })} />
                                    <Field label="Empty bag CTA" value={data.ui.cartEmptyCta} onChange={(v) => patch("ui", { cartEmptyCta: v })} />
                                    <Field label="Subtotal label" value={data.ui.cartSubtotal} onChange={(v) => patch("ui", { cartSubtotal: v })} />
                                    <Field label="Checkout button" value={data.ui.cartCheckout} onChange={(v) => patch("ui", { cartCheckout: v })} />
                                </div>
                                <Area label="Empty bag text" value={data.ui.cartEmptyText} onChange={(v) => patch("ui", { cartEmptyText: v })} rows={2} />
                                <Area label="Bag note" value={data.ui.cartNote} onChange={(v) => patch("ui", { cartNote: v })} rows={2} />
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Product add button" value={data.ui.productAdd} onChange={(v) => patch("ui", { productAdd: v })} />
                                    <Field label="Product added state" value={data.ui.productAdded} onChange={(v) => patch("ui", { productAdded: v })} />
                                    <Field label="Bangle size label" value={data.ui.productSizeLabel} onChange={(v) => patch("ui", { productSizeLabel: v })} />
                                    <Field label="Option label" value={data.ui.productOptionLabel} onChange={(v) => patch("ui", { productOptionLabel: v })} />
                                </div>
                                <Area label="Product note" value={data.ui.productNote} onChange={(v) => patch("ui", { productNote: v })} rows={2} />
                            </div>
                        )}

                        {tab === "theme" && (
                            <div className="space-y-5">
                                <div>
                                    <p className="mb-2 text-xs font-semibold">Palette presets</p>
                                    <div className="flex flex-wrap gap-2">
                                        {PALETTES.map((palette) => (
                                            <button
                                                key={palette.name}
                                                type="button"
                                                onClick={() => patch("theme", { colors: palette.colors })}
                                                className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs transition hover:border-primary"
                                            >
                                                <span className="flex overflow-hidden rounded-full border">
                                                    {[palette.colors.cream, palette.colors.green, palette.colors.gold, palette.colors.ink].map((color) => (
                                                        <span key={color} className="h-3.5 w-3.5" style={{ background: color }} />
                                                    ))}
                                                </span>
                                                {palette.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {(
                                        [
                                            ["cream", "Canvas / cream"],
                                            ["paper", "Paper surface"],
                                            ["green", "Deep green"],
                                            ["greenDeep", "Green shadow"],
                                            ["ink", "Body ink"],
                                            ["muted", "Muted text"],
                                            ["gold", "Gold accent"],
                                            ["line", "Hairline / border"],
                                        ] as const
                                    ).map(([key, label]) => (
                                        <div className="flex items-end gap-2" key={key}>
                                            <div className="flex-1 space-y-1.5">
                                                <Label className="text-xs font-medium">{label}</Label>
                                                <Input
                                                    value={data.theme.colors[key]}
                                                    onChange={(event) => patch("theme", { colors: { ...data.theme.colors, [key]: event.target.value } })}
                                                    className="h-9 font-mono text-xs"
                                                />
                                            </div>
                                            <input
                                                aria-label={`${label} colour picker`}
                                                type="color"
                                                value={data.theme.colors[key]}
                                                onChange={(event) => patch("theme", { colors: { ...data.theme.colors, [key]: event.target.value } })}
                                                className="h-9 w-10 cursor-pointer rounded-md border bg-transparent p-1"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <SelectField
                                        label="Heading font"
                                        value={data.theme.typography.headingFont}
                                        onChange={(v) => patch("theme", { typography: { ...data.theme.typography, headingFont: v } })}
                                        options={FONT_OPTIONS.heading.map((font) => ({ value: font, label: font }))}
                                    />
                                    <SelectField
                                        label="Body font"
                                        value={data.theme.typography.bodyFont}
                                        onChange={(v) => patch("theme", { typography: { ...data.theme.typography, bodyFont: v } })}
                                        options={FONT_OPTIONS.body.map((font) => ({ value: font, label: font }))}
                                    />
                                </div>
                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                    Fonts other than Cormorant Garamond and Manrope load from Google Fonts on the
                                    storefront. Decorative gradients stay derived from the four core colours.
                                </p>
                            </div>
                        )}

                        {tab === "sections" && (
                            <div className="space-y-3">
                                <p className="text-xs text-muted-foreground">
                                    Toggle a section off to remove it from the page, or reorder with the arrows.
                                    The header, announcement and footer always render.
                                </p>
                                <p className="text-[10px] leading-relaxed text-muted-foreground">
                                    Space before/after is transparent padding outside the section. The
                                    story image extends about 53 px above its band, so keep Brand Story
                                    space before at 64 px or more to avoid touching the promo card.
                                </p>
                                {sections.map((section, index) => {
                                    const setSpacing = (key: "spaceBefore" | "spaceAfter", raw: string) => {
                                        const value = Number(raw);
                                        const clamped = Number.isFinite(value)
                                            ? Math.max(0, Math.min(240, Math.round(value)))
                                            : 0;
                                        updateSections(
                                            sections.map((item) =>
                                                item.id === section.id
                                                    ? { ...item, [key]: clamped }
                                                    : item
                                            )
                                        );
                                    };

                                    return (
                                    <div
                                        key={section.id}
                                        className="rounded-lg border bg-background px-3 py-2.5"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-[10px] font-semibold">
                                                    {index + 1}
                                                </span>
                                                <div>
                                                    <p className="text-xs font-medium">
                                                        {NITHTHIGAL_SECTION_LABELS[section.id] || section.id}
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground">{section.id}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Switch
                                                    checked={section.enabled}
                                                    aria-label={`Show ${NITHTHIGAL_SECTION_LABELS[section.id] || section.id}`}
                                                    onCheckedChange={(checked) =>
                                                        updateSections(
                                                            sections.map((item) =>
                                                                item.id === section.id ? { ...item, enabled: checked } : item
                                                            )
                                                        )
                                                    }
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    disabled={index === 0}
                                                    aria-label={`Move ${NITHTHIGAL_SECTION_LABELS[section.id] || section.id} up`}
                                                    onClick={() => updateSections(moveAt(sections, index, -1))}
                                                >
                                                    <ArrowUp className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    disabled={index === sections.length - 1}
                                                    aria-label={`Move ${NITHTHIGAL_SECTION_LABELS[section.id] || section.id} down`}
                                                    onClick={() => updateSections(moveAt(sections, index, 1))}
                                                >
                                                    <ArrowDown className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-end gap-2 border-t pt-2">
                                            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                                Space before
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    max={240}
                                                    step={4}
                                                    value={section.spaceBefore}
                                                    onChange={(event) =>
                                                        setSpacing("spaceBefore", event.target.value)
                                                    }
                                                    className="h-7 w-16 text-xs"
                                                />
                                                px
                                            </label>
                                            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                                Space after
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    max={240}
                                                    step={4}
                                                    value={section.spaceAfter}
                                                    onChange={(event) =>
                                                        setSpacing("spaceAfter", event.target.value)
                                                    }
                                                    className="h-7 w-16 text-xs"
                                                />
                                                px
                                            </label>
                                            {section.id === "story" ? (
                                                <span className="text-[10px] text-amber-600">
                                                    Keep ≥64 px because of the parallax image.
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
