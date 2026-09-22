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
import { Badge } from "@/components/ui/badge";
import { GoogleDriveSync, DriveSyncState } from "@/lib/google-drive-sync";
import {
    Cloud,
    CloudCheck,
    CloudUpload,
    RefreshCw,
    CheckCircle2,
    HardDrive,
    Info,
    Shield,
    Sparkles
} from "lucide-react";
import { format } from "date-fns";

interface GoogleDriveSyncModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function GoogleDriveSyncModal({ isOpen, onClose }: GoogleDriveSyncModalProps) {
    const [state, setState] = useState<DriveSyncState>(GoogleDriveSync.getSyncState());
    const [emailInput, setEmailInput] = useState("owner@luminilajewelry.com");
    const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setState(GoogleDriveSync.getSyncState());
            setSyncSuccessMsg(null);
        }

        const handleSyncUpdate = (e: any) => {
            setState(e.detail || GoogleDriveSync.getSyncState());
        };

        window.addEventListener("gdrive-sync:changed", handleSyncUpdate);
        return () => window.removeEventListener("gdrive-sync:changed", handleSyncUpdate);
    }, [isOpen]);

    const handleConnect = async () => {
        await GoogleDriveSync.connect(emailInput);
        setState(GoogleDriveSync.getSyncState());
    };

    const handleDisconnect = () => {
        GoogleDriveSync.disconnect();
        setState(GoogleDriveSync.getSyncState());
    };

    const handleSyncNow = async () => {
        setSyncSuccessMsg(null);
        const result = await GoogleDriveSync.sync();
        if (result.success) {
            setSyncSuccessMsg(`Synced ${result.uploaded} local mutations to Google Drive.`);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md bg-card border-border">
                <DialogHeader>
                    <div className="flex items-center gap-2.5">
                        <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            <Cloud size={20} />
                        </div>
                        <div>
                            <DialogTitle className="text-base font-bold text-foreground">
                                Google Drive Database Sync
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground">
                                Decentralized change-log sync & automatic cloud backup
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="space-y-4 py-3">
                    {/* Account Status Card */}
                    <div className="p-3.5 rounded-lg border border-border bg-muted/20 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground">Connection Status</span>
                            {state.isConnected ? (
                                <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                                    <CheckCircle2 size={12} />
                                    Connected
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="text-xs text-muted-foreground">
                                    Disconnected
                                </Badge>
                            )}
                        </div>

                        {state.isConnected ? (
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-foreground truncate">{state.userEmail}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                        Last Synced:{" "}
                                        {state.lastSyncTime
                                            ? format(new Date(state.lastSyncTime), "MMM d, h:mm a")
                                            : "Never"}
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleDisconnect}
                                    className="text-xs text-destructive hover:bg-destructive/10"
                                >
                                    Disconnect
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <input
                                    type="email"
                                    value={emailInput}
                                    onChange={(e) => setEmailInput(e.target.value)}
                                    placeholder="your-google-account@gmail.com"
                                    className="flex-1 bg-card border border-border rounded-md px-3 py-1.5 text-xs text-foreground"
                                />
                                <Button size="sm" onClick={handleConnect} className="text-xs font-semibold">
                                    Sign In
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Pending Changes & Sync Trigger */}
                    <div className="p-3.5 rounded-lg border border-border bg-card space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-xs font-bold text-foreground">Incremental Mutation Queue</h4>
                                <p className="text-[11px] text-muted-foreground">
                                    {state.pendingCount === 0
                                        ? "All transactions synced with cloud."
                                        : `${state.pendingCount} atomic change(s) ready to upload.`}
                                </p>
                            </div>
                            <Button
                                size="sm"
                                onClick={handleSyncNow}
                                disabled={state.isSyncing || !state.isConnected}
                                className="text-xs font-semibold gap-1.5"
                            >
                                <RefreshCw size={13} className={state.isSyncing ? "animate-spin" : ""} />
                                {state.isSyncing ? "Syncing..." : "Sync Now"}
                            </Button>
                        </div>

                        {syncSuccessMsg && (
                            <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
                                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                                <span>{syncSuccessMsg}</span>
                            </div>
                        )}
                    </div>

                    {/* How It Works Explainer */}
                    <div className="p-3 rounded-lg bg-muted/30 border border-border text-[11px] text-muted-foreground space-y-1.5">
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                            <Shield size={13} className="text-primary" />
                            <span>Zero Data-Loss Guarantee</span>
                        </div>
                        <p>
                            Every sale, stock change, or expense writes an encrypted atomic changelog entry. Even if your
                            internet drops, transactions replay automatically once connected to Google Drive.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
