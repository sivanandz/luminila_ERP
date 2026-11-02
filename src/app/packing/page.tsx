"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
    ArrowLeft,
    Box,
    Camera,
    CheckCircle2,
    Loader2,
    Package,
    PackageCheck,
    RefreshCw,
    ScanBarcode,
    Store,
    MessageCircle,
    Truck,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BarcodeScanDispatchModal, type OrderItemSummary } from "@/components/orders/BarcodeScanDispatchModal";
import { PackingSlipButton, type PackingSlipData } from "@/components/packing/PackingSlip";
import { compressImageFile } from "@/lib/quick-product";
import { soundEffects } from "@/lib/sound-effects";
import { MobileScanner } from "@/lib/mobile-scanner";
import { getCurrentTenantEmail } from "@/lib/pocketbase";
import { getOrderDetails, type OrderDetail } from "@/lib/orders";
import { dispatchOrderMilestoneWhatsApp } from "@/lib/order-milestones";
import {
    buildPackingLines,
    completePackingSession,
    findOpenOrdersForVariant,
    findOrderBySlipScan,
    getLatestSessionForOrder,
    getOrCreateSession,
    incrementPackedItem,
    incompleteLines,
    isSessionComplete,
    loadPackingQueue,
    matchResolvedToLine,
    resolveScannedCode,
    saveSessionProgress,
    type PackingLine,
    type PackingQueue,
    type PackingSession,
    type QueueOrder,
} from "@/lib/packing";

// Camera scanner shares the POS component (html5-qrcode with center-crop
// zoom for micro jewelry tags); loaded client-side only.
const BarcodeScanner = dynamic(
    () => import("@/components/pos/BarcodeScanner").then((mod) => mod.BarcodeScanner),
    { ssr: false, loading: () => <div className="h-48 bg-surface-navy rounded-lg animate-pulse flex items-center justify-center text-moonstone text-xs">Loading camera…</div> }
);

interface ScanFeedEntry {
    id: number;
    text: string;
    tone: "ok" | "warn" | "err" | "info";
    at: string;
}

interface CompletionSummary {
    orderNumber: string;
    customerName: string;
    milestoneSent: boolean;
    awbOrder: OrderItemSummary;
}

const FEED_TONES: Record<ScanFeedEntry["tone"], string> = {
    ok: "text-emerald-400",
    warn: "text-amber-300",
    err: "text-red-400",
    info: "text-moonstone",
};

