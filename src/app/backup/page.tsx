"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Database, Download, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";

import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    downloadBackup,
    getLastBackupInfo,
    isBackupOlderThan,
    restoreFromAutoBackup,
    restoreFromBackup,
    scheduleAutoBackup,
    summariseBackup,
    validateBackup,
    type BackupData,
    type BackupSummary,
} from "@/lib/backup";

const AUTO_FLAG = "luminila_auto_backup_enabled";

interface RestoreResult {
    success: boolean;
    message: string;
    restored?: Record<string, number>;
}

export default function BackupPage() {
    const [exporting, setExporting] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [backup, setBackup] = useState<BackupData | null>(null);
    const [summary, setSummary] = useState<BackupSummary | null>(null);
    const [acknowledged, setAcknowledged] = useState(false);
    const [confirmText, setConfirmText] = useState("");
    const [restoring, setRestoring] = useState(false);
    const [result, setResult] = useState<RestoreResult | null>(null);

    const [autoEnabled, setAutoEnabled] = useState(false);
    const [lastAuto, setLastAuto] = useState<string | null>(null);
    const stopAutoRef = useRef<(() => void) | null>(null);

    const startAuto = () => {
        stopAutoRef.current?.();
        stopAutoRef.current = scheduleAutoBackup((ok) => {
            if (ok) setLastAuto(new Date().toISOString());
        });
    };

    useEffect(() => {
        const info = getLastBackupInfo();
        setLastAuto(info.date);
        const enabled = typeof window !== "undefined" && localStorage.getItem(AUTO_FLAG) === "true";
        setAutoEnabled(enabled);
        if (enabled) startAuto();
        return () => stopAutoRef.current?.();
    }, []);

    const handleExport = async () => {
        try {
            setExporting(true);
            const ok = await downloadBackup();
            if (ok) toast.success("Backup downloaded");
            else toast.error("Could not create the backup");
        } catch (error) {
            console.error(error);
            toast.error("Could not create the backup");
        } finally {
            setExporting(false);
        }
    };

    const handleFile = async (selected: File | null) => {
        setResult(null);
        setAcknowledged(false);
        setConfirmText("");
        if (!selected) {
            setFile(null);
            setBackup(null);
            setSummary(null);
            return;
        }
        try {
            const text = await selected.text();
            const parsed = JSON.parse(text);
            if (!validateBackup(parsed)) {
                toast.error("That file is not a valid Luminila backup");
                setFile(null);
                setBackup(null);
                setSummary(null);
                return;
            }
            setFile(selected);
            setBackup(parsed);
            setSummary(summariseBackup(parsed));
        } catch (error) {
            console.error(error);
            toast.error("Could not read that file");
        }
    };

    const handleRestore = async () => {
        if (!file || !backup) return;
        if (!acknowledged || confirmText.trim().toUpperCase() !== "RESTORE") {
            toast.error('Tick the warning and type RESTORE to continue');
            return;
        }
        try {
            setRestoring(true);
            const response = await restoreFromBackup(file);
            setResult(response as RestoreResult);
            if (response.success) toast.success(response.message);
            else toast.error(response.message);
        } catch (error) {
            console.error(error);
            toast.error("Restore failed");
        } finally {
            setRestoring(false);
        }
    };

    const handleAutoRestore = async () => {
        if (!confirm("Restore the last automatic backup from this browser?")) return;
        const ok = await restoreFromAutoBackup();
        if (ok) toast.success("Restored from the automatic backup");
        else toast.error("No usable automatic backup found");
    };

    const toggleAuto = () => {
        if (autoEnabled) {
            stopAutoRef.current?.();
            stopAutoRef.current = null;
            localStorage.removeItem(AUTO_FLAG);
            setAutoEnabled(false);
            toast.success("Daily auto backup disabled");
        } else {
            localStorage.setItem(AUTO_FLAG, "true");
            startAuto();
            setAutoEnabled(true);
            toast.success("Daily auto backup enabled for this browser");
        }
    };

    const stale = summary ? isBackupOlderThan(summary.createdAt, 7) : false;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Backup & Restore" subtitle="Full database export, restore and automatic snapshots" />

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card className="bg-card">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Download className="w-4 h-4" /> Export
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <p className="text-muted-foreground">
                                A full backup downloads as JSON and includes every business table: customers,
                                products and variants, sales, invoices, returns, purchases, expenses, banking,
                                loyalty, discounts and activity logs.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Store the file outside this machine. PocketBase&apos;s own data directory is not
                                touched by this screen.
                            </p>
                            <Button onClick={handleExport} disabled={exporting}>
                                <Download className="w-4 h-4 mr-2" />
                                {exporting ? "Creating backup..." : "Download full backup"}
                            </Button>
                        </CardContent>
                    </Card>

                    <Card className="bg-card">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Database className="w-4 h-4" /> Automatic snapshot
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <p className="text-muted-foreground">
                                When enabled, a full snapshot is written to this browser&apos;s local storage just
                                after midnight and kept until replaced.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Last snapshot: {lastAuto ? new Date(lastAuto).toLocaleString() : "never"}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button variant={autoEnabled ? "outline" : "default"} onClick={toggleAuto}>
                                    {autoEnabled ? "Disable auto backup" : "Enable auto backup"}
                                </Button>
                                <Button variant="outline" onClick={handleAutoRestore} disabled={!lastAuto}>
                                    <RotateCcw className="w-4 h-4 mr-2" /> Restore last snapshot
                                </Button>
                            </div>
                            <p className="text-[11px] text-amber-500">
                                Local storage is small and per browser. Use the downloaded file for real disaster
                                recovery.
                            </p>
                        </CardContent>
                    </Card>
                </div>

                <Card className="bg-card">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Upload className="w-4 h-4" /> Restore from a file
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-1">
                            <Label>Backup file</Label>
                            <Input
                                type="file"
                                accept="application/json,.json"
                                onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
                            />
                        </div>

                        {summary && (
                            <div className="rounded-lg border p-4 space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary">v{summary.version}</Badge>
                                    <span className="text-xs text-muted-foreground">
                                        Created {new Date(summary.createdAt).toLocaleString()}
                                    </span>
                                    {stale && (
                                        <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/40">
                                            <AlertTriangle className="w-3 h-3 mr-1" /> Older than 7 days
                                        </Badge>
                                    )}
                                    <span className="text-xs text-muted-foreground">
                                        {summary.totalRows} rows across {summary.tables.length} tables
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    {summary.tables.slice(0, 12).map((table) => (
                                        <div key={table.name} className="rounded bg-muted/40 px-2 py-1">
                                            <p className="text-[11px] text-muted-foreground truncate">{table.name}</p>
                                            <p className="text-sm font-mono">{table.rows}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="rounded-lg border border-amber-600/40 bg-amber-600/10 p-4 space-y-3">
                            <p className="text-xs text-amber-300 flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                Restoring writes every row in the file over records with the same id. Rows that are
                                not in the file are left alone, so a partial backup leaves the rest of the database
                                in place.
                            </p>
                            <label className="flex items-center gap-2 text-xs">
                                <input
                                    type="checkbox"
                                    checked={acknowledged}
                                    onChange={(event) => setAcknowledged(event.target.checked)}
                                    className="accent-amber-500"
                                />
                                I understand this writes over matching records.
                            </label>
                            <div className="flex flex-wrap items-end gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">Type RESTORE to confirm</Label>
                                    <Input
                                        value={confirmText}
                                        onChange={(event) => setConfirmText(event.target.value)}
                                        className="w-40 font-mono uppercase"
                                        placeholder="RESTORE"
                                    />
                                </div>
                                <Button
                                    variant="destructive"
                                    onClick={handleRestore}
                                    disabled={!backup || restoring || !acknowledged || confirmText.trim().toUpperCase() !== "RESTORE"}
                                >
                                    {restoring ? "Restoring..." : "Restore records"}
                                </Button>
                            </div>
                        </div>

                        {result && (
                            <div className={`rounded-lg border p-4 text-sm ${result.success ? "border-emerald-600/40 bg-emerald-600/10" : "border-red-600/40 bg-red-600/10"}`}>
                                <p className="font-semibold">{result.message}</p>
                                {result.restored && (
                                    <p className="text-xs text-muted-foreground pt-1">
                                        {Object.entries(result.restored)
                                            .filter(([, count]) => typeof count === "number")
                                            .map(([name, count]) => `${name}: ${count}`)
                                            .join(" · ")}
                                    </p>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
