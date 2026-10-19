"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
    fetchStCourierLiveTracking,
    isValidStCourierAwb,
    StCourierTrackingResult,
    StCourierTrackingEvent,
} from "@/lib/logistics-engine";
import {
    Truck,
    Package,
    Search,
    Copy,
    Check,
    ExternalLink,
    MessageCircle,
    Calendar,
    MapPin,
    AlertCircle,
    Clock,
    ShieldCheck,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

function StCourierTrackingContent() {
    const searchParams = useSearchParams();
    const rawAwb = searchParams.get("awb") || "";
    const cleanAwb = rawAwb.replace(/[^0-9]/g, "");

    const [loading, setLoading] = useState(false);
    const [tracking, setTracking] = useState<StCourierTrackingResult | null>(null);
    const [inputAwb, setInputAwb] = useState(cleanAwb);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!cleanAwb || !isValidStCourierAwb(cleanAwb)) {
            setTracking(null);
            return;
        }

        let isMounted = true;
        setLoading(true);

        fetchStCourierLiveTracking(cleanAwb)
            .then((res) => {
                if (isMounted) {
                    setTracking(res);
                }
            })
            .catch((err) => {
                if (isMounted) {
                    setTracking({
                        awbNumber: cleanAwb,
                        isValid: false,
                        statusCode: 500,
                        statusText: "Error contacting tracking network",
                        events: [],
                        error: err?.message || "Failed to reach ST Courier network",
                    });
                }
            })
            .finally(() => {
                if (isMounted) setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [cleanAwb]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = inputAwb.replace(/[^0-9]/g, "");
        if (trimmed) {
            window.location.search = `?awb=${encodeURIComponent(trimmed)}`;
        }
    };

    const handleCopy = () => {
        if (typeof navigator !== "undefined" && cleanAwb) {
            navigator.clipboard.writeText(cleanAwb);
            setCopied(true);
            toast.success("AWB copied to clipboard");
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const isAwbValid = cleanAwb && isValidStCourierAwb(cleanAwb);
    const status = tracking?.summary?.currentStatus || tracking?.statusText || (loading ? "Verifying Transit Status..." : "Ready to Track");
    const isDelivered = status.toLowerCase().includes("delivered");
    const isOutForDelivery = status.toLowerCase().includes("out for delivery");

    let statusClass = "bg-primary/10 border-primary/20 text-primary";
    let StatusIcon = Truck;
    if (isDelivered) {
        statusClass = "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
        StatusIcon = ShieldCheck;
    } else if (isOutForDelivery) {
        statusClass = "bg-amber-500/10 border-amber-500/20 text-amber-400";
        StatusIcon = Clock;
    }

    const summary = tracking?.summary || {};
    const events = tracking?.events || [];

    return (
        <div className="min-h-full w-full bg-background text-foreground font-sans p-4 md:p-8 flex justify-center items-start overflow-y-auto">
            <div className="w-full max-w-2xl flex flex-col gap-5 py-2">
                {/* Header matching Luminila ERP */}
                <div className="flex flex-col items-center text-center gap-1.5 pb-2">
                    <Badge variant="outline" className="gap-1.5 px-3 py-1 bg-primary/10 text-primary border-primary/20">
                        <Truck className="w-3.5 h-3.5" />
                        ST Courier Express Logistics
                    </Badge>
                    <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
                        Live Shipment Tracking
                    </h1>
                    <p className="text-xs text-muted-foreground max-w-md">
                        Direct reverse-engineered tracking engine with verified milestone sync.
                    </p>
                </div>

                {/* Search / Manual Input Box */}
                <form
                    onSubmit={handleSearchSubmit}
                    className="bg-card border border-border rounded-xl p-2.5 flex items-center gap-2 shadow-sm"
                >
                    <div className="relative flex-1">
                        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                            type="text"
                            value={inputAwb}
                            onChange={(e) => setInputAwb(e.target.value)}
                            placeholder="Enter 11-digit ST Courier AWB (e.g. 64437374632)"
                            maxLength={11}
                            className="pl-9 bg-background/50 border-border font-mono tracking-wider text-sm h-10"
                        />
                    </div>
                    <Button type="submit" size="sm" className="h-10 px-5 gap-1.5 font-medium">
                        <Search className="w-3.5 h-3.5" />
                        Track
                    </Button>
                </form>

                {/* Invalid AWB Alert */}
                {cleanAwb && !isAwbValid && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-5 text-center shadow-sm">
                        <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
                        <h2 className="text-sm font-semibold text-foreground mb-1">Invalid ST Courier AWB</h2>
                        <p className="text-xs text-muted-foreground">
                            The number <code className="text-primary font-mono font-medium">{cleanAwb}</code> is invalid. ST Courier tracking numbers must be exactly 11 numeric digits.
                        </p>
                    </div>
                )}

                {/* Main Tracking Card */}
                {isAwbValid && (
                    <>
                        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                            <div className="flex justify-between items-center pb-1">
                                <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                    Active Transit
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    className="font-mono text-xs text-muted-foreground bg-muted/60 hover:bg-muted px-2.5 py-1.5 rounded-lg border border-border transition flex items-center gap-1.5"
                                >
                                    AWB: <strong className="text-foreground">{cleanAwb}</strong>
                                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                            </div>

                            {/* Status Banner */}
                            <div className={`flex items-center gap-3.5 p-4 rounded-lg border ${statusClass}`}>
                                <StatusIcon className="w-6 h-6 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] uppercase tracking-wider font-semibold opacity-75">
                                        Current Transit Status
                                    </div>
                                    <div className="text-base font-bold truncate">
                                        {status}
                                    </div>
                                </div>
                            </div>

                            {/* Summary Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                                <div className="bg-muted/30 border border-border/60 p-3 rounded-lg">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                                        <MapPin className="w-3 h-3" /> Origin Hub
                                    </div>
                                    <div className="text-xs font-semibold text-foreground truncate">
                                        {summary.origin || "Recorded Origin"}
                                    </div>
                                </div>
                                <div className="bg-muted/30 border border-border/60 p-3 rounded-lg">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                                        <MapPin className="w-3 h-3" /> Destination
                                    </div>
                                    <div className="text-xs font-semibold text-foreground truncate">
                                        {summary.destination || "Destination Transit"}
                                    </div>
                                </div>
                                <div className="bg-muted/30 border border-border/60 p-3 rounded-lg">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                                        <Calendar className="w-3 h-3" /> Booking Date
                                    </div>
                                    <div className="text-xs font-semibold text-foreground truncate">
                                        {summary.bookDateTime || "Recorded"}
                                    </div>
                                </div>
                                <div className="bg-muted/30 border border-border/60 p-3 rounded-lg">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                                        <Clock className="w-3 h-3" /> {isDelivered ? "Delivered On" : "Expected"}
                                    </div>
                                    <div className="text-xs font-semibold text-primary truncate">
                                        {summary.deliveryDateTime || "In Scheduled Transit"}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Journey Milestones Timeline */}
                        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                                <Package className="w-4 h-4 text-primary" />
                                Shipment Journey & Milestones
                            </h3>

                            {events.length > 0 ? (
                                <div className="relative pl-6 before:content-[''] before:absolute before:top-2 before:bottom-2 before:left-2.5 before:w-[2px] before:bg-border flex flex-col gap-5">
                                    {events.map((ev: StCourierTrackingEvent, idx: number) => (
                                        <div key={idx} className="relative">
                                            <div
                                                className={`absolute -left-6 top-1 w-3 h-3 rounded-full border-2 ${
                                                    idx === 0
                                                        ? "bg-primary border-background ring-4 ring-primary/20"
                                                        : "bg-muted-foreground/40 border-background"
                                                }`}
                                            />
                                            <div className="pl-1">
                                                <div className="flex justify-between items-baseline gap-2 mb-0.5">
                                                    <span className={`text-xs font-semibold ${idx === 0 ? "text-primary" : "text-foreground"}`}>
                                                        {ev.status}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                                                        {ev.dateTime}
                                                    </span>
                                                </div>
                                                {ev.location && (
                                                    <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                                                        <MapPin className="w-3 h-3" /> {ev.location}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-6 text-xs text-muted-foreground">
                                    Shipment registered. Carrier hub scans update automatically upon transit handoff.
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <a
                                href="https://stcourier.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                className={buttonVariants({
                                    variant: "outline",
                                    className: "h-10 text-xs border-border bg-card hover:bg-muted text-foreground",
                                })}
                            >
                                <ExternalLink className="w-3.5 h-3.5 mr-2" />
                                ST Courier Official Portal
                            </a>
                            <a
                                href={`https://wa.me/?text=${encodeURIComponent(
                                    `Hi Luminila Team, regarding my ST Courier shipment #${cleanAwb}`
                                )}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center rounded-lg h-10 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm transition-all"
                            >
                                <MessageCircle className="w-3.5 h-3.5 mr-2" />
                                WhatsApp Support Concierge
                            </a>
                        </div>
                    </>
                )}

                {/* Footer */}
                <div className="text-center text-[11px] text-muted-foreground py-2 leading-relaxed">
                    <p>Insured Precious Transit • Tamper-Evident Security Seal Protocol</p>
                    <p className="opacity-60 mt-0.5">© {new Date().getFullYear()} Luminila Luxury Jewels. All rights reserved.</p>
                </div>
            </div>
        </div>
    );
}

export default function StCourierTrackingPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-full w-full bg-background flex items-center justify-center text-muted-foreground text-xs">
                    Loading tracking console...
                </div>
            }
        >
            <StCourierTrackingContent />
        </Suspense>
    );
}
