"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Upload,
    Camera,
    MessageCircle,
    RotateCw,
    Check,
    X,
    Search,
    Sparkles,
    Image as ImageIcon,
    RefreshCw,
    Zap,
    ZapOff,
} from "lucide-react";
import { listStoredWhatsAppMessages } from "@/lib/whatsapp-message-store";
import type { StoredMessage } from "@/lib/whatsapp-crm";
import { whatsappManager } from "@/lib/whatsapp";
import { toast } from "sonner";

export type ShotType = "HERO" | "MACR" | "REVR" | "SCAL";

interface ProductPhotoTaggingModalProps {
    isOpen: boolean;
    onClose: () => void;
    onPhotoSelected: (imageData: string, shotType: ShotType) => void;
    initialShotType?: ShotType;
    productSku?: string;
    productName?: string;
}

interface WhatsAppImageItem {
    id: string;
    messageId?: string;
    senderName: string;
    mediaUrl: string;
    caption: string;
    timestamp: string;
}

// Chromium exposes the non-standard camera torch flag outside the standard
// MediaTrackCapabilities / MediaTrackConstraints DOM typings, so narrow
// extensions of those shapes are declared here.
interface TorchCapabilities extends MediaTrackCapabilities {
    torch?: boolean;
}
interface TorchConstraints extends MediaTrackConstraints {
    advanced?: (MediaTrackConstraintSet & { torch: boolean })[];
}

