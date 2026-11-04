/**
 * Luminila Context-Aware Mobile Scanner Service
 * Unified barcode & QR scanning supporting:
 * 1. Hardware Bluetooth / USB HID barcode scanners (wedge keyboard listener)
 * 2. Context-aware priority stack routing (shipping AWB vs billing vs inventory vs modal)
 * 3. Tauri v2 Native Android Barcode Scanner Plugin (when available)
 * 4. HTML5 Camera fallback
 */

import { soundEffects } from './sound-effects';

export interface ScanResult {
    barcode: string;
    format?: string;
    source: 'hardware' | 'camera' | 'tauri_native';
    context?: ScannerContextType;
}

export type ScannerContextType =
    | 'shipping_awb'      // Priority 100: Parcels & Logistics AWBs (ST Courier, Delhivery, etc.)
    | 'active_modal'      // Priority 90: Popups & Quick modals
    | 'discrepancy_audit' // Priority 85: Stock audit & tray reconciliation
    | 'packing_station'   // Priority 80: Packing & dispatch scan verification
    | 'inventory_form'    // Priority 70: Creating/editing product SKU/barcode
    | 'challan_entry'     // Priority 60: Line item entry in Delivery Challans
    | 'invoice_entry'     // Priority 60: Line item entry in Invoices
    | 'orders_entry'      // Priority 60: Line item entry in Orders
    | 'inventory_search'  // Priority 50: Catalog search in Inventory
    | 'pos_billing'       // Priority 40: Main POS retail counter
    | 'global';           // Priority 10: Fallback

export const CONTEXT_PRIORITIES: Record<ScannerContextType, number> = {
    shipping_awb: 100,
    active_modal: 90,
    discrepancy_audit: 85,
    packing_station: 80,
    inventory_form: 70,
    challan_entry: 60,
    invoice_entry: 60,
    orders_entry: 60,
    inventory_search: 50,
    pos_billing: 40,
    global: 10,
};

interface RegisteredHandler {
    id: string;
    context: ScannerContextType;
    priority: number;
    callback: (result: ScanResult) => boolean | void | Promise<boolean | void>;
}

export class MobileScanner {
    private static barcodeBuffer = '';
    private static lastKeyTime = 0;
    private static hardwareListener: ((e: KeyboardEvent) => void) | null = null;
    private static handlers: RegisteredHandler[] = [];
    private static nextId = 1;

    /**
     * Register a scoped scanner context handler with priority.
     * High priority handlers (e.g. shipping AWB modal) intercept the scan first.
     * If the handler handles it (returns undefined, true, or resolved promise), lower priority handlers are bypassed.
     */
    static registerContext(
        context: ScannerContextType,
        callback: (result: ScanResult) => boolean | void | Promise<boolean | void>,
        customPriority?: number
    ): () => void {
        const id = `handler_${this.nextId++}`;
        const priority = customPriority !== undefined ? customPriority : CONTEXT_PRIORITIES[context] || 10;

        const newHandler: RegisteredHandler = { id, context, priority, callback };
        this.handlers.push(newHandler);
        // Sort descending by priority
        this.handlers.sort((a, b) => b.priority - a.priority);

        this.ensureHardwareListener();

        return () => {
            this.handlers = this.handlers.filter((h) => h.id !== id);
            if (this.handlers.length === 0) {
                this.removeHardwareListener();
            }
        };
    }

    /**
     * Subscribe to barcode scans (backwards compatible wrapper around registerContext)
     */
    static onScan(
        callback: (result: ScanResult) => boolean | void | Promise<boolean | void>,
        context: ScannerContextType = 'global',
        priority?: number
    ): () => void {
        return this.registerContext(context, callback, priority);
    }

    /**
     * Returns the name of the currently dominant active context
     */
    static getActiveContext(): ScannerContextType | null {
        return this.handlers.length > 0 ? this.handlers[0].context : null;
    }

    /**
     * Notify subscribers of a scanned barcode in strict priority order.
     *
     * Async handlers are awaited before deciding whether the scan was consumed
     * (I7): a promise is not `false`, so the old synchronous check let a handler
     * that eventually resolved `false` block every lower-priority context.
     */
    static async dispatchScan(
        barcode: string,
        source: 'hardware' | 'camera' | 'tauri_native' = 'camera'
    ): Promise<boolean> {
        const cleaned = barcode.trim();
        if (!cleaned) return false;

        const activeContext = this.getActiveContext() || 'global';
        const result: ScanResult = { barcode: cleaned, source, context: activeContext };

        console.info(`[Barcode Scan] Value: "${cleaned}" | Source: ${source} | Target Context: ${activeContext}`);

        // Dispatch to registered handlers starting from highest priority
        for (const handler of [...this.handlers]) {
            try {
                const handled = await handler.callback({ ...result, context: handler.context });
                // If the handler returned false, allow lower priority handlers to run.
                // Otherwise (returned true or void), consume the scan exclusively.
                if (handled !== false) {
                    return true;
                }
            } catch (err) {
                console.error(`Error in scanner handler [${handler.context}]:`, err);
            }
        }

        return false;
    }

