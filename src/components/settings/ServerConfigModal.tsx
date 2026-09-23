"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getPocketBaseUrl, setPocketBaseUrl, checkServerStatus, ServerHealthResult } from "@/lib/pocketbase";
import { getWhatsAppUrl, setWhatsAppUrl, checkWhatsAppStatus } from "@/lib/whatsapp";
import { Wifi, CheckCircle2, XCircle, Loader2, Globe, Laptop, HelpCircle, ShieldCheck, MessageSquare } from "lucide-react";

interface ServerConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ServerConfigModal({ isOpen, onClose }: ServerConfigModalProps) {
    const [serverUrl, setServerUrl] = useState("");
    const [status, setStatus] = useState<ServerHealthResult | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [isSaved, setIsSaved] = useState(false);

    // WhatsApp sidecar configuration state
    const [waUrl, setWaUrl] = useState("");
    const [waStatus, setWaStatus] = useState<{ ok: boolean; url: string; isTunnel: boolean; latencyMs?: number; error?: string } | null>(null);
    const [isTestingWa, setIsTestingWa] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const currentUrl = getPocketBaseUrl();
            setServerUrl(currentUrl);
            const currentWaUrl = getWhatsAppUrl();
            setWaUrl(currentWaUrl);
            setIsSaved(false);
            // Auto test current connection
            testConnection(currentUrl);
            testWaConnection(currentWaUrl);
        }
    }, [isOpen]);

    const testConnection = async (urlToTest: string) => {
        if (!urlToTest.trim()) return;
        setIsTesting(true);
        setStatus(null);
        try {
            const res = await checkServerStatus(urlToTest.trim());
            setStatus(res);
        } finally {
            setIsTesting(false);
        }
    };

    const testWaConnection = async (urlToTest: string) => {
        if (!urlToTest.trim()) return;
        setIsTestingWa(true);
        setWaStatus(null);
        try {
            const res = await checkWhatsAppStatus(urlToTest.trim());
            setWaStatus(res);
        } finally {
            setIsTestingWa(false);
        }
    };

    const handleSave = () => {
        if (!serverUrl.trim()) return;
        setPocketBaseUrl(serverUrl.trim());
        if (waUrl.trim()) {
            setWhatsAppUrl(waUrl.trim());
        }
        setIsSaved(true);
        setTimeout(() => {
            onClose();
        }, 600);
    };

    const setPreset = (presetPbUrl: string, presetWaUrl?: string) => {
        setServerUrl(presetPbUrl);
        testConnection(presetPbUrl);
        if (presetWaUrl) {
            setWaUrl(presetWaUrl);
            testWaConnection(presetWaUrl);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md bg-card border-border">
                <DialogHeader>
                    <div className="flex items-center gap-2.5">
                        <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            <Wifi size={20} />
                        </div>
                        <div>
                            <DialogTitle className="text-base font-bold text-foreground">
                                Server Connection Settings
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground">
                                Connect to showroom PC via LAN or secure Cloudflare Tunnel
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="space-y-4 py-3">
                    {/* Presets */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Quick Connection Presets
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {(() => {
                                const isEmu = typeof window !== "undefined" && window.location.hostname === "10.0.2.2";
                                const presetUrl = isEmu ? "http://10.0.2.2:8090" : "http://127.0.0.1:8090";
                                const presetWa = isEmu ? "http://10.0.2.2:21465" : "http://127.0.0.1:21465";
                                const presetLabel = isEmu ? "Emulator Host (PC)" : "Local Desktop";
                                const presetSub = isEmu ? "10.0.2.2:8090" : "127.0.0.1:8090";
                                return (
                                    <button
                                        type="button"
                                        onClick={() => setPreset(presetUrl, presetWa)}
                                        className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-muted/40 hover:bg-muted text-left transition-colors"
                                    >
                                        <Laptop size={16} className="text-primary shrink-0" />
                                        <div className="min-w-0">
                                            <p className="text-xs font-bold truncate">{presetLabel}</p>
                                            <p className="text-[10px] text-muted-foreground truncate">{presetSub}</p>
                                        </div>
                                    </button>
                                );
                            })()}

                            <button
                                type="button"
                                onClick={() => setPreset("http://192.168.1.100:8090", "http://192.168.1.100:21465")}
                                className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-muted/40 hover:bg-muted text-left transition-colors"
                            >
                                <Wifi size={16} className="text-primary shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-xs font-bold truncate">Showroom Wi-Fi</p>
                                    <p className="text-[10px] text-muted-foreground truncate">LAN IP:8090</p>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* Server URL Input */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-foreground">
                                PocketBase Server URL
                            </label>
                            {status?.isTunnel && (
                                <Badge variant="secondary" className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                    <ShieldCheck size={12} />
                                    Cloudflare HTTPS Tunnel
                                </Badge>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={serverUrl}
                                onChange={(e) => {
                                    setServerUrl(e.target.value);
                                    setStatus(null);
                                    setIsSaved(false);
                                }}
                                placeholder="https://xyz.trycloudflare.com or http://192.168.1.x:8090"
                                className="text-xs font-mono"
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => testConnection(serverUrl)}
                                disabled={isTesting || !serverUrl.trim()}
                                className="shrink-0 text-xs gap-1.5"
                            >
                                {isTesting ? <Loader2 size={14} className="animate-spin" /> : "Test"}
                            </Button>
                        </div>
                    </div>

                    {/* Connection Result Status */}
                    {status && (
                        <div
                            className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                                status.ok
                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                    : "bg-destructive/10 border-destructive/30 text-destructive-foreground"
                            }`}
                        >
                            {status.ok ? (
                                <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                            ) : (
                                <XCircle size={18} className="text-destructive shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="font-bold">
                                    {status.ok ? "Connected successfully" : "Connection failed"}
                                </p>
                                <p className="text-[11px] opacity-80 mt-0.5">
                                    {status.ok
                                        ? `Response latency: ${status.latencyMs}ms ${
                                              status.isTunnel ? "(Encrypted Internet Tunnel)" : "(Local LAN)"
                                          }`
                                        : status.error || "Please check host IP and verify PocketBase is running."}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* WhatsApp Sidecar URL Input */}
                    <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                <MessageSquare size={13} className="text-primary" />
                                WhatsApp Sidecar URL
                            </label>
                            {waStatus?.isTunnel && (
                                <Badge variant="secondary" className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                    <ShieldCheck size={12} />
                                    Cloudflare Tunnel
                                </Badge>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={waUrl}
                                onChange={(e) => {
                                    setWaUrl(e.target.value);
                                    setWaStatus(null);
                                    setIsSaved(false);
                                }}
                                placeholder="https://wa-xyz.trycloudflare.com or http://192.168.1.x:21465"
                                className="text-xs font-mono"
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => testWaConnection(waUrl)}
                                disabled={isTestingWa || !waUrl.trim()}
                                className="shrink-0 text-xs gap-1.5"
                            >
                                {isTestingWa ? <Loader2 size={14} className="animate-spin" /> : "Test"}
                            </Button>
                        </div>
                    </div>

                    {/* WhatsApp Connection Result Status */}
                    {waStatus && (
                        <div
                            className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                                waStatus.ok
                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                    : "bg-destructive/10 border-destructive/30 text-destructive-foreground"
                            }`}
                        >
                            {waStatus.ok ? (
                                <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                            ) : (
                                <XCircle size={18} className="text-destructive shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="font-bold">
                                    {waStatus.ok ? "WhatsApp Sidecar connected" : "Sidecar connection failed"}
                                </p>
                                <p className="text-[11px] opacity-80 mt-0.5">
                                    {waStatus.ok
                                        ? `Response latency: ${waStatus.latencyMs}ms ${
                                              waStatus.isTunnel ? "(Encrypted Internet Tunnel)" : "(Local LAN)"
                                          }`
                                        : waStatus.error || "Please check host and verify WhatsApp Sidecar is running on port 21465."}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Tip for Internet Tunnel */}
                    <div className="p-2.5 rounded-lg bg-muted/30 border border-border text-[11px] text-muted-foreground flex items-start gap-2">
                        <Globe size={15} className="text-primary shrink-0 mt-0.5" />
                        <div>
                            <span className="font-semibold text-foreground">Sync over Internet:</span> On your showroom PC, run{" "}
                            <code className="bg-background px-1 py-0.5 rounded text-primary font-mono text-[10px]">npm run tunnel:all</code>. Paste the generated{" "}
                            <code className="bg-background px-1 py-0.5 rounded font-mono text-[10px]">trycloudflare.com</code> URLs above!
                        </div>
                    </div>
                </div>

                <DialogFooter className="flex sm:justify-between items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={!serverUrl.trim() || isTesting}
                        className="text-xs font-semibold gap-1.5"
                    >
                        {isSaved ? (
                            <>
                                <CheckCircle2 size={14} />
                                Saved!
                            </>
                        ) : (
                            "Save & Connect"
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
