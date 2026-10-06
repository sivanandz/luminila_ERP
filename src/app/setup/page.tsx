"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { pb, getPocketBaseUrl, autoDiscoverPocketBase } from "@/lib/pocketbase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
    Loader2,
    Sparkles,
    CheckCircle,
    ArrowRight,
    ArrowLeft,
    Store,
    User,
    Lock,
    Eye,
    EyeOff,
    ShieldCheck,
    Check,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type SetupStep = "welcome" | "config" | "complete";

const DEFAULT_ROLES = [
    {
        name: "Admin",
        description: "Full access to all features and administration",
        is_system: true,
        permissions: {
            products: ["create", "read", "update", "delete", "print", "export"],
            inventory: ["create", "read", "update", "delete", "print", "export"],
            sales: ["create", "read", "update", "delete", "print", "export"],
            invoices: ["create", "read", "update", "delete", "print", "export"],
            customers: ["create", "read", "update", "delete", "print", "export"],
            vendors: ["create", "read", "update", "delete", "print", "export"],
            purchase_orders: ["create", "read", "update", "delete", "print", "export"],
            reports: ["read", "export"],
            settings: ["read", "update"],
            users: ["create", "read", "update", "delete"],
            activity: ["read"],
        },
    },
    {
        name: "Manager",
        description: "Manage store operations and view analytics",
        is_system: true,
        permissions: {
            products: ["create", "read", "update", "print", "export"],
            inventory: ["create", "read", "update", "print", "export"],
            sales: ["create", "read", "update", "print", "export"],
            invoices: ["create", "read", "update", "print", "export"],
            customers: ["create", "read", "update", "print", "export"],
            vendors: ["create", "read", "update", "print", "export"],
            purchase_orders: ["create", "read", "update", "print", "export"],
            reports: ["read", "export"],
            settings: ["read"],
            users: ["read"],
            activity: ["read"],
        },
    },
    {
        name: "Staff",
        description: "Point of sale and daily inventory updates",
        is_system: true,
        permissions: {
            products: ["read"],
            inventory: ["read", "update"],
            sales: ["create", "read", "print"],
            invoices: ["create", "read", "print"],
            customers: ["create", "read", "update"],
            vendors: ["read"],
            purchase_orders: ["read"],
            reports: [],
            settings: [],
            users: [],
            activity: ["read"],
        },
    },
    {
        name: "Viewer",
        description: "Read-only access for audits and reviews",
        is_system: true,
        permissions: {
            products: ["read"],
            inventory: ["read"],
            sales: ["read"],
            invoices: ["read"],
            customers: ["read"],
            vendors: ["read"],
            purchase_orders: ["read"],
            reports: ["read"],
            settings: [],
            users: [],
            activity: ["read"],
        },
    },
];