export function ProductPhotoTaggingModal({
    isOpen,
    onClose,
    onPhotoSelected,
    initialShotType = "HERO",
    productSku = "",
}: ProductPhotoTaggingModalProps) {
    const [activeTab, setActiveTab] = useState<"gallery" | "camera" | "whatsapp">("gallery");
    const [selectedShotType, setSelectedShotType] = useState<ShotType>(initialShotType);

    // Gallery upload state
    const [dragActive, setDragActive] = useState(false);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Camera state
    const videoRef = useRef<HTMLVideoElement>(null);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
    // Ref mirrors of the live stream + a session counter: they keep stopCamera's
    // identity stable (breaking the effect restart loop) and let startCamera stop
    // the previous stream / discard superseded getUserMedia results without a
    // stale closure.
    const cameraStreamRef = useRef<MediaStream | null>(null);
    const cameraSessionRef = useRef(0);
    const [, setIsCameraActive] = useState(false);
    const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
    const [torchOn, setTorchOn] = useState(false);
    const [torchSupported, setTorchSupported] = useState(false);
    const [capturedSnapshot, setCapturedSnapshot] = useState<string | null>(null);

    // WhatsApp messages state
    const [waImages, setWaImages] = useState<WhatsAppImageItem[]>([]);
    const [isLoadingWaImages, setIsLoadingWaImages] = useState(false);
    const [waSearchQuery, setWaSearchQuery] = useState("");

    const stopCamera = useCallback(() => {
        cameraSessionRef.current += 1;
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach((track) => track.stop());
            cameraStreamRef.current = null;
            setCameraStream(null);
        }
        setIsCameraActive(false);
        setTorchOn(false);
    }, []);

    // Reset when opened
    useEffect(() => {
        if (isOpen) {
            setPreviewImage(null);
            setCapturedSnapshot(null);
            setSelectedShotType(initialShotType);
        } else {
            stopCamera();
        }
    }, [isOpen, initialShotType, stopCamera]);

    // Handle Camera stream start/stop
    const startCamera = useCallback(async () => {
        const session = ++cameraSessionRef.current;
        try {
            if (cameraStreamRef.current) {
                cameraStreamRef.current.getTracks().forEach((track) => track.stop());
                cameraStreamRef.current = null;
            }

            const constraints: MediaStreamConstraints = {
                video: {
                    facingMode: facingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 960 },
                },
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (session !== cameraSessionRef.current) {
                // Superseded by a newer start or a stopCamera() while pending —
                // release this stream immediately instead of leaking it.
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            cameraStreamRef.current = stream;
            setCameraStream(stream);
            setIsCameraActive(true);

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }

            // Check torch capability
            const track = stream.getVideoTracks()[0];
            const capabilities: TorchCapabilities = track.getCapabilities?.() || {};
            setTorchSupported(!!capabilities.torch);
        } catch (err) {
            console.error("Camera access error:", err);
            toast.error("Could not access camera. Please check camera permissions.");
            setIsCameraActive(false);
        }
    }, [facingMode]);

    // Fetch images from WhatsApp chats in PocketBase
    const fetchWhatsAppImages = useCallback(async () => {
        setIsLoadingWaImages(true);
        try {
            const records = (await listStoredWhatsAppMessages()) as StoredMessage[];

            const imageMessages: WhatsAppImageItem[] = records
                .filter(
                    (r): r is StoredMessage & { media_url: string } =>
                        r.message_type === "image" && !!r.media_url
                )
                .map((r) => ({
                    id: r.id,
                    messageId: r.message_id || r.id,
                    senderName: r.sender_name || "Vendor / Contact",
                    mediaUrl: r.media_url,
                    caption: r.body || "",
                    timestamp: r.timestamp || r.created || "",
                }));

            setWaImages(imageMessages);
        } catch (err) {
            console.error("Failed to load WhatsApp images:", err);
            // If empty or initial state, gracefully fallback without intrusive error toast
            setWaImages([]);
        } finally {
            setIsLoadingWaImages(false);
        }
    }, []);

    // Switch tab effect
    useEffect(() => {
        if (activeTab === "camera" && isOpen && !capturedSnapshot) {
            startCamera();
        } else {
            stopCamera();
        }

        if (activeTab === "whatsapp" && isOpen) {
            fetchWhatsAppImages();
        }
    }, [activeTab, isOpen, capturedSnapshot, startCamera, stopCamera, fetchWhatsAppImages]);

    // Toggle Torch/Flash
    const toggleTorch = async () => {
        if (!cameraStream) return;
        const track = cameraStream.getVideoTracks()[0];
        try {
            const newTorchState = !torchOn;
            const constraints: TorchConstraints = {
                advanced: [{ torch: newTorchState }],
            };
            await track.applyConstraints(constraints);
            setTorchOn(newTorchState);
        } catch (e) {
            console.error("Failed to toggle torch:", e);
        }
    };

    // Toggle Camera Front/Back
    const toggleFacingMode = () => {
        setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
    };

    // Capture frame from video
    const handleCaptureSnapshot = () => {
        if (!videoRef.current) return;
        const video = videoRef.current;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL("image/webp", 0.9);
        setCapturedSnapshot(dataUrl);
        setPreviewImage(dataUrl);
        stopCamera();
    };

    const handleRetakeSnapshot = () => {
        setCapturedSnapshot(null);
        setPreviewImage(null);
        startCamera();
    };

    // Compress & set file from input or drag
    const processUploadedFile = (file: File) => {
        if (!file.type.startsWith("image/")) {
            toast.error("Please upload an image file (PNG, JPG, WEBP)");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // Resize to max 1200px width/height for fast loading
                const maxDim = 1200;
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) {
                        h = Math.round((h * maxDim) / w);
                        w = maxDim;
                    } else {
                        w = Math.round((w * maxDim) / h);
                        h = maxDim;
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.drawImage(img, 0, 0, w, h);
                    const compressedDataUrl = canvas.toDataURL("image/webp", 0.88);
                    setPreviewImage(compressedDataUrl);
                }
            };
            img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processUploadedFile(e.target.files[0]);
        }
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            processUploadedFile(e.dataTransfer.files[0]);
        }
    };

    const handleConfirmSelection = () => {
        if (!previewImage) {
            toast.error("Please choose or capture a photo first");
            return;
        }
        onPhotoSelected(previewImage, selectedShotType);
        toast.success(`Tagged ${selectedShotType} product photo successfully!`);
        onClose();
    };

    const filteredWaImages = waImages.filter((item) => {
        const query = waSearchQuery.toLowerCase();
        return (
            item.senderName.toLowerCase().includes(query) ||
            item.caption.toLowerCase().includes(query)
        );
    });

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="bg-card-bg border-surface-hover text-white max-w-2xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
                <DialogHeader className="pb-2 border-b border-surface-hover">
                    <DialogTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ImageIcon className="w-5 h-5 text-gold" />
                            <span>Product Photo Tagging</span>
                        </div>
                        {productSku && (
                            <Badge variant="outline" className="font-mono text-xs text-moonstone border-surface-hover">
                                {productSku}
                            </Badge>
                        )}
                    </DialogTitle>
                </DialogHeader>

                {/* Source Selection Tabs */}
                <div className="grid grid-cols-3 gap-2 mt-2 bg-surface-navy/70 p-1 rounded-xl border border-surface-hover">
                    <button
                        onClick={() => setActiveTab("gallery")}
                        className={`flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all ${
                            activeTab === "gallery"
                                ? "bg-gold text-navy-dark shadow-sm"
                                : "text-moonstone hover:text-white"
                        }`}
                    >
                        <Upload className="w-4 h-4" />
                        PC / Mobile Gallery
                    </button>
                    <button
                        onClick={() => setActiveTab("camera")}
                        className={`flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all ${
                            activeTab === "camera"
                                ? "bg-gold text-navy-dark shadow-sm"
                                : "text-moonstone hover:text-white"
                        }`}
                    >
                        <Camera className="w-4 h-4" />
                        Live Webcam / Mobile
                    </button>
                    <button
                        onClick={() => setActiveTab("whatsapp")}
                        className={`flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all ${
                            activeTab === "whatsapp"
                                ? "bg-gold text-navy-dark shadow-sm"
                                : "text-moonstone hover:text-white"
                        }`}
                    >
                        <MessageCircle className="w-4 h-4 text-emerald-400" />
                        Vendor WhatsApp
                    </button>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto py-3 space-y-4 pr-1">
                    {/* TAB 1: PC / Gallery */}
                    {activeTab === "gallery" && (
                        <div className="space-y-3">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileInputChange}
                                accept="image/*"
                                className="hidden"
                            />

                            {!previewImage ? (
                                <div
                                    onDragEnter={handleDrag}
                                    onDragLeave={handleDrag}
                                    onDragOver={handleDrag}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${
                                        dragActive
                                            ? "border-gold bg-gold/10"
                                            : "border-surface-hover hover:border-gold/50 bg-bg-navy/50"
                                    }`}
                                >
                                    <div className="w-14 h-14 rounded-full bg-gold/10 flex items-center justify-center mb-3 text-gold">
                                        <Upload className="w-7 h-7" />
                                    </div>
                                    <p className="text-sm font-semibold text-white">Click or drag & drop product photo</p>
                                    <p className="text-xs text-moonstone mt-1">Supports JPEG, PNG, WEBP from your phone or PC</p>
                                    <Button
                                        size="sm"
                                        className="mt-4 bg-surface-navy hover:bg-surface-hover text-white text-xs border border-surface-hover"
                                    >
                                        Browse Files
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="relative aspect-video max-h-64 rounded-xl overflow-hidden border border-surface-hover bg-bg-navy flex items-center justify-center">
                                        {/* eslint-disable-next-line @next/next/no-img-element -- previewImage is a canvas/FileReader data URL with unknowable intrinsic dimensions, so next/image sizing props do not map */}
                                        <img
                                            src={previewImage}
                                            alt="Preview"
                                            className="max-h-full max-w-full object-contain"
                                        />
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => setPreviewImage(null)}
                                            className="absolute top-2 right-2 bg-black/60 hover:bg-black/90 text-white rounded-full p-1.5 h-auto"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-full text-xs border-surface-hover text-moonstone hover:text-white"
                                    >
                                        Choose Different File
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 2: Camera Capture */}
                    {activeTab === "camera" && (
                        <div className="space-y-3">
                            {!capturedSnapshot ? (
                                <div className="space-y-3">
                                    <div className="relative aspect-video max-h-64 bg-black rounded-xl overflow-hidden border border-surface-hover flex items-center justify-center">
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            className="w-full h-full object-cover"
                                        />
                                        {/* Optical Crosshair Viewfinder */}
                                        <div className="absolute inset-8 border border-white/20 rounded-lg pointer-events-none flex items-center justify-center">
                                            <div className="w-4 h-4 border-t-2 border-l-2 border-gold absolute top-0 left-0" />
                                            <div className="w-4 h-4 border-t-2 border-r-2 border-gold absolute top-0 right-0" />
                                            <div className="w-4 h-4 border-b-2 border-l-2 border-gold absolute bottom-0 left-0" />
                                            <div className="w-4 h-4 border-b-2 border-r-2 border-gold absolute bottom-0 right-0" />
                                            <span className="text-[10px] text-white/50 bg-black/40 px-2 py-0.5 rounded">
                                                Center Jewelry Piece
                                            </span>
                                        </div>

                                        {/* Floating Camera Controls */}
                                        <div className="absolute bottom-3 right-3 flex items-center gap-2">
                                            {torchSupported && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={toggleTorch}
                                                    className={`rounded-full p-2 h-auto ${
                                                        torchOn
                                                            ? "bg-amber-400 text-black border-amber-300"
                                                            : "bg-black/60 text-white border-white/20"
                                                    }`}
                                                    title="Toggle Torch / Flash"
                                                >
                                                    {torchOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={toggleFacingMode}
                                                className="bg-black/60 hover:bg-black/90 text-white rounded-full p-2 h-auto border-white/20"
                                                title="Switch Camera"
                                            >
                                                <RotateCw className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    <Button
                                        onClick={handleCaptureSnapshot}
                                        className="w-full bg-gold hover:bg-gold-light text-navy-dark font-bold flex items-center justify-center gap-2"
                                    >
                                        <Camera className="w-4 h-4" />
                                        Capture Snapshot
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="relative aspect-video max-h-64 rounded-xl overflow-hidden border border-surface-hover bg-bg-navy flex items-center justify-center">
                                        {/* eslint-disable-next-line @next/next/no-img-element -- capturedSnapshot is a canvas.toDataURL snapshot with dynamic dimensions, so next/image sizing props do not map */}
                                        <img
                                            src={capturedSnapshot}
                                            alt="Captured"
                                            className="max-h-full max-w-full object-contain"
                                        />
                                        <Badge className="absolute top-2 left-2 bg-emerald-600/90 text-white text-[10px]">
                                            Photo Captured
                                        </Badge>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={handleRetakeSnapshot}
                                            className="flex-1 border-surface-hover text-moonstone hover:text-white"
                                        >
                                            Retake
                                        </Button>
                                        <Button
                                            onClick={() => setPreviewImage(capturedSnapshot)}
                                            className="flex-1 bg-gold hover:bg-gold-light text-navy-dark font-bold"
                                        >
                                            Use This Photo
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 3: Vendor WhatsApp Messages */}
                    {activeTab === "whatsapp" && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="w-4 h-4 text-moonstone absolute left-3 top-1/2 -translate-y-1/2" />
                                    <Input
                                        placeholder="Search by vendor name or description..."
                                        value={waSearchQuery}
                                        onChange={(e) => setWaSearchQuery(e.target.value)}
                                        className="pl-9 bg-bg-navy border-surface-hover text-white text-xs"
                                    />
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={fetchWhatsAppImages}
                                    disabled={isLoadingWaImages}
                                    className="border-surface-hover text-moonstone hover:text-white text-xs px-2.5"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingWaImages ? "animate-spin" : ""}`} />
                                </Button>
                            </div>

                            {isLoadingWaImages ? (
                                <div className="py-12 text-center text-moonstone text-xs flex flex-col items-center gap-2">
                                    <RefreshCw className="w-5 h-5 animate-spin text-gold" />
                                    Loading vendor media from WhatsApp...
                                </div>
                            ) : filteredWaImages.length === 0 ? (
                                <div className="py-12 text-center text-moonstone text-xs bg-bg-navy/40 rounded-xl border border-surface-hover">
                                    <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30 text-emerald-400" />
                                    <p>No image messages found in WhatsApp CRM.</p>
                                    <p className="text-[11px] opacity-70 mt-1">
                                        Photos sent by jewelry vendors in WhatsApp chats appear here automatically.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-2.5 max-h-60 overflow-y-auto pr-1">
                                    {filteredWaImages.map((item) => {
                                        const isSelected = previewImage === item.mediaUrl;
                                        return (
                                            <div
                                                key={item.id}
                                                onClick={async () => {
                                                    let targetMedia = item.mediaUrl;
                                                    if (!targetMedia || targetMedia.includes('whatsapp.net') || !targetMedia.startsWith('data:')) {
                                                        try {
                                                            const decrypted = await whatsappManager.downloadMedia(item.messageId || item.id);
                                                            if (decrypted) {
                                                                targetMedia = decrypted;
                                                            }
                                                        } catch (e) {
                                                            console.warn("Failed to decrypt WhatsApp image:", e);
                                                        }
                                                    }
                                                    setPreviewImage(targetMedia);
                                                }}
                                                className={`group relative aspect-square rounded-lg overflow-hidden border cursor-pointer transition-all ${
                                                    isSelected
                                                        ? "border-gold ring-2 ring-gold/50"
                                                        : "border-surface-hover hover:border-gold/40"
                                                }`}
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element -- mediaUrl is remote WhatsApp-sidecar media from a runtime-configured host with unknown dimensions and a direct DOM error-fallback */}
                                                <img
                                                    src={item.mediaUrl}
                                                    alt={item.caption || "WhatsApp"}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                                    onError={(e) => {
                                                        // Fallback icon on broken image URL
                                                        (e.target as HTMLImageElement).style.display = "none";
                                                    }}
                                                />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-1.5">
                                                    <p className="text-[10px] font-bold text-white truncate">
                                                        {item.senderName}
                                                    </p>
                                                    <p className="text-[9px] text-moonstone truncate">
                                                        {new Date(item.timestamp).toLocaleDateString()}
                                                    </p>
                                                </div>
                                                {isSelected && (
                                                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-gold text-navy-dark flex items-center justify-center">
                                                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Shot Type Tagging Selector (Spec §Digital Asset Pipeline) */}
                    <div className="p-3 bg-surface-navy/70 rounded-xl border border-surface-hover space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-gold" />
                                Shot Type Tag
                            </span>
                            <span className="text-[10px] text-moonstone">Used for anti-fraud POS match & catalog</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                            {(
                                [
                                    { code: "HERO", label: "HERO Front", desc: "Catalog master" },
                                    { code: "MACR", label: "MACR Prongs", desc: "Macro stone detail" },
                                    { code: "REVR", label: "REVR Back", desc: "Reverse craftsmanship" },
                                    { code: "SCAL", label: "SCAL Scale", desc: "Size on bust / ruler" },
                                ] as const
                            ).map((shot) => {
                                const isSelected = selectedShotType === shot.code;
                                return (
                                    <button
                                        key={shot.code}
                                        type="button"
                                        onClick={() => setSelectedShotType(shot.code)}
                                        className={`p-2 rounded-lg border text-left transition-all ${
                                            isSelected
                                                ? "border-gold bg-gold/15 text-white"
                                                : "border-surface-hover bg-bg-navy/40 text-moonstone hover:text-white"
                                        }`}
                                    >
                                        <p className="text-[11px] font-bold">{shot.label}</p>
                                        <p className="text-[9px] opacity-70 truncate">{shot.desc}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <DialogFooter className="pt-2 border-t border-surface-hover flex items-center justify-between">
                    <Button variant="ghost" onClick={onClose} className="text-moonstone text-xs">
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirmSelection}
                        disabled={!previewImage}
                        className="bg-gold hover:bg-gold-light text-navy-dark font-bold text-xs px-5"
                    >
                        Attach Photo
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
