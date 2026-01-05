"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, CameraOff, RefreshCw } from "lucide-react";

interface BarcodeScannerProps {
    onScan: (code: string) => void;
    onError?: (error: string) => void;
    isActive?: boolean;
}

export function BarcodeScanner({ onScan, onError, isActive = true }: BarcodeScannerProps) {
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [hasPermission, setHasPermission] = useState<boolean | null>(null);
    const [lastScanned, setLastScanned] = useState<string | null>(null);
    const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
    const [selectedCamera, setSelectedCamera] = useState<string | null>(null);

    // Debounce to prevent rapid-fire scans of the same code
    const handleScan = useCallback((decodedText: string) => {
        if (decodedText !== lastScanned) {
            setLastScanned(decodedText);
            onScan(decodedText);

            // Reset after 2 seconds to allow re-scanning same code
            setTimeout(() => setLastScanned(null), 2000);
        }
    }, [lastScanned, onScan]);

    // Get available cameras
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
                onError?.("Could not access camera. Please grant permission.");
            });
    }, [onError]);

    // Start/stop scanner based on isActive prop
    useEffect(() => {
        if (!isActive || !selectedCamera || !containerRef.current) return;

        const scannerId = "barcode-scanner-view";

        // Create scanner instance
        scannerRef.current = new Html5Qrcode(scannerId);

        const startScanner = async () => {
            try {
                await scannerRef.current?.start(
                    selectedCamera,
                    {
                        fps: 10,
                        qrbox: { width: 250, height: 150 },
                        aspectRatio: 1.5,
                    },
                    handleScan,
                    (errorMessage) => {
                        // Ignore decode errors (normal when no barcode in view)
                        if (!errorMessage.includes("No barcode")) {
                            console.debug("Scan error:", errorMessage);
                        }
                    }
                );
                setIsScanning(true);
            } catch (err) {
                console.error("Failed to start scanner:", err);
                onError?.("Failed to start camera scanner.");
                setIsScanning(false);
            }
        };

        startScanner();

        return () => {
            if (scannerRef.current?.isScanning) {
                scannerRef.current.stop().catch(console.error);
            }
        };
    }, [isActive, selectedCamera, handleScan, onError]);

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
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-auto">
                {/* Status */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-navy/80 rounded-full text-sm">
                    <div className={`w-2 h-2 rounded-full ${isScanning ? "bg-success animate-pulse" : "bg-error"}`} />
                    <span className="text-white">{isScanning ? "Scanning..." : "Stopped"}</span>
                </div>

                {/* Camera switch */}
                {cameras.length > 1 && (
                    <button
                        onClick={switchCamera}
                        className="p-2 bg-navy/80 rounded-full hover:bg-navy transition-colors"
                    >
                        <RefreshCw size={20} className="text-white" />
                    </button>
                )}
            </div>

            {/* Last scanned indicator */}
            {lastScanned && (
                <div className="absolute top-4 left-4 right-4 bg-success/90 text-white px-4 py-2 rounded-lg text-center animate-fade-in">
                    Scanned: <span className="font-mono font-bold">{lastScanned}</span>
                </div>
            )}

            {/* Style for scan line animation */}
            <style jsx>{`
        @keyframes scanline {
          0%, 100% { transform: translateY(0); opacity: 1; }
          50% { transform: translateY(120px); opacity: 0.5; }
        }
      `}</style>
        </div>
    );
}