    /**
     * Start camera barcode scanning
     * Attempts native Tauri camera scanner on Android first, then falls back to
     * the browser's BarcodeDetector (I8 — the fallback was documented but absent).
     */
    static async startCameraScan(): Promise<string | null> {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
            try {
                // Dynamically access optional plugin if running in Tauri environment
                const pluginModule = '@tauri-apps/plugin-barcode-scanner';
                const tauriScanner: any = await (Function('m', 'return import(m)')(pluginModule)).catch(() => null);
                if (tauriScanner && typeof tauriScanner.scan === 'function') {
                    const res = await tauriScanner.scan({
                        windowed: false,
                        cameraDirection: 'back',
                        // DataMatrix: jewelry dumbbell tags default to ECC200 —
                        // without it the native scanner ignores the most common tag.
                        formats: ['QRCode', 'Code128', 'EAN13', 'UPCA', 'DataMatrix'],
                    });
                    if (res?.content) {
                        await this.dispatchScan(res.content, 'tauri_native');
                        return res.content;
                    }
                }
            } catch (e) {
                console.info('Tauri native scanner unavailable, using HTML5 fallback:', e);
            }
        }

        return this.scanWithBrowserCamera();
    }

    /** HTML5 camera fallback using the BarcodeDetector API. */
    private static async scanWithBrowserCamera(): Promise<string | null> {
        if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera scanning is not supported on this device.');
        }

        type DetectedBarcode = { rawValue?: string };
        const Detector = (
            window as unknown as {
                BarcodeDetector?: new (options?: { formats?: string[] }) => {
                    detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
                };
            }
        ).BarcodeDetector;
        if (!Detector) {
            throw new Error('Camera barcode detection is not supported by this browser.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false,
        });
        const video = document.createElement('video');
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        video.srcObject = stream;

        try {
            await video.play();
            const detector = new Detector({
                formats: ['qr_code', 'code_128', 'ean_13', 'data_matrix', 'upc_a'],
            });
            const canvas = document.createElement('canvas');
            const deadline = Date.now() + 30_000;

            while (Date.now() < deadline) {
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    const context = canvas.getContext('2d');
                    if (context) {
                        context.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const codes = await detector.detect(canvas);
                        const value = codes[0]?.rawValue?.trim();
                        if (value) {
                            await this.dispatchScan(value, 'camera');
                            return value;
                        }
                    }
                }
                await new Promise((resolve) => setTimeout(resolve, 250));
            }

            return null;
        } finally {
            stream.getTracks().forEach((track) => track.stop());
            video.srcObject = null;
        }
    }

    /**
     * Listen for fast keystrokes from Bluetooth / USB barcode guns (HID Keyboard Wedge)
     */
    private static ensureHardwareListener() {
        if (this.hardwareListener || typeof window === 'undefined') return;

        this.hardwareListener = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const isDedicatedScannerInput =
                target?.getAttribute('data-scanner-input') === 'true' ||
                target?.getAttribute('data-barcode-target') === 'true' ||
                target?.id === 'barcode-scanner-input';
            const isRegularInput =
                target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !isDedicatedScannerInput;

            const now = Date.now();
            const elapsed = now - this.lastKeyTime;

            // Hardware scanners typically stream characters in rapid succession (< 80ms per key)
            if (elapsed > 100) {
                this.barcodeBuffer = '';
            }
            this.lastKeyTime = now;

            if (e.key === 'Enter') {
                if (this.barcodeBuffer.length >= 3) {
                    const scanned = this.barcodeBuffer.trim();
                    this.barcodeBuffer = '';

                    // Prevent enter submitting standard form or adding newline in textarea
                    e.preventDefault();

                    // I9: only a dedicated scanner field is written back. A
                    // regular input's content is never blanked — that destroyed
                    // whatever the operator had typed.
                    if (isDedicatedScannerInput && target instanceof HTMLInputElement) {
                        target.value = scanned;
                        target.dispatchEvent(new Event('input', { bubbles: true }));
                        target.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    soundEffects.playScanSuccess();
                    void this.dispatchScan(scanned, 'hardware');
                }
            } else if (e.key.length === 1) {
                // If the user is typing slowly by hand in a standard text field (> 100ms between keys), don't buffer
                if (isRegularInput && elapsed > 100 && this.barcodeBuffer.length === 0) {
                    return;
                }
                this.barcodeBuffer += e.key;
            }
        };

        window.addEventListener('keydown', this.hardwareListener, true);
    }

    private static removeHardwareListener() {
        if (this.hardwareListener && typeof window !== 'undefined') {
            window.removeEventListener('keydown', this.hardwareListener, true);
            this.hardwareListener = null;
        }
    }
}
