"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
    ShieldCheck,
    ShieldAlert,
    Lock,
    Unlock,
    KeyRound,
    UserCheck,
    AlertTriangle,
    X,
    Loader2,
    Calendar,
    Phone,
    User,

} from "lucide-react";
import {
    WhatsAppBinding,
    AdminUserOption,
    getAdminUsers,
    bindWhatsAppAccount,
    unbindWhatsAppAccount,
    verifyAdminApproval,
} from "@/lib/whatsapp-binding";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface AdminApprovalModalProps {
    isOpen: boolean;
    onClose: () => void;
    mode?: "approval" | "bind" | "details";
    actionType?: "unbind" | "reset" | "disconnect";
    binding: WhatsAppBinding | null;
    connectedPhone?: string;
    onApprovalSuccess?: (approver: { id: string; email: string; name: string }) => void;
    onBindingUpdated?: (newBinding: WhatsAppBinding) => void;
}

export function AdminApprovalModal({
    isOpen,
    onClose,
    mode: initialMode = "approval",
    actionType = "unbind",
    binding,
    connectedPhone,
    onApprovalSuccess,
    onBindingUpdated,
}: AdminApprovalModalProps) {
    const { user } = useAuth();
    const [currentMode, setCurrentMode] = useState<"approval" | "bind" | "details">(initialMode);
    const [activeActionType, setActiveActionType] = useState<"unbind" | "reset" | "disconnect">(actionType);
    
    // Approval Form state
    const [adminEmail, setAdminEmail] = useState("");
    const [adminPassword, setAdminPassword] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Bind Form state
    const [adminUsers, setAdminUsers] = useState<AdminUserOption[]>([]);
    const [selectedAdminId, setSelectedAdminId] = useState<string>("");
    const [bindingLoading, setBindingLoading] = useState(false);
    const [loadingAdmins, setLoadingAdmins] = useState(false);

    const loadAdmins = useCallback(async () => {
        setLoadingAdmins(true);
        try {
            const list = await getAdminUsers();
            setAdminUsers(list);
            if (list.length > 0) {
                const currentMatch = list.find((a) => a.id === user?.id || a.email === user?.email);
                setSelectedAdminId(currentMatch ? currentMatch.id : list[0].id);
            }
        } catch (err) {
            console.error("Failed to load admin options:", err);
        } finally {
            setLoadingAdmins(false);
        }
    }, [user]);

    useEffect(() => {
        if (isOpen) {
            setCurrentMode(initialMode);
            setActiveActionType(actionType);
            setErrorMessage(null);
            setAdminPassword("");
            
            // Default email for approval: if user is admin, prefill their email, else bound admin's email
            if (user?.email) {
                setAdminEmail(user.email);
            } else if (binding?.boundAdminEmail) {
                setAdminEmail(binding.boundAdminEmail);
            } else {
                setAdminEmail("admin@luminila.local");
            }

            // Load admins if in bind mode
            if (initialMode === "bind") {
                loadAdmins();
            }
        }
    }, [isOpen, initialMode, actionType, binding, user, loadAdmins]);

    if (!isOpen) return null;

    const actionLabels: Record<string, { title: string; desc: string; button: string }> = {
        unbind: {
            title: "Authorize WhatsApp Account Unbinding",
            desc: "This WhatsApp instance is locked to a designated Admin account. You must verify administrator credentials to permanently remove the binding.",
            button: "Authorize & Unbind",
        },
        reset: {
            title: "Authorize Session Reset",
            desc: "Wiping active WhatsApp session tokens is a protected administrative operation. Verify admin credentials to clear stored credentials and regenerate QR.",
            button: "Authorize Session Reset",
        },
        disconnect: {
            title: "Authorize WhatsApp Disconnect",
            desc: "Logging out the WhatsApp sidecar terminates live message synchronization and CRM lead auto-ingestion. Administrator approval is required.",
            button: "Authorize Disconnect",
        },
    };

    const actionInfo = actionLabels[activeActionType] || actionLabels.unbind;

    // Handle Admin Approval Submission
    const handleVerifyApproval = async (e: React.FormEvent) => {
        e.preventDefault();
        setVerifying(true);
        setErrorMessage(null);

        try {
            // Check credentials against PocketBase
            const result = await verifyAdminApproval(
                adminEmail,
                adminPassword,
                binding?.isBound ? binding.boundAdminId : undefined
            );

            if (!result.success || !result.adminUser) {
                setErrorMessage(result.error || "Authorization failed: Invalid administrator credentials.");
                setVerifying(false);
                return;
            }

            toast.success(`Action approved by Admin: ${result.adminUser.email}`);

            if (activeActionType === "unbind") {
                const unbound = await unbindWhatsAppAccount(result.adminUser.email);
                onBindingUpdated?.(unbound);
            }

            onApprovalSuccess?.(result.adminUser);
            onClose();
        } catch (err) {
            setErrorMessage(
                (err instanceof Error ? err.message : String(err)) ||
                    "An unexpected error occurred during authorization."
            );
        } finally {
            setVerifying(false);
        }
    };

    // Handle Bind WhatsApp Submission
    const handleConfirmBind = async (e: React.FormEvent) => {
        e.preventDefault();
        const selected = adminUsers.find((a) => a.id === selectedAdminId) || adminUsers[0];
        if (!selected) {
            setErrorMessage("Please select an administrator account.");
            return;
        }

        setBindingLoading(true);
        setErrorMessage(null);

        try {
            const operatorEmail = user?.email || "admin@luminila.local";
            const newBinding = await bindWhatsAppAccount(
                { id: selected.id, email: selected.email, name: selected.name },
                operatorEmail,
                connectedPhone
            );

            toast.success(`WhatsApp account securely bound to Admin: ${selected.email}`);
            onBindingUpdated?.(newBinding);
            onClose();
        } catch (err) {
            setErrorMessage((err instanceof Error ? err.message : String(err)) || "Failed to save account binding.");
        } finally {
            setBindingLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="bg-card border border-border/80 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-5 border-b border-border/60 bg-muted/30 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${
                            currentMode === "bind" 
                                ? "bg-primary/10 text-primary border border-primary/20" 
                                : binding?.isBound 
                                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                    : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                        }`}>
                            {currentMode === "bind" ? (
                                <Lock className="w-5 h-5" />
                            ) : currentMode === "details" ? (
                                <ShieldCheck className="w-5 h-5" />
                            ) : (
                                <KeyRound className="w-5 h-5" />
                            )}
                        </div>
                        <div>
                            <h3 className="text-base font-semibold text-foreground">
                                {currentMode === "bind"
                                    ? "Bind WhatsApp Account"
                                    : currentMode === "details"
                                    ? "Admin Binding Protection"
                                    : actionInfo.title}
                            </h3>
                            <p className="text-xs text-muted-foreground">
                                {currentMode === "bind"
                                    ? "Lock instance to designated administrator"
                                    : currentMode === "details"
                                    ? "Security and ownership controls"
                                    : "Administrator approval verification"}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors"
                        title="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body Content */}
                <div className="p-5 space-y-4">
                    {/* Error Banner */}
                    {errorMessage && (
                        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs animate-in fade-in duration-200">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{errorMessage}</span>
                        </div>
                    )}

                    {/* Mode: DETAILS VIEW */}
                    {currentMode === "details" && binding && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-3">
                                <div className="flex items-center justify-between pb-2 border-b border-border/40">
                                    <span className="text-xs text-muted-foreground">Status</span>
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                                        <ShieldCheck className="w-3.5 h-3.5" /> Locked & Protected
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground flex items-center gap-1.5">
                                        <User className="w-3.5 h-3.5" /> Bound Administrator
                                    </span>
                                    <span className="font-semibold text-foreground">
                                        {binding.boundAdminName} ({binding.boundAdminEmail})
                                    </span>
                                </div>
                                {binding.boundPhone && (
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground flex items-center gap-1.5">
                                            <Phone className="w-3.5 h-3.5" /> WhatsApp Phone
                                        </span>
                                        <span className="font-medium text-foreground">{binding.boundPhone}</span>
                                    </div>
                                )}
                                {binding.boundAt && (
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-muted-foreground flex items-center gap-1.5">
                                            <Calendar className="w-3.5 h-3.5" /> Bound Timestamp
                                        </span>
                                        <span className="text-muted-foreground">
                                            {new Date(binding.boundAt).toLocaleString()}
                                        </span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">Enforcement</span>
                                    <span className="text-foreground font-medium">
                                        Cannot unbind without Admin Password
                                    </span>
                                </div>
                            </div>

                            <p className="text-xs text-muted-foreground leading-relaxed">
                                This instance is strictly bound. Resetting sessions, disconnecting the sidecar, or unbinding
                                the WhatsApp number requires password authorization from the bound administrator.
                            </p>

                            <div className="pt-2 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveActionType("unbind");
                                        setCurrentMode("approval");
                                        setErrorMessage(null);
                                    }}
                                    className="flex-1 py-2 px-3 text-xs font-medium rounded-xl border border-destructive/30 text-destructive bg-destructive/10 hover:bg-destructive/20 transition-all flex items-center justify-center gap-1.5"
                                >
                                    <Unlock className="w-3.5 h-3.5" /> Request Unbind
                                </button>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 py-2 px-3 text-xs font-medium rounded-xl border border-border bg-muted/60 hover:bg-muted text-foreground transition-all"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Mode: BIND ACCOUNT */}
                    {currentMode === "bind" && (
                        <form onSubmit={handleConfirmBind} className="space-y-4">
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Select the Administrator account that will own and supervise this WhatsApp instance.
                                Once bound, all destructive operations (unbind, session wipe, disconnect) will be locked.
                            </p>

                            {loadingAdmins ? (
                                <div className="py-6 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
                                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                    <span>Retrieving administrator accounts...</span>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-foreground mb-1.5">
                                            Supervising Admin Account
                                        </label>
                                        <select
                                            value={selectedAdminId}
                                            onChange={(e) => setSelectedAdminId(e.target.value)}
                                            className="w-full text-xs bg-muted/40 border border-border rounded-xl px-3 py-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                        >
                                            {adminUsers.map((a) => (
                                                <option key={a.id} value={a.id}>
                                                    {a.name} ({a.email}) - {a.roleName}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {connectedPhone && (
                                        <div className="p-3 rounded-xl bg-muted/30 border border-border/50 text-xs flex items-center justify-between">
                                            <span className="text-muted-foreground flex items-center gap-1.5">
                                                <Phone className="w-3.5 h-3.5" /> Active Number
                                            </span>
                                            <span className="font-semibold text-foreground">{connectedPhone}</span>
                                        </div>
                                    )}

                                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-500 flex items-start gap-2">
                                        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                                        <span>
                                            Security lock policy will take effect immediately. Only approved admin
                                            passwords will be able to alter or disconnect this connection.
                                        </span>
                                    </div>
                                </div>
                            )}

                            <div className="pt-2 flex gap-2">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 py-2.5 px-3 text-xs font-medium rounded-xl border border-border bg-muted/60 hover:bg-muted text-foreground transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={bindingLoading || loadingAdmins}
                                    className="flex-1 py-2.5 px-3 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                                >
                                    {bindingLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>Binding...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Lock className="w-4 h-4" />
                                            <span>Bind WhatsApp Account</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}

                    {/* Mode: APPROVAL PROMPT */}
                    {currentMode === "approval" && (
                        <form onSubmit={handleVerifyApproval} className="space-y-4">
                            <div className="p-3 rounded-xl bg-muted/40 border border-border/60 text-xs space-y-1.5">
                                <div className="flex items-center gap-2 font-medium text-foreground">
                                    <Lock className="w-3.5 h-3.5 text-amber-500" />
                                    <span>Protected Administrative Action</span>
                                </div>
                                <p className="text-muted-foreground leading-relaxed">
                                    {actionInfo.desc}
                                </p>
                                {binding?.isBound && (
                                    <div className="pt-1 text-muted-foreground flex items-center gap-1 font-mono text-[11px]">
                                        Bound to: <strong className="text-foreground">{binding.boundAdminEmail}</strong>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-foreground mb-1">
                                        Administrator Email
                                    </label>
                                    <input
                                        type="email"
                                        required
                                        value={adminEmail}
                                        onChange={(e) => setAdminEmail(e.target.value)}
                                        placeholder="admin@luminila.local"
                                        className="w-full text-xs bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="block text-xs font-medium text-foreground">
                                            Administrator Password
                                        </label>
                                        <span className="text-[11px] text-muted-foreground">Admin/Super Admin</span>
                                    </div>
                                    <input
                                        type="password"
                                        required
                                        autoFocus
                                        value={adminPassword}
                                        onChange={(e) => setAdminPassword(e.target.value)}
                                        placeholder="Enter administrator password"
                                        className="w-full text-xs bg-muted/40 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                </div>
                            </div>

                            <div className="pt-2 flex gap-2">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 py-2.5 px-3 text-xs font-medium rounded-xl border border-border bg-muted/60 hover:bg-muted text-foreground transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={verifying || !adminPassword}
                                    className="flex-1 py-2.5 px-3 text-xs font-medium rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                                >
                                    {verifying ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>Verifying...</span>
                                        </>
                                    ) : (
                                        <>
                                            <UserCheck className="w-4 h-4" />
                                            <span>{actionInfo.button}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
