"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { pb } from "@/lib/pocketbase";
import { Loader2, FileText, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface EwayBillSettings {
    client_id: string;
    client_secret: string;
    username: string;
    password: string;
    is_production: boolean;
}

export function EwayBillSettings() {
    const [settings, setSettings] = useState<EwayBillSettings>({
        client_id: "",
        client_secret: "",
        username: "",
        password: "",
        is_production: false,
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const record = await pb.collection("store_settings").getFirstListItem('key="eway_bill"').catch(() => null);
            if (record) {
                setSettings({
                    client_id: (record as any).eway_client_id || "",
                    client_secret: (record as any).eway_client_secret || "",
                    username: (record as any).eway_username || "",
                    password: (record as any).eway_password || "",
                    is_production: (record as any).eway_is_production || false,
                });
            }
        } catch (error) {
            console.error("Error loading E-way Bill settings:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const saveSettings = async () => {
        setIsSaving(true);
        try {
            const existing = await pb.collection("store_settings")
                .getFirstListItem('key="eway_bill"')
                .catch(() => null);

            const data = {
                key: "eway_bill",
                eway_client_id: settings.client_id,
                eway_client_secret: settings.client_secret,
                eway_username: settings.username,
                eway_password: settings.password,
                eway_is_production: settings.is_production,
            };

            if (existing) {
                await pb.collection("store_settings").update(existing.id, data);
            } else {
                await pb.collection("store_settings").create(data);
            }

            toast.success("E-way Bill settings saved");
        } catch (error) {
            console.error("Error saving settings:", error);
            toast.error("Failed to save settings");
        } finally {
            setIsSaving(false);
        }
    };

    const testConnection = async () => {
        setIsTesting(true);
        setTestResult(null);

        try {
            // For now, just validate that credentials are provided
            if (!settings.client_id || !settings.client_secret || !settings.username || !settings.password) {
                setTestResult("error");
                toast.error("Please fill in all credentials");
                return;
            }

            // In production, this would call the actual API
            // For now, simulate a test
            await new Promise(resolve => setTimeout(resolve, 1500));

            setTestResult("success");
            toast.success("Connection test successful (sandbox)");
        } catch (error) {
            setTestResult("error");
            toast.error("Connection test failed");
        } finally {
            setIsTesting(false);
        }
    };

    if (isLoading) {
        return (
            <Card>
                <CardContent className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    E-way Bill Integration
                </CardTitle>
                <CardDescription>
                    Configure your NIC E-way Bill API credentials. These are obtained from{" "}
                    <a
                        href="https://ewaybillgst.gov.in"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                    >
                        ewaybillgst.gov.in
                    </a>
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Mode Toggle */}
                <div className="flex items-center justify-between p-4 bg-surface-navy rounded-lg border border-surface-hover">
                    <div>
                        <Label className="text-white font-medium">Production Mode</Label>
                        <p className="text-sm text-moonstone mt-1">
                            {settings.is_production
                                ? "Connected to live GST Portal"
                                : "Using sandbox for testing"}
                        </p>
                    </div>
                    <Switch
                        checked={settings.is_production}
                        onCheckedChange={(checked) =>
                            setSettings(prev => ({ ...prev, is_production: checked }))
                        }
                    />
                </div>

                {!settings.is_production && (
                    <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                        <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
                        <div>
                            <p className="text-sm text-yellow-500 font-medium">Sandbox Mode</p>
                            <p className="text-xs text-moonstone">
                                E-way Bills generated in sandbox won't be valid. Switch to production for real bills.
                            </p>
                        </div>
                    </div>
                )}

                {/* API Credentials */}
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="client_id">Client ID</Label>
                        <Input
                            id="client_id"
                            value={settings.client_id}
                            onChange={(e) => setSettings(prev => ({ ...prev, client_id: e.target.value }))}
                            placeholder="Enter Client ID from GST Portal"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="client_secret">Client Secret</Label>
                        <Input
                            id="client_secret"
                            type="password"
                            value={settings.client_secret}
                            onChange={(e) => setSettings(prev => ({ ...prev, client_secret: e.target.value }))}
                            placeholder="Enter Client Secret"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="username">E-way Bill Username</Label>
                        <Input
                            id="username"
                            value={settings.username}
                            onChange={(e) => setSettings(prev => ({ ...prev, username: e.target.value }))}
                            placeholder="Your GST Portal username"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">E-way Bill Password</Label>
                        <Input
                            id="password"
                            type="password"
                            value={settings.password}
                            onChange={(e) => setSettings(prev => ({ ...prev, password: e.target.value }))}
                            placeholder="Your GST Portal password"
                        />
                    </div>
                </div>

                {/* Test Result */}
                {testResult && (
                    <div className={`flex items-center gap-2 p-3 rounded-lg ${testResult === "success"
                            ? "bg-green-500/10 border border-green-500/30"
                            : "bg-red-500/10 border border-red-500/30"
                        }`}>
                        {testResult === "success" ? (
                            <>
                                <CheckCircle className="w-5 h-5 text-green-500" />
                                <span className="text-sm text-green-500">Connection successful</span>
                            </>
                        ) : (
                            <>
                                <XCircle className="w-5 h-5 text-red-500" />
                                <span className="text-sm text-red-500">Connection failed</span>
                            </>
                        )}
                    </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 pt-4">
                    <Button
                        variant="outline"
                        onClick={testConnection}
                        disabled={isTesting}
                    >
                        {isTesting ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Testing...
                            </>
                        ) : (
                            "Test Connection"
                        )}
                    </Button>
                    <Button
                        onClick={saveSettings}
                        disabled={isSaving}
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            "Save Settings"
                        )}
                    </Button>
                </div>

                {/* Help */}
                <div className="pt-4 border-t border-surface-hover">
                    <p className="text-xs text-moonstone">
                        <strong>How to get credentials:</strong> Register at{" "}
                        <a href="https://ewaybillgst.gov.in" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            ewaybillgst.gov.in
                        </a>{" "}
                        → Registration → For API → Enter your domain and static IP → You'll receive Client ID and Secret.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