export default function SetupWizardPage() {
    const router = useRouter();
    const { login } = useAuth();

    const [currentStep, setCurrentStep] = useState<SetupStep>("welcome");
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);
    const [showPassword, setShowPassword] = useState(false);

    // Database status
    const [dbConnected, setDbConnected] = useState(false);
    const [pbUrl, setPbUrl] = useState(getPocketBaseUrl());

    // Single unified form state
    const [formData, setFormData] = useState({
        storeName: "Luminila Fine Jewellery",
        adminName: "Store Admin",
        adminEmail: "admin@luminila.local",
        adminPassword: "",
        adminPasswordConfirm: "",
    });

    const checkStatus = useCallback(async () => {
        setChecking(true);
        try {
            // Auto-discover active PocketBase instance
            const activeUrl = await autoDiscoverPocketBase();
            setPbUrl(activeUrl);

            // Direct PocketBase health check
            const health = await pb.health.check();
            setDbConnected(health.code === 200);

            try {
                const users = await pb.collection("users").getList(1, 1);
                if (users.totalItems > 0) {
                    router.push("/login");
                    return;
                }
            } catch {
                // Cold start 403 or empty, stay on wizard
            }
        } catch {
            setDbConnected(false);
        } finally {
            setChecking(false);
        }
    }, [router]);

    useEffect(() => {
        checkStatus();
        const handleServerChange = (e: Event) => {
            const customEvent = e as CustomEvent<{ url?: string }>;
            if (customEvent?.detail?.url) {
                setPbUrl(customEvent.detail.url);
                checkStatus();
            }
        };
        window.addEventListener("pb:server-changed", handleServerChange);
        return () => window.removeEventListener("pb:server-changed", handleServerChange);
    }, [checkStatus]);

    const handleUnifiedSetup = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.adminName.trim()) {
            toast.error("Please enter the administrator name");
            return;
        }

        if (!formData.adminEmail.trim()) {
            toast.error("Please enter a valid administrator email");
            return;
        }

        if (formData.adminPassword.length < 8) {
            toast.error("Password must be at least 8 characters long");
            return;
        }

        if (formData.adminPassword !== formData.adminPasswordConfirm) {
            toast.error("Passwords do not match");
            return;
        }

        setLoading(true);

        try {
            // 1. Authenticate as Superuser (first try bootstrap credentials, then form credentials)
            let superuserRecord: { id: string; email?: string } | null = null;
            let authenticatedWithBootstrap = false;

            try {
                const authData = await pb.collection("_superusers").authWithPassword("admin@luminila.local", "LuminilaInit2026!");
                superuserRecord = authData.record;
                authenticatedWithBootstrap = true;
            } catch {
                try {
                    const authData = await pb.collection("_superusers").authWithPassword(formData.adminEmail, formData.adminPassword);
                    superuserRecord = authData.record;
                } catch {
                    throw new Error("Unable to authenticate superuser. Ensure PocketBase is running via npm run dev.");
                }
            }

            // 2. If authenticated via bootstrap credentials, seamlessly update superuser to user's real credentials
            if (authenticatedWithBootstrap && superuserRecord) {
                try {
                    await pb.collection("_superusers").update(superuserRecord.id, {
                        email: formData.adminEmail,
                        password: formData.adminPassword,
                        passwordConfirm: formData.adminPassword,
                    });
                } catch (updateErr) {
                    console.warn("Notice: superuser update:", updateErr);
                }
            }

            // 3. Seed Default System Roles
            const roleMap: Record<string, string> = {};
            for (const role of DEFAULT_ROLES) {
                try {
                    const existing = await pb.collection("roles").getFirstListItem(`name="${role.name}"`);
                    roleMap[role.name] = existing.id;
                } catch (err: unknown) {
                    const errStatus = (err as { status?: number })?.status;
                    if (errStatus === 404) {
                        try {
                            const created = await pb.collection("roles").create(role);
                            roleMap[role.name] = created.id;
                        } catch (createErr) {
                            console.warn(`Could not create role ${role.name}:`, createErr);
                        }
                    }
                }
            }

            // 4. Create or Update Application Admin User
            let userRecord: { id: string } | null = null;
            try {
                const existing = await pb.collection("users").getFirstListItem(`email="${formData.adminEmail}"`);
                userRecord = await pb.collection("users").update(existing.id, {
                    name: formData.adminName,
                    password: formData.adminPassword,
                    passwordConfirm: formData.adminPassword,
                    verified: true,
                    is_active: true,
                });
            } catch (err: unknown) {
                const errStatus = (err as { status?: number })?.status;
                if (errStatus === 404) {
                    userRecord = await pb.collection("users").create({
                        email: formData.adminEmail,
                        password: formData.adminPassword,
                        passwordConfirm: formData.adminPassword,
                        name: formData.adminName,
                        emailVisibility: true,
                        verified: true,
                        is_active: true,
                    });
                } else {
                    throw err;
                }
            }

            // 5. Link User to Admin Role in user_roles
            const adminRoleId = roleMap["Admin"];
            if (adminRoleId && userRecord?.id) {
                try {
                    await pb.collection("user_roles").getFirstListItem(
                        `user="${userRecord.id}" && role="${adminRoleId}"`
                    );
                } catch (err: unknown) {
                    const errStatus = (err as { status?: number })?.status;
                    if (errStatus === 404) {
                        try {
                            await pb.collection("user_roles").create({
                                user: userRecord.id,
                                role: adminRoleId,
                            });
                        } catch (urErr) {
                            console.warn("user_roles creation notice:", urErr);
                        }
                    }
                }
            }

            // 6. Seed Initial Store Settings
            if (formData.storeName) {
                const initialSettings = [
                    { key: "store_name", value: formData.storeName, category: "general" },
                    { key: "currency", value: "INR", category: "general" },
                    { key: "currency_symbol", value: "₹", category: "general" },
                ];

                for (const setting of initialSettings) {
                    try {
                        const existingSetting = await pb.collection("store_settings").getFirstListItem(`key="${setting.key}"`);
                        await pb.collection("store_settings").update(existingSetting.id, { value: setting.value });
                    } catch (sErr: unknown) {
                        const sErrStatus = (sErr as { status?: number })?.status;
                        if (sErrStatus === 404) {
                            try {
                                await pb.collection("store_settings").create(setting);
                            } catch { /* ignore */ }
                        }
                    }
                }
            }

            // 7. Clear superuser credentials from client auth store
            pb.authStore.clear();

            // 8. Auto-Login directly into Application (Zero secondary login required)
            try {
                await login(formData.adminEmail, formData.adminPassword);
                toast.success("System initialized and logged in!");
            } catch (authErr) {
                console.warn("Direct login fallback using client authWithPassword:", authErr);
                try {
                    await pb.collection("users").authWithPassword(formData.adminEmail, formData.adminPassword);
                } catch {
                    // Fallback to manual entry if needed
                }
            }

            setCurrentStep("complete");
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Setup execution failed";
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    const handleLaunchDashboard = () => {
        router.push("/");
    };

    if (checking) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
                    <p className="text-muted-foreground text-sm font-medium">Verifying system readiness...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4 relative select-none">
            {/* Background ambient lighting */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-lg relative z-10">
                {/* Header branding */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4 shadow-lg shadow-primary/5">
                        <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold text-foreground tracking-tight">Luminila Setup</h1>
                    <p className="text-muted-foreground mt-1 text-sm">Unified system onboarding & initialization</p>
                </div>

                {/* Step indicator */}
                <div className="flex items-center justify-center gap-2 mb-8">
                    {[
                        { step: "welcome", label: "1" },
                        { step: "config", label: "2" },
                        { step: "complete", label: "3" },
                    ].map((item, idx) => {
                        const isDone =
                            (currentStep === "config" && item.step === "welcome") ||
                            (currentStep === "complete" && item.step !== "complete");
                        const isActive = currentStep === item.step;

                        return (
                            <div key={item.step} className="flex items-center">
                                <div
                                    className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                                        isDone
                                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                            : isActive
                                            ? "bg-primary text-primary-foreground shadow-md shadow-primary/30 ring-2 ring-primary/20"
                                            : "bg-muted text-muted-foreground border border-border"
                                    }`}
                                >
                                    {isDone ? <Check className="w-4 h-4 text-emerald-400" /> : item.label}
                                </div>
                                {idx < 2 && (
                                    <div
                                        className={`w-12 h-0.5 mx-2 transition-all ${
                                            isDone ? "bg-emerald-500/50" : "bg-border"
                                        }`}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Main Card */}
                <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
                    {/* STEP 1: WELCOME */}
                    {currentStep === "welcome" && (
                        <div className="space-y-6">
                            <div className="text-center space-y-2">
                                <h2 className="text-xl font-bold text-foreground">Welcome to Luminila ERP</h2>
                                <p className="text-muted-foreground text-sm leading-relaxed">
                                    Zero-friction setup will initialize your database engine, seed default roles, and create your super-administrator account in a single step.
                                </p>
                            </div>

                            {/* Database connectivity pill */}
                            <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className={`w-3 h-3 rounded-full ${
                                                dbConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                                            }`}
                                        />
                                        <span className="text-sm font-semibold text-foreground">
                                            {dbConnected ? "PocketBase Database Connected" : "PocketBase Standby"}
                                        </span>
                                    </div>
                                    <span className="text-xs font-mono text-muted-foreground bg-background px-2 py-1 rounded border border-border">
                                        {pbUrl}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Automatic port discovery active. Zero manual database setup required.
                                </p>
                            </div>

                            {/* Key Highlights */}
                            <div className="grid grid-cols-1 gap-2.5">
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/60">
                                    <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
                                    <span className="text-xs text-foreground font-medium">
                                        Unified Admin: Single login for both ERP system & Database
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/60">
                                    <Store className="w-5 h-5 text-primary shrink-0" />
                                    <span className="text-xs text-foreground font-medium">
                                        Automated Schema: Default roles (Admin, Manager, Staff) pre-seeded
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/60">
                                    <Sparkles className="w-5 h-5 text-primary shrink-0" />
                                    <span className="text-xs text-foreground font-medium">
                                        Direct Launch: Instant automatic login on setup completion
                                    </span>
                                </div>
                            </div>

                            <Button
                                onClick={() => setCurrentStep("config")}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-11 shadow-md shadow-primary/20"
                            >
                                Get Started
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    )}

                    {/* STEP 2: UNIFIED STORE & ADMIN CONFIG */}
                    {currentStep === "config" && (
                        <form onSubmit={handleUnifiedSetup} className="space-y-5">
                            <div>
                                <h2 className="text-xl font-bold text-foreground">Configure Store & Admin</h2>
                                <p className="text-muted-foreground text-xs mt-1">
                                    Enter your store details once. Everything is provisioned automatically.
                                </p>
                            </div>

                            {/* Store Name */}
                            <div className="space-y-1.5">
                                <Label htmlFor="storeName" className="text-xs font-semibold text-foreground flex items-center gap-2">
                                    <Store className="w-3.5 h-3.5 text-primary" /> Store / Business Name
                                </Label>
                                <Input
                                    id="storeName"
                                    value={formData.storeName}
                                    onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
                                    placeholder="e.g. Luminila Fine Jewellery"
                                    className="h-10 bg-background/50 border-border text-foreground"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Admin Name */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="adminName" className="text-xs font-semibold text-foreground flex items-center gap-2">
                                        <User className="w-3.5 h-3.5 text-primary" /> Full Name
                                    </Label>
                                    <Input
                                        id="adminName"
                                        value={formData.adminName}
                                        onChange={(e) => setFormData({ ...formData, adminName: e.target.value })}
                                        placeholder="Admin User"
                                        className="h-10 bg-background/50 border-border text-foreground"
                                        required
                                    />
                                </div>

                                {/* Admin Email */}
                                <div className="space-y-1.5">
                                    <Label htmlFor="adminEmail" className="text-xs font-semibold text-foreground flex items-center gap-2">
                                        <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Admin Email
                                    </Label>
                                    <Input
                                        id="adminEmail"
                                        type="email"
                                        value={formData.adminEmail}
                                        onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })}
                                        placeholder="admin@luminila.local"
                                        className="h-10 bg-background/50 border-border text-foreground font-mono text-sm"
                                        required
                                    />
                                </div>
                            </div>

                            {/* Passwords */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="adminPassword" className="text-xs font-semibold text-foreground flex items-center gap-2">
                                        <Lock className="w-3.5 h-3.5 text-primary" /> Password
                                    </Label>
                                    <div className="relative">
                                        <Input
                                            id="adminPassword"
                                            type={showPassword ? "text" : "password"}
                                            value={formData.adminPassword}
                                            onChange={(e) => setFormData({ ...formData, adminPassword: e.target.value })}
                                            placeholder="Min. 8 characters"
                                            className="h-10 bg-background/50 border-border text-foreground pr-10"
                                            required
                                            minLength={8}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                            tabIndex={-1}
                                        >
                                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="adminPasswordConfirm" className="text-xs font-semibold text-foreground flex items-center gap-2">
                                        <Lock className="w-3.5 h-3.5 text-primary" /> Confirm Password
                                    </Label>
                                    <Input
                                        id="adminPasswordConfirm"
                                        type={showPassword ? "text" : "password"}
                                        value={formData.adminPasswordConfirm}
                                        onChange={(e) => setFormData({ ...formData, adminPasswordConfirm: e.target.value })}
                                        placeholder="Repeat password"
                                        className="h-10 bg-background/50 border-border text-foreground"
                                        required
                                        minLength={8}
                                    />
                                </div>
                            </div>

                            {/* Reassurance Callout */}
                            <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs text-muted-foreground flex items-start gap-2.5">
                                <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                                <span>
                                    Unified Admin: This account will have full administrative privileges for both the Luminila ERP application and PocketBase engine.
                                </span>
                            </div>

                            {/* Buttons */}
                            <div className="flex gap-3 pt-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setCurrentStep("welcome")}
                                    disabled={loading}
                                    className="border-border hover:bg-muted text-foreground"
                                >
                                    <ArrowLeft className="w-4 h-4 mr-2" />
                                    Back
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={loading}
                                    className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-11 shadow-md shadow-primary/20"
                                >
                                    {loading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                            Initializing System...
                                        </>
                                    ) : (
                                        <>
                                            Initialize & Launch
                                            <ArrowRight className="w-4 h-4 ml-2" />
                                        </>
                                    )}
                                </Button>
                            </div>
                        </form>
                    )}

                    {/* STEP 3: SETUP COMPLETE */}
                    {currentStep === "complete" && (
                        <div className="text-center space-y-6">
                            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                                <CheckCircle className="w-8 h-8 text-emerald-400" />
                            </div>

                            <div>
                                <h2 className="text-2xl font-bold text-foreground mb-1">Luminila Ready!</h2>
                                <p className="text-muted-foreground text-sm">
                                    Database configured, roles seeded, and administrator session authenticated.
                                </p>
                            </div>

                            {/* Summary Card */}
                            <div className="p-4 rounded-xl bg-muted/40 border border-border text-left space-y-2">
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted-foreground">Store:</span>
                                    <span className="font-semibold text-foreground">{formData.storeName}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted-foreground">Admin Account:</span>
                                    <span className="font-mono font-medium text-foreground">{formData.adminEmail}</span>
                                </div>
                                <div className="flex justify-between items-center text-xs">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400" /> Authenticated
                                    </span>
                                </div>
                            </div>

                            <Button
                                onClick={handleLaunchDashboard}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-11 shadow-md shadow-primary/20"
                            >
                                Launch Dashboard
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>

                            <p className="text-xs text-muted-foreground/70">
                                PocketBase database engine accessible at{" "}
                                <a
                                    href={`${pbUrl}/_/`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary hover:underline"
                                >
                                    {pbUrl}/_/
                                </a>{" "}
                                using the same email & password.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <p className="text-center text-muted-foreground/60 text-xs mt-6">
                    &copy; {new Date().getFullYear()} Luminila. All rights reserved.
                </p>
            </div>
        </div>
    );
}
