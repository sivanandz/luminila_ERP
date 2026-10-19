"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, RefreshCw, Zap, ZapOff, ZoomIn } from "lucide-react";

interface BarcodeScannerProps {
    onScan: (code: string) => void;
    onError?: (error: string) => void;
    isActive?: boolean;
}

// Chromium exposes the non-standard camera torch flag outside the standard
// MediaTrackConstraintSet DOM typings, so the constraints shape is narrowed
// through this extension (same pattern as ProductPhotoTaggingModal).
interface TorchConstraints extends MediaTrackConstraints {
    advanced?: (MediaTrackConstraintSet & { torch: boolean })[];
}

export function BarcodeScanner({ onScan, onError, isActive = true }: BarcodeScannerProps) {
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [hasPermission, setHasPermission] = useState<boolean | null>(null);
    const [lastScanned, setLastScanned] = useState<string | null>(null);
    const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
    const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
    const [zoom2x, setZoom2x] = useState(true);
    const [torchOn, setTorchOn] = useState(false);

    // Debounce to prevent rapid-fire scans of the same code
    const handleScan = useCallback((decodedText: string) => {
        if (decodedText !== lastScanned) {
            setLastScanned(decodedText);
            onScan(decodedText);

            // Reset after 2 seconds to allow re-scanning same code
            setTimeout(() => setLastScanned(null), 2000);
        }
    }, [lastScanned, onScan]);

    // Keep latest callbacks in refs so their identity churn (lastScanned
    // debounce, inline parent props) does not tear down the camera.
    const handleScanRef = useRef(handleScan);
    useEffect(() => {
        handleScanRef.current = handleScan;
    }, [handleScan]);

    const onErrorRef = useRef(onError);
    useEffect(() => {
        onErrorRef.current = onError;
    }, [onError]);

    // Get available cameras (once; onError is read via ref)
    useEffect(() => {
        Html5Qrcode.getCameras()
            .then((devices) => {
                if (devices && devices.length > 0) {
                    setCameras(devices.map((d) => ({ id: d.id, label: d.label || `Camera ${d.id}` })));
                    setSelectedCamera(devices[0].id);
                    setHasPermission(true);
                } else {
                    setHasPermission(false);
                }
            })
            .catch((err) => {
                console.error("Error getting cameras:", err);
                setHasPermission(false);
                onErrorRef.current?.("Could not access camera. Please grant permission.");
            });
    }, []);

    // Start/stop scanner based on isActive prop. Depends only on the camera
    // identity, never on callback props — scan callbacks are read via refs.
    useEffect(() => {
        if (!isActive || !selectedCamera || !containerRef.current) return;

        const scannerId = "barcode-scanner-view";

        // Create scanner instance
        const scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;

        // start() resolved: stop() is now safe (it throws before that).
        let started = false;
        // Effect cleaned up while start() was pending: stop the camera as
        // soon as start settles instead of leaking a live scanner.
        let cancelled = false;

        const startScanner = async () => {
            try {
                await scanner.start(
                    selectedCamera,
                    {
                        fps: 10,
                        qrbox: { width: 250, height: 150 },
                        aspectRatio: 1.5,
                    },
                    (decodedText) => handleScanRef.current(decodedText),
                    (errorMessage) => {
                        // Ignore decode errors (normal when no barcode in view)
                        if (!errorMessage.includes("No barcode")) {
                            console.debug("Scan error:", errorMessage);
                        }
                    }
                );
                started = true;
                if (cancelled) {
                    scanner.stop().catch(console.error);
                    return;
                }
                setIsScanning(true);
            } catch (err) {
                if (cancelled) return;
                console.error("Failed to start scanner:", err);
                onErrorRef.current?.("Failed to start camera scanner.");
                setIsScanning(false);
            }
        };

        startScanner();

        return () => {
            cancelled = true;
            scannerRef.current = null;
            if (started) {
                scanner.stop().catch(console.error);
            }
            // If start is still pending, the resolved handler above stops it.
        };
    }, [isActive, selectedCamera]);

    // Switch camera
    const switchCamera = async () => {
        if (cameras.length <= 1) return;

        const currentIndex = cameras.findIndex((c) => c.id === selectedCamera);
        const nextIndex = (currentIndex + 1) % cameras.length;

        if (scannerRef.current?.isScanning) {
            await scannerRef.current.stop();
        }
        setSelectedCamera(cameras[nextIndex].id);
    };

    // Permission denied or no camera
    if (hasPermission === false) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-navy-dark rounded-lg p-8 text-center">
                <CameraOff size={48} className="text-silver-dark mb-4" />
                <p className="text-silver font-medium">Camera Access Denied</p>
                <p className="text-silver-dark text-sm mt-2">
                    Please enable camera permissions in your browser settings
                </p>
                <button
                    onClick={() => window.location.reload()}
                    className="btn btn-gold mt-4"
                >
                    <RefreshCw size={18} />
                    Retry
                </button>
            </div>
        );
    }

    // Loading state
    if (hasPermission === null) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-navy-dark rounded-lg p-8">
                <div className="animate-pulse">
                    <Camera size={48} className="text-silver-dark" />
                </div>
                <p className="text-silver mt-4">Initializing camera...</p>
            </div>
        );
    }

    return (
        <div className="relative h-full bg-navy-dark rounded-lg overflow-hidden" ref={containerRef}>
            {/* Scanner View */}
            <div id="barcode-scanner-view" className="w-full h-full" />

            {/* Overlay */}
            <div className="absolute inset-0 pointer-events-none">
                {/* Scanning frame */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-64 h-32 border-2 border-gold rounded-lg relative">
                        {/* Corner accents */}
                        <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-gold" />
                        <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-gold" />
                        <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-gold" />
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-gold" />

                        {/* Scanning line animation */}
                        {isScanning && (
                            <div className="absolute top-0 left-2 right-2 h-0.5 bg-gold animate-pulse"
                                style={{ animation: "scanline 2s ease-in-out infinite" }} />
                        )}
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-auto gap-2">
                {/* Status */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-navy/80 rounded-full text-xs">
                    <div className={`w-2 h-2 rounded-full ${isScanning ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                    <span className="text-white font-medium">{isScanning ? "Scanning..." : "Stopped"}</span>
                </div>

                <div className="flex items-center gap-2">
                    {/* 2x Center Sensor Crop Toggle */}
                    <button
                        type="button"
                        onClick={() => setZoom2x(!zoom2x)}
                        className={`px-2.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all ${
                            zoom2x
                                ? "bg-gold text-bg-navy shadow-md scale-105"
                                : "bg-navy/80 text-white/80 hover:bg-navy"
                        }`}
                        title="2× Center Sensor Crop for Micro Dumbbell Tags"
                    >
                        <ZoomIn size={14} />
                        <span>2× Crop</span>
                    </button>

                    {/* Torch Toggle */}
                    <button
                        type="button"
                        onClick={() => {
                            const nextState = !torchOn;
                            setTorchOn(nextState);
                            try {
                                // getRunningTrack is not on Html5Qrcode's public type but may exist at runtime; probe defensively.
                                const track = (
                                    scannerRef.current as Html5Qrcode & { getRunningTrack?: () => MediaStreamTrack | undefined }
                                )?.getRunningTrack?.();
                                if (track && typeof track.applyConstraints === "function") {
                                    const constraints: TorchConstraints = { advanced: [{ torch: nextState }] };
                                    track.applyConstraints(constraints);
                                }
                            } catch (e) {
                                console.debug("Torch not supported on this device", e);
                            }
                        }}
                        className={`p-2 rounded-full transition-colors ${
                            torchOn ? "bg-amber-400 text-bg-navy" : "bg-navy/80 text-white hover:bg-navy"
                        }`}
                        title={torchOn ? "Turn off torch" : "Turn on anti-glare torch"}
                    >
                        {torchOn ? <Zap size={16} /> : <ZapOff size={16} />}
                    </button>

                    {/* Camera switch */}
                    {cameras.length > 1 && (
                        <button
                            onClick={switchCamera}
                            className="p-2 bg-navy/80 rounded-full hover:bg-navy transition-colors text-white"
                            title="Switch camera"
                        >
                            <RefreshCw size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Last scanned indicator */}
            {lastScanned && (
                <div className="absolute top-4 left-4 right-4 bg-emerald-600/90 text-white px-4 py-2 rounded-lg text-center animate-fade-in shadow-lg">
                    Scanned: <span className="font-mono font-bold">{lastScanned}</span>
                </div>
            )}

            {/* Style for scan line animation and 2x crop */}
            <style jsx>{`
                @keyframes scanline {
                    0%, 100% { transform: translateY(0); opacity: 1; }
                    50% { transform: translateY(120px); opacity: 0.5; }
                }
                :global(#barcode-scanner-view video) {
                    transition: transform 0.3s ease-out;
                    transform: ${zoom2x ? "scale(1.85)" : "scale(1)"} !important;
                    transform-origin: center center !important;
                }
            `}</style>
        </div>
    );
}


