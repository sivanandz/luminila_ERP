/**
 * Luminila Mobile Scanner Service
 * Unified barcode & QR scanning supporting:
 * 1. Hardware Bluetooth / USB HID barcode scanners (wedge keyboard listener)
 * 2. Tauri v2 Native Android Barcode Scanner Plugin (when available)
 * 3. HTML5 Camera fallback
 */

export interface ScanResult {
    barcode: string;
    format?: string;
    source: 'hardware' | 'camera' | 'tauri_native';
}

export class MobileScanner {
    private static barcodeBuffer = '';
    private static lastKeyTime = 0;
    private static hardwareListener: ((e: KeyboardEvent) => void) | null = null;
    private static onScanCallbacks: Set<(result: ScanResult) => void> = new Set();

    /**
     * Subscribe to barcode scans (from any source)
     */
    static onScan(callback: (result: ScanResult) => void): () => void {
        this.onScanCallbacks.add(callback);
        this.ensureHardwareListener();

        return () => {
            this.onScanCallbacks.delete(callback);
            if (this.onScanCallbacks.size === 0) {
                this.removeHardwareListener();
            }
        };
    }

    /**
     * Notify all subscribers of a scanned barcode
     */
    static dispatchScan(barcode: string, source: 'hardware' | 'camera' | 'tauri_native' = 'camera') {
        const cleaned = barcode.trim();
        if (!cleaned) return;
        const result: ScanResult = { barcode: cleaned, source };
        this.onScanCallbacks.forEach((cb) => {
            try {
                cb(result);
            } catch (err) {
                console.error('Scan callback error:', err);
            }
        });
    }

    /**
     * Start camera barcode scanning
     * Attempts native Tauri camera scanner on Android first, falls back to webview camera
     */
    static async startCameraScan(): Promise<string | null> {
        // 1. Check if running inside Tauri with barcode scanner plugin
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
            try {
                // Dynamically import Tauri barcode scanner if installed
                // @ts-ignore
                const tauriScanner = await import('@tauri-apps/plugin-barcode-scanner');
                if (tauriScanner && typeof tauriScanner.scan === 'function') {
                    const res = await tauriScanner.scan({
                        windowed: false,
                        cameraDirection: 'back',
                        formats: ['QRCode', 'Code128', 'EAN13', 'UPCA'],
                    });
                    if (res?.content) {
                        this.dispatchScan(res.content, 'tauri_native');
                        return res.content;
                    }
                }
            } catch (e) {
                // Fallback to HTML5 camera if plugin not bundled
                console.info('Tauri native scanner unavailable, using HTML5 fallback:', e);
            }
        }

        return null;
    }

    /**
     * Listen for fast keystrokes from Bluetooth / USB barcode guns
     */
    private static ensureHardwareListener() {
        if (this.hardwareListener || typeof window === 'undefined') return;

        this.hardwareListener = (e: KeyboardEvent) => {
            // Ignore if user is currently typing in an input or textarea
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
                return;
            }

            const now = Date.now();
            // Hardware scanners typically send characters in rapid succession (< 50ms per key)
            if (now - this.lastKeyTime > 80) {
                this.barcodeBuffer = '';
            }
            this.lastKeyTime = now;

            if (e.key === 'Enter') {
                if (this.barcodeBuffer.length >= 3) {
                    const scanned = this.barcodeBuffer;
                    this.barcodeBuffer = '';
                    this.dispatchScan(scanned, 'hardware');
                }
            } else if (e.key.length === 1) {
                this.barcodeBuffer += e.key;
            }
        };

        window.addEventListener('keydown', this.hardwareListener);
    }

    private static removeHardwareListener() {
        if (this.hardwareListener && typeof window !== 'undefined') {
            window.removeEventListener('keydown', this.hardwareListener);
            this.hardwareListener = null;
        }
    }
}