function channelBadge(order: QueueOrder): { label: string; className: string } | null {
    switch (order.capture_source) {
        case "storefront":
            return { label: "Website", className: "border-purple-500/40 bg-purple-500/10 text-purple-300" };
        case "whatsapp":
            return { label: "WhatsApp", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
        default:
            return null;
    }
}

function paymentBadge(order: QueueOrder): { label: string; className: string } | null {
    if (order.payment_status === "PAID") {
        return { label: "PAID", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
    }
    if ((order.payment_method || "").toLowerCase().includes("cod") || order.payment_status === "UNPAID") {
        return { label: "COD", className: "border-amber-500/40 bg-amber-500/10 text-amber-300" };
    }
    return null;
}

function PackingStation() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [queue, setQueue] = useState<PackingQueue>({ toPack: [], packedAwaitingDispatch: [] });
    const [queueLoading, setQueueLoading] = useState(true);
    const [activeOrder, setActiveOrder] = useState<OrderDetail | null>(null);
    const [activeOrderMeta, setActiveOrderMeta] = useState<QueueOrder | null>(null);
    const [activeLines, setActiveLines] = useState<PackingLine[]>([]);
    const [session, setSession] = useState<PackingSession | null>(null);
    const [openingOrder, setOpeningOrder] = useState(false);
    const [scanInput, setScanInput] = useState("");
    const [scanFeed, setScanFeed] = useState<ScanFeedEntry[]>([]);
    const [justPackedLine, setJustPackedLine] = useState<string | null>(null);
    const [completing, setCompleting] = useState(false);
    const [parcelPhoto, setParcelPhoto] = useState("");
    const [photoBusy, setPhotoBusy] = useState(false);
    const [showCamera, setShowCamera] = useState(false);
    const [completion, setCompletion] = useState<CompletionSummary | null>(null);
    const [awbModalOpen, setAwbModalOpen] = useState(false);
    const [awbOrder, setAwbOrder] = useState<OrderItemSummary | null>(null);
    /** True when the opened order already has a completed session (read-only checklist). */
    const [reopenedCompleted, setReopenedCompleted] = useState(false);

    const scanInputRef = useRef<HTMLInputElement>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);
    const feedIdRef = useRef(0);
    const lastScanRef = useRef({ code: "", at: 0 });

    const pushFeed = useCallback((text: string, tone: ScanFeedEntry["tone"]) => {
        feedIdRef.current += 1;
        setScanFeed((feed) =>
            [
                {
                    id: feedIdRef.current,
                    text,
                    tone,
                    at: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
                },
                ...feed,
            ].slice(0, 10)
        );
    }, []);

    const refreshQueue = useCallback(async () => {
        setQueueLoading(true);
        const next = await loadPackingQueue();
        setQueue(next);
        setQueueLoading(false);
        return next;
    }, []);

    useEffect(() => {
        void refreshQueue();
    }, [refreshQueue]);

    const openOrder = useCallback(
        async (order: Pick<QueueOrder, "id" | "order_number" | "customer_name" | "customer_phone">) => {
            setOpeningOrder(true);
            try {
                const details = await getOrderDetails(order.id);
                if (!details) {
                    toast.error(`Order ${order.order_number} could not be loaded.`);
                    return;
                }
                const lines = buildPackingLines(details.items);
                // A packed order re-openes its completed checklist read-only;
                // only orders without a completed session start/resume packing.
                const latest = await getLatestSessionForOrder(order.id);
                const alreadyCompleted = latest?.status === "completed";
                const sess = alreadyCompleted
                    ? (latest as PackingSession)
                    : await getOrCreateSession(
                          {
                              id: order.id,
                              order_number: order.order_number,
                              customer_name: order.customer_name,
                              customer_phone: order.customer_phone,
                          },
                          lines,
                          getCurrentTenantEmail() || undefined
                      );
                setActiveOrder(details);
                setActiveOrderMeta({ ...(order as QueueOrder), status: details.status });
                setActiveLines(lines);
                setSession(sess);
                setReopenedCompleted(alreadyCompleted);
                setAwbOrder(null);
                setParcelPhoto("");
                setCompletion(null);
                pushFeed(
                    alreadyCompleted
                        ? `Re-opened packed checklist ${order.order_number}`
                        : `Opened ${order.order_number} (${lines.length} lines)`,
                    "info"
                );
                if (!alreadyCompleted) setTimeout(() => scanInputRef.current?.focus(), 120);
            } catch (error) {
                console.error("Failed to open order for packing:", error);
                toast.error("Could not start the packing session.");
            } finally {
                setOpeningOrder(false);
            }
        },
        [pushFeed]
    );

    // Deep link: /packing?order=<id> from the order detail page.
    const deepLinkHandled = useRef(false);
    useEffect(() => {
        const orderId = searchParams.get("order");
        if (!orderId || queueLoading || activeOrder || openingOrder || deepLinkHandled.current) return;
        deepLinkHandled.current = true;
        const queued = [...queue.toPack, ...queue.packedAwaitingDispatch].find((entry) => entry.id === orderId);
        if (queued) {
            void openOrder(queued);
            return;
        }
        void (async () => {
            const details = await getOrderDetails(orderId);
            if (!details) return;
            await openOrder({
                id: details.id,
                order_number: details.order_number || details.id,
                customer_name: details.customer_name || "Customer",
                customer_phone: details.customer_phone || undefined,
            });
        })();
    }, [searchParams, queueLoading, queue, activeOrder, openingOrder, openOrder]);

    const handleScan = useCallback(
        async (code: string) => {
            const cleaned = code.trim();
            if (!cleaned) return;

            // Hardware guns can re-fire the same code; ignore repeats within 1.5 s.
            const now = Date.now();
            if (lastScanRef.current.code === cleaned && now - lastScanRef.current.at < 1500) return;
            lastScanRef.current = { code: cleaned, at: now };

            // ---- No order open: slip scan or item-scan order lookup ----
            if (!activeOrder || !session) {
                const slipOrder = findOrderBySlipScan(cleaned, queue);
                if (slipOrder) {
                    soundEffects.playScanSuccess();
                    pushFeed(`Slip scan → ${slipOrder.order_number}`, "ok");
                    await openOrder(slipOrder);
                    return;
                }

                const resolved = await resolveScannedCode(cleaned);
                if (resolved?.variantId) {
                    const owners = await findOpenOrdersForVariant(resolved.variantId, queue);
                    if (owners.length === 1) {
                        soundEffects.playScanSuccess();
                        pushFeed(`Piece scan → ${owners[0].order_number}`, "ok");
                        await openOrder(owners[0]);
                        return;
                    }
                    if (owners.length > 1) {
                        soundEffects.playScanError();
                        pushFeed(`Piece is on ${owners.length} open orders`, "warn");
                        toast.info(`This piece is on ${owners.length} open orders — pick one from the queue.`, {
                            description: owners.map((owner) => owner.order_number).join(", "),
                        });
                        return;
                    }
                }
                soundEffects.playScanError();
                pushFeed(`Unknown scan: ${cleaned}`, "err");
                toast.error(`"${cleaned}" is not a packing slip or a packable item.`);
                return;
            }

            // ---- Order open: strict line verification ----
            const resolved = await resolveScannedCode(cleaned);
            if (!resolved) {
                soundEffects.playScanError();
                pushFeed(`Unknown scan: ${cleaned}`, "err");
                toast.error(`"${cleaned}" did not resolve to any catalog item.`);
                return;
            }

            const match = matchResolvedToLine(resolved, activeLines, session.packed_items);

            if (match.type === "line" && match.line) {
                const line = match.line;
                const nextItems = incrementPackedItem(session.packed_items, line);
                const nextSession: PackingSession = { ...session, packed_items: nextItems };
                setSession(nextSession);
                setJustPackedLine(line.item_id);
                setTimeout(() => setJustPackedLine((current) => (current === line.item_id ? null : current)), 1200);

                const complete = isSessionComplete(activeLines, nextItems);
                soundEffects.playScanSuccess();
                if (complete) soundEffects.playConfirmationChime();
                const packedQty = nextItems.find((entry) => entry.item_id === line.item_id)?.packed_qty || 0;
                pushFeed(`${line.sku} packed (${packedQty}/${line.quantity})${complete ? " — parcel complete" : ""}`, "ok");
                toast.success(
                    complete ? `All pieces of ${session.order_number} scanned!` : `Packed: ${line.sku}`,
                    {
                        description: complete ? "Seal the parcel, snap the photo, and complete." : `${packedQty}/${line.quantity} of this line.`,
                    }
                );
                try {
                    await saveSessionProgress(nextSession);
                } catch (error) {
                    console.error("Progress save failed:", error);
                    toast.error("Could not save packing progress — check the connection.");
                }
                return;
            }

            if (match.type === "already_complete" && match.line) {
                soundEffects.playScanError();
                pushFeed(`${match.line.sku} already fully packed`, "warn");
                toast.warning(`${match.line.sku} is fully packed already.`);
                return;
            }

            if (match.type === "ambiguous") {
                soundEffects.playScanError();
                pushFeed("Ambiguous piece (multi-variant product)", "err");
                toast.error("This product has several variants on the order — scan the item tag with the variant suffix.");
                return;
            }

            if (match.type === "not_in_order") {
                soundEffects.playScanError();
                pushFeed(`Not on this order: ${resolved.label || cleaned}`, "err");
                const owners = resolved.variantId ? await findOpenOrdersForVariant(resolved.variantId, queue) : [];
                const other = owners.find((owner) => owner.id !== activeOrder.id);
                if (other) {
                    toast.error("Wrong parcel!", {
                        description: `This piece belongs to ${other.order_number} — ${other.customer_name}.`,
                        duration: 7000,
                    });
                } else {
                    toast.error("This piece is not on this order.");
                }
                return;
            }

            soundEffects.playScanError();
            pushFeed(`Unknown scan: ${cleaned}`, "err");
            toast.error(`"${cleaned}" did not resolve to any catalog item.`);
        },
        [activeOrder, session, queue, activeLines, openOrder, pushFeed]
    );

    // Station scanner context: armed for the whole page lifetime; modal
    // contexts (AWB dispatch at 100) outrank it while they are open.
    useEffect(() => {
        const unregister = MobileScanner.registerContext("packing_station", (result) => {
            void handleScan(result.barcode);
            return true;
        });
        return () => unregister();
    }, [handleScan]);

    const packedPieces = session
        ? session.packed_items.reduce((sum, entry) => sum + entry.packed_qty, 0)
        : 0;
    const totalPieces = activeLines.reduce((sum, line) => sum + line.quantity, 0);
    const remaining = session ? incompleteLines(activeLines, session.packed_items) : [];
    const sessionComplete = session ? isSessionComplete(activeLines, session.packed_items) : false;

    const slipData: PackingSlipData | null = activeOrder
        ? {
              orderNumber: activeOrder.order_number || activeOrder.id,
              customerName: activeOrder.customer_name || activeOrderMeta?.customer_name || "Customer",
              customerPhone: activeOrder.customer_phone || activeOrderMeta?.customer_phone || undefined,
              shippingAddress: activeOrder.shipping_address || activeOrderMeta?.shipping_address || undefined,
              paymentLabel:
                  activeOrder.payment_status === "PAID"
                      ? "PAID"
                      : (activeOrderMeta?.payment_method || "").toLowerCase().includes("cod")
                        ? "COD"
                        : undefined,
              total: activeOrder.total,
              lines: activeLines,
          }
        : null;

    const handleParcelPhoto = async (file: File) => {
        setPhotoBusy(true);
        try {
            const compressed = await compressImageFile(file);
            setParcelPhoto(compressed);
            pushFeed("Parcel photo attached", "info");
        } catch {
            toast.error("Could not read that image.");
        } finally {
            setPhotoBusy(false);
        }
    };

    const handleComplete = async () => {
        if (!activeOrder || !session) return;
        if (remaining.length > 0) {
            const listing = remaining
                .map((line) => {
                    const packed = session.packed_items.find((entry) => entry.item_id === line.item_id)?.packed_qty || 0;
                    return `• ${line.sku} (${packed}/${line.quantity})`;
                })
                .join("\n");
            const proceed = window.confirm(
                `Not all pieces were scanned:\n\n${listing}\n\nComplete the packing session anyway?`
            );
            if (!proceed) return;
        }

        setCompleting(true);
        try {
            const milestone = await dispatchOrderMilestoneWhatsApp({
                orderId: activeOrder.id,
                orderNumber: activeOrder.order_number || session.order_number,
                customerName: activeOrder.customer_name || session.customer_name || "Customer",
                customerPhone: activeOrder.customer_phone || session.customer_phone || "",
                milestone: "packed",
                photoUrl: parcelPhoto || undefined,
                notes: "Verified piece-by-piece at the packing station.",
            });
            if (!milestone.success) {
                toast.warning("Packing saved, but the WhatsApp update was not delivered.", {
                    description: milestone.error,
                });
            }

            await completePackingSession(session, getCurrentTenantEmail() || undefined);
            soundEffects.playConfirmationChime();
            pushFeed(`Session completed for ${session.order_number}`, "ok");

            const awbPayload: OrderItemSummary = {
                id: activeOrder.id,
                order_number: activeOrder.order_number || session.order_number,
                customer_name: activeOrder.customer_name || "Customer",
                customer_phone: activeOrder.customer_phone || null,
                status: activeOrder.status,
                total: activeOrder.total || 0,
            };
            setAwbOrder(awbPayload);
            setCompletion({
                orderNumber: session.order_number,
                customerName: activeOrder.customer_name || "Customer",
                milestoneSent: milestone.success,
                awbOrder: awbPayload,
            });
            setActiveOrder(null);
            setActiveOrderMeta(null);
            setActiveLines([]);
            setSession(null);
            setParcelPhoto("");
            void refreshQueue();
        } catch (error) {
            console.error("Failed to complete packing:", error);
            toast.error("Could not complete the packing session.");
        } finally {
            setCompleting(false);
        }
    };

    const closeOrder = () => {
        setActiveOrder(null);
        setActiveOrderMeta(null);
        setActiveLines([]);
        setSession(null);
        setReopenedCompleted(false);
        setParcelPhoto("");
        setShowCamera(false);
        void refreshQueue();
    };

    /** Read-only packed order → AWB handoff. */
    const openAwbForActiveOrder = () => {
        if (!activeOrder) return;
        setAwbOrder({
            id: activeOrder.id,
            order_number: activeOrder.order_number || activeOrder.id,
            customer_name: activeOrder.customer_name || "Customer",
            customer_phone: activeOrder.customer_phone || null,
            status: activeOrder.status,
            total: activeOrder.total || 0,
        });
        setAwbModalOpen(true);
    };

    /** Deliberately start a fresh packing pass on an already-packed order. */
    const restartPacking = async () => {
        if (!activeOrder || !activeOrderMeta) return;
        try {
            const fresh = await getOrCreateSession(
                {
                    id: activeOrderMeta.id,
                    order_number: activeOrderMeta.order_number,
                    customer_name: activeOrderMeta.customer_name,
                    customer_phone: activeOrderMeta.customer_phone,
                },
                activeLines,
                getCurrentTenantEmail() || undefined
            );
            setSession(fresh);
            setReopenedCompleted(false);
            pushFeed(`Restarted packing ${activeOrderMeta.order_number}`, "info");
            setTimeout(() => scanInputRef.current?.focus(), 120);
        } catch (error) {
            console.error("Restart packing failed:", error);
            toast.error("Could not restart the packing session.");
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Packing Station"
                subtitle={
                    queueLoading
                        ? "Loading the pack queue…"
                        : `${queue.toPack.length} to pack · ${queue.packedAwaitingDispatch.length} awaiting dispatch`
                }
                action={
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => void refreshQueue()} className="h-9">
                            <RefreshCw size={14} className="mr-1" />
                            Refresh
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => router.push("/orders")} className="h-9 text-moonstone hover:text-white">
                            <ArrowLeft size={14} className="mr-1" />
                            Orders
                        </Button>
                    </div>
                }
                hideSearch
            />

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[330px_1fr] overflow-hidden">
                {/* LEFT: queue */}
                <aside className="hidden lg:flex flex-col border-r border-surface-hover bg-surface-navy/60 overflow-y-auto">
                    <div className="p-3 border-b border-surface-hover">
                        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-moonstone">
                            <Package size={13} className="text-primary" />
                            To pack · {queue.toPack.length}
                        </p>
                    </div>
                    {queueLoading ? (
                        <div className="flex justify-center p-8">
                            <Loader2 className="animate-spin text-primary" size={22} />
                        </div>
                    ) : queue.toPack.length === 0 ? (
                        <p className="text-xs text-moonstone p-4 leading-relaxed">
                            No orders waiting. Confirmed website and WhatsApp orders land here automatically.
                        </p>
                    ) : (
                        queue.toPack.map((order) => {
                            const channel = channelBadge(order);
                            const payment = paymentBadge(order);
                            return (
                                <button
                                    key={order.id}
                                    type="button"
                                    onClick={() => void openOrder(order)}
                                    disabled={openingOrder}
                                    className={`text-left px-3 py-2.5 border-b border-surface-hover/50 hover:bg-bg-navy transition-colors disabled:opacity-60 ${
                                        activeOrder?.id === order.id ? "bg-bg-navy" : ""
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-mono font-bold text-primary truncate">{order.order_number}</span>
                                        <span className="text-[10px] text-moonstone shrink-0">{order.item_count} pcs</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                        <span className="text-[11px] text-white truncate max-w-[130px]">{order.customer_name}</span>
                                        {channel && (
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${channel.className}`}>{channel.label}</span>
                                        )}
                                        {payment && (
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${payment.className}`}>{payment.label}</span>
                                        )}
                                    </div>
                                    {order.packing_in_progress && (
                                        <p className="text-[10px] text-amber-300 mt-0.5">◦ half-packed — resume</p>
                                    )}
                                </button>
                            );
                        })
                    )}

                    <div className="p-3 border-y border-surface-hover bg-bg-navy/40">
                        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-moonstone">
                            <PackageCheck size={13} className="text-emerald-400" />
                            Packed · awaiting dispatch · {queue.packedAwaitingDispatch.length}
                        </p>
                    </div>
                    {queue.packedAwaitingDispatch.map((order) => (
                        <div key={order.id} className="px-3 py-2.5 border-b border-surface-hover/50">
                            <div className="flex items-center justify-between gap-2">
                                <button
                                    type="button"
                                    onClick={() => void openOrder(order)}
                                    className="text-xs font-mono font-bold text-emerald-400 truncate hover:underline"
                                    title="Re-open the packed checklist"
                                >
                                    {order.order_number}
                                </button>
                                <PackingSlipButton
                                    data={{
                                        orderNumber: order.order_number,
                                        customerName: order.customer_name,
                                        customerPhone: order.customer_phone,
                                        shippingAddress: order.shipping_address,
                                        paymentLabel: paymentBadge(order)?.label,
                                        total: order.total,
                                        lines: [],
                                    }}
                                    label="Slip"
                                    className="h-6 px-2 text-[10px]"
                                />
                            </div>
                            <p className="text-[11px] text-moonstone mt-0.5 truncate">{order.customer_name}</p>
                        </div>
                    ))}
                </aside>

                {/* RIGHT: station pane */}
                <main className="flex flex-col min-h-0 overflow-y-auto p-3 sm:p-5">
                    {completion ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 max-w-md mx-auto w-full">
                            <CheckCircle2 size={56} className="text-emerald-400" />
                            <div>
                                <p className="text-lg font-bold text-white">{completion.orderNumber} packed ✓</p>
                                <p className="text-sm text-moonstone mt-1">
                                    {completion.milestoneSent
                                        ? `${completion.customerName} was notified on WhatsApp with the packed-parcel update.`
                                        : "Packing recorded. The WhatsApp update could not be delivered — send it from the order page."}
                                </p>
                            </div>
                            <div className="flex flex-col gap-2 w-full">
                                <Button onClick={() => setAwbModalOpen(true)} className="h-11 font-bold bg-primary text-primary-foreground">
                                    <Truck size={16} className="mr-2" />
                                    Scan AWB &amp; dispatch
                                </Button>
                                <Button variant="outline" onClick={() => router.push(`/orders/detail?id=${completion.awbOrder.id}`)} className="h-10">
                                    Open order details
                                </Button>
                                <Button variant="ghost" onClick={() => setCompletion(null)} className="h-10 text-moonstone hover:text-white">
                                    Pack the next order
                                </Button>
                            </div>
                        </div>
                    ) : !activeOrder || !session ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                            <ScanBarcode size={48} className="text-moonstone" />
                            <p className="text-sm text-moonstone max-w-sm leading-relaxed">
                                Pick an order from the queue, scan its packing slip, or scan any item tag to jump to its
                                order. Hardware scanners work anywhere on this page.
                            </p>
                            {/* Mobile queue (station layout collapses on small screens) */}
                            <div className="lg:hidden w-full max-w-md mt-4 space-y-2">
                                {queue.toPack.slice(0, 10).map((order) => (
                                    <button
                                        key={order.id}
                                        type="button"
                                        onClick={() => void openOrder(order)}
                                        className="w-full text-left rounded-lg border border-surface-hover bg-surface-navy px-3 py-2.5 hover:bg-bg-navy"
                                    >
                                        <span className="text-xs font-mono font-bold text-primary">{order.order_number}</span>
                                        <span className="text-[11px] text-white ml-2">{order.customer_name}</span>
                                        <span className="text-[10px] text-moonstone float-right">{order.item_count} pcs</span>
                                    </button>
                                ))}
                                {queue.toPack.length === 0 && !queueLoading && (
                                    <p className="text-xs text-moonstone text-center py-4">Queue is empty.</p>
                                )}
                            </div>
                        </div>
                    ) : openingOrder ? (
                        <div className="flex-1 flex items-center justify-center">
                            <Loader2 className="animate-spin text-primary" size={28} />
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4 max-w-3xl w-full mx-auto">
                            {/* Order header */}
                            <div className="rounded-xl border border-surface-hover bg-surface-navy p-4 flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-sm font-mono font-bold text-primary">{session.order_number}</p>
                                    <p className="text-sm text-white mt-0.5">{activeOrder.customer_name || session.customer_name}</p>
                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                        {activeOrderMeta && channelBadge(activeOrderMeta) && (
                                            <Badge variant="outline" className="text-[10px] border-surface-hover text-moonstone">
                                                {channelBadge(activeOrderMeta)!.label === "Website" ? <Store size={10} className="mr-1" /> : <MessageCircle size={10} className="mr-1" />}
                                                {channelBadge(activeOrderMeta)!.label}
                                            </Badge>
                                        )}
                                        {activeOrderMeta && paymentBadge(activeOrderMeta) && (
                                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                                                {paymentBadge(activeOrderMeta)!.label}
                                            </Badge>
                                        )}
                                        <span className="text-[10px] text-moonstone">
                                            ₹{(activeOrder.total || 0).toLocaleString("en-IN")}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <PackingSlipButton data={slipData} />
                                    <Button variant="ghost" size="icon" onClick={closeOrder} className="text-moonstone hover:text-white" title="Close without completing">
                                        <X size={16} />
                                    </Button>
                                </div>
                            </div>

                            {/* Already-packed banner (read-only re-open) */}
                            {reopenedCompleted && (
                                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2">
                                    <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                                        <CheckCircle2 size={14} />
                                        Packed &amp; ready for dispatch
                                    </p>
                                    <p className="text-[10px] text-moonstone leading-relaxed">
                                        Verified{" "}
                                        {session?.completed_at
                                            ? new Date(session.completed_at).toLocaleString("en-IN")
                                            : "earlier"}
                                        . Nothing to scan — hand the parcel to the courier.
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <Button type="button" size="sm" onClick={openAwbForActiveOrder} className="h-8 text-xs font-bold bg-emerald-600 hover:bg-emerald-500">
                                            <Truck size={13} className="mr-1" />
                                            Scan AWB &amp; dispatch
                                        </Button>
                                        <Button type="button" variant="outline" size="sm" onClick={() => void restartPacking()} className="h-8 text-xs">
                                            Restart packing
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Scan input */}
                            {!reopenedCompleted && (
                            <>
                            <div className="rounded-xl border-2 border-primary/40 bg-bg-navy p-3">
                                <div className="flex items-center gap-2">
                                    <ScanBarcode size={18} className="text-primary shrink-0" />
                                    <Input
                                        ref={scanInputRef}
                                        autoFocus
                                        value={scanInput}
                                        onChange={(event) => setScanInput(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" && scanInput.trim()) {
                                                event.preventDefault();
                                                const code = scanInput.trim();
                                                setScanInput("");
                                                void MobileScanner.dispatchScan(code, "hardware");
                                            }
                                        }}
                                        placeholder="Scan item tag or packing slip…"
                                        className="h-11 bg-surface-navy border-surface-hover text-sm font-mono text-white"
                                    />
                                    <Button
                                        type="button"
                                        variant={showCamera ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setShowCamera((value) => !value)}
                                        className="h-9 shrink-0"
                                        title="Camera scanning for phone/tablet"
                                    >
                                        <Camera size={14} />
                                    </Button>
                                </div>
                                <p className="text-[10px] text-moonstone mt-1.5 leading-relaxed">
                                    Strict mode: every line must be scanned {totalPieces > 0 ? `(${packedPieces}/${totalPieces} pieces)` : ""}. A
                                    piece from another order is rejected with the order it belongs to.
                                </p>
                            </div>

                            {showCamera && (
                                <BarcodeScanner onScan={(code) => void handleScan(code)} isActive={showCamera} />
                            )}
                            </>
                            )}

                            {/* Checklist */}
                            <div className="rounded-xl border border-surface-hover bg-surface-navy overflow-hidden">
                                <div className="px-4 py-2.5 border-b border-surface-hover flex items-center justify-between">
                                    <p className="text-xs font-bold uppercase tracking-wider text-moonstone">Item checklist</p>
                                    <span className={`text-xs font-mono font-bold ${sessionComplete ? "text-emerald-400" : "text-white"}`}>
                                        {packedPieces}/{totalPieces} pieces
                                    </span>
                                </div>
                                {activeLines.map((line) => {
                                    const packed = session.packed_items.find((entry) => entry.item_id === line.item_id)?.packed_qty || 0;
                                    const done = packed >= line.quantity;
                                    return (
                                        <div
                                            key={line.item_id}
                                            className={`px-4 py-2.5 border-b border-surface-hover/40 last:border-b-0 flex items-center justify-between gap-3 transition-colors ${
                                                justPackedLine === line.item_id ? "bg-emerald-500/10" : ""
                                            }`}
                                        >
                                            <div className="min-w-0">
                                                <p className="text-xs font-mono font-bold text-white truncate">{line.sku}</p>
                                                <p className="text-[10px] text-moonstone truncate">
                                                    {line.description}
                                                    {line.variant_size ? ` · size ${line.variant_size}` : ""}
                                                    {line.variant_color ? ` · ${line.variant_color}` : ""}
                                                </p>
                                            </div>
                                            <span
                                                className={`shrink-0 text-[11px] font-mono font-bold px-2 py-1 rounded border ${
                                                    done
                                                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                                        : packed > 0
                                                          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                                                          : "border-surface-hover text-moonstone"
                                                }`}
                                            >
                                                {done ? <CheckCircle2 size={11} className="inline mr-1" /> : null}
                                                {packed}/{line.quantity}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Scan feed */}
                            {scanFeed.length > 0 && (
                                <div className="rounded-lg border border-surface-hover/60 bg-bg-navy/50 px-3 py-2">
                                    {scanFeed.slice(0, 5).map((entry) => (
                                        <p key={entry.id} className={`text-[10px] font-mono leading-relaxed ${FEED_TONES[entry.tone]}`}>
                                            <span className="text-moonstone/60">{entry.at}</span> {entry.text}
                                        </p>
                                    ))}
                                </div>
                            )}

                            {/* Parcel photo + complete (hidden for a read-only packed re-open) */}
                            {!reopenedCompleted && (
                            <div className="rounded-xl border border-surface-hover bg-surface-navy p-3 space-y-3">
                                <div className="flex items-center gap-3">
                                    {parcelPhoto ? (
                                        <>
                                            {/* eslint-disable-next-line @next/next/no-img-element -- compressed data URL preview */}
                                            <img src={parcelPhoto} alt="Packed parcel" className="size-14 rounded-lg object-cover border border-surface-hover" />
                                            <button
                                                type="button"
                                                onClick={() => setParcelPhoto("")}
                                                className="text-[10px] text-moonstone hover:text-white flex items-center gap-1"
                                            >
                                                <X size={11} /> Remove photo
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={photoBusy}
                                                onClick={() => photoInputRef.current?.click()}
                                                className="h-9"
                                            >
                                                {photoBusy ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                                                Parcel photo (optional)
                                            </Button>
                                            <span className="text-[10px] text-moonstone">Attached to the customer&apos;s WhatsApp update.</span>
                                        </>
                                    )}
                                    <input
                                        ref={photoInputRef}
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        className="hidden"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file) void handleParcelPhoto(file);
                                            event.target.value = "";
                                        }}
                                    />
                                </div>

                                <Button
                                    type="button"
                                    onClick={() => void handleComplete()}
                                    disabled={completing || activeLines.length === 0}
                                    className={`w-full h-12 font-bold ${sessionComplete ? "bg-emerald-600 hover:bg-emerald-500 animate-pulse" : ""}`}
                                >
                                    {completing ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin mr-2" /> Completing…
                                        </>
                                    ) : (
                                        <>
                                            <Box size={16} className="mr-2" />
                                            {sessionComplete
                                                ? "Complete & notify customer"
                                                : `Complete anyway (${remaining.length} line${remaining.length === 1 ? "" : "s"} unscanned)`}
                                        </>
                                    )}
                                </Button>
                                {!sessionComplete && remaining.length > 0 && (
                                    <p className="text-[10px] text-amber-300/80 leading-relaxed">
                                        Completing with unscanned lines asks for a confirmation and records the override.
                                    </p>
                                )}
                            </div>
                            )}
                        </div>
                    )}
                </main>
            </div>

            <BarcodeScanDispatchModal
                open={awbModalOpen}
                onOpenChange={setAwbModalOpen}
                preselectedOrder={awbOrder}
                onDispatched={() => {
                    setCompletion(null);
                    void refreshQueue();
                }}
            />
        </div>
    );
}

export default function PackingPage() {
    return (
        <Suspense fallback={<div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" size={40} /></div>}>
            <PackingStation />
        </Suspense>
    );
}
