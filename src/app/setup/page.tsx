"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { pb, getPocketBaseUrl } from "@/lib/pocketbase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
    Loader2,
    Sparkles,
    CheckCircle,
    Database,
    User,
    Shield,
    ArrowRight,
    ArrowLeft,
    Server,
    AlertTriangle,
} from "lucide-react";

type SetupStep = "welcome" | "database" | "admin" | "complete";

export default function SetupWizardPage() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState<SetupStep>("welcome");
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(true);

    // Database status
    const [dbConnected, setDbConnected] = useState(false);
    const [pbAdminExists, setPbAdminExists] = useState(false);
    const [pbUrl, setPbUrl] = useState(getPocketBaseUrl());

    // Form data
    const [pbAdmin, setPbAdmin] = useState({
        email: "",
        password: "",
    });

    const [appAdmin, setAppAdmin] = useState({
        name: "",
        email: "",
        password: "",
        passwordConfirm: "",
    });

    // Check initial status
    useEffect(() => {
        setPbUrl(getPocketBaseUrl());
        checkStatus();

        const handleServerChange = (e: any) => {
            if (e?.detail?.url) {
                setPbUrl(e.detail.url);
                checkStatus();
            }
        };
        window.addEventListener("pb:server-changed", handleServerChange);
        return () => window.removeEventListener("pb:server-changed", handleServerChange);
    }, []);

    const checkStatus = async () => {
        setChecking(true);
        try {
            // Check if PocketBase is running
            const health = await pb.health.check();
            setDbConnected(health.code === 200);

            // Check if any users exist (if so, setup is done)
            try {
                const users = await pb.collection("users").getList(1, 1);
                if (users.totalItems > 0) {
                    // Setup already done, redirect to login
                    router.push("/login");
                    return;
                }
            } catch (e: any) {
                // If 403 Forbidden, users collection exists and is already configured
                if (e?.status === 403) {
                    router.push("/login");
                    return;
                }
            }

            // Check if PB admin exists by trying to authenticate
            try {
                if (!pbAdmin.email || !pbAdmin.password) throw new Error("no credentials yet");
                await pb.admins.authWithPassword(pbAdmin.email, pbAdmin.password);
                setPbAdminExists(true);
                pb.authStore.clear(); // Clear admin auth
            } catch (e) {
                setPbAdminExists(false);
            }
        } catch (e) {
            setDbConnected(false);
        }
        setChecking(false);
    };

    const handleSetupDatabase = async () => {
        setLoading(true);
        try {
            // Try to login as PocketBase admin
            try {
                await pb.admins.authWithPassword(pbAdmin.email, pbAdmin.password);
                toast.success("Connected to PocketBase admin");
            } catch (e) {
                toast.info("Please create superuser in PocketBase Admin UI first or verify credentials");
                window.open(`${pbUrl}/_/`, "_blank");
                setLoading(false);
                return;
            }

            // Run schema setup check
            toast.info("Checking database schema...");
            const collections = await pb.collections.getFullList();

            if (collections.length < 10) {
                toast.info("Database schema appears empty. Restart PocketBase so bundled migrations apply (npm run dev).");
            }

            // Seed system roles with comprehensive permissions
            const DEFAULT_ROLES = [
                {
                    name: "Admin",
                    description: "Full access to all features",
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
                    description: "Manage operations, view reports",
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
                    description: "Basic access for daily operations",
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
                    description: "Read-only access for reporting",
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

            let seededCount = 0;
            const failedRoles: string[] = [];
            for (const role of DEFAULT_ROLES) {
                try {
                    await pb.collection("roles").getFirstListItem(`name="${role.name}"`);
                } catch (e: any) {
                    if (e?.status === 404) {
                        try {
                            await pb.collection("roles").create(role);
                            seededCount++;
                        } catch (err: any) {
                            failedRoles.push(role.name);
                        }
                    }
                }
            }

            if (failedRoles.length > 0) {
                toast.error(`Some roles could not be created: ${failedRoles.join(", ")}`);
            } else if (seededCount > 0) {
                toast.success(`${seededCount} default roles configured`);
            } else {
                toast.success("Default roles already configured");
            }

            pb.authStore.clear();
            setPbAdminExists(true);
            setCurrentStep("admin");
            toast.success("Database configuration ready!");
        } catch (err: any) {
            toast.error(err.message || "Setup failed");
        } finally {
            setLoading(false);
        }
    };

    const handleCreateAdmin = async () => {
        if (appAdmin.password !== appAdmin.passwordConfirm) {
            toast.error("Passwords do not match");
            return;
        }
        if (appAdmin.password.length < 8) {
            toast.error("Password must be at least 8 characters");
            return;
        }
        if (!appAdmin.email || !appAdmin.name) {
            toast.error("Please fill in all fields");
            return;
        }

        setLoading(true);
        try {
            // Login as PB admin to create user & assign role
            await pb.admins.authWithPassword(pbAdmin.email, pbAdmin.password);

            // Create or fetch existing user (idempotency guard)
            let userRecord: any;
            try {
                userRecord = await pb.collection("users").getFirstListItem(`email="${appAdmin.email}"`);
                toast.info("Existing account found. Ensuring active admin status...");
            } catch (e: any) {
                if (e?.status === 404) {
                    userRecord = await pb.collection("users").create({
                        email: appAdmin.email,
                        password: appAdmin.password,
                        passwordConfirm: appAdmin.passwordConfirm,
                        name: appAdmin.name,
                        emailVisibility: true,
                        verified: true,
                        is_active: true,
                    });
                } else {
                    throw e;
                }
            }

            // Ensure is_active is true
            if (userRecord && userRecord.is_active === false) {
                await pb.collection("users").update(userRecord.id, { is_active: true });
            }

            // Assign Admin role
            try {
                const adminRole = await pb.collection("roles").getFirstListItem('name="Admin"');
                try {
                    await pb.collection("user_roles").getFirstListItem(`user="${userRecord.id}" && role="${adminRole.id}"`);
                } catch (roleNotFound: any) {
                    if (roleNotFound?.status === 404) {
                        await pb.collection("user_roles").create({
                            user: userRecord.id,
                            role: adminRole.id,
                        });
                    }
                }
            } catch (e) {
                console.warn("Could not assign admin role:", e);
            }

            pb.authStore.clear();

            // Auto-login as the new user
            try {
                await pb.collection("users").authWithPassword(appAdmin.email, appAdmin.password);
                setCurrentStep("complete");
                toast.success("Admin account created and authenticated!");
            } catch (loginErr) {
                setCurrentStep("complete");
                toast.success("Admin account created! Please sign in.");
            }
        } catch (err: any) {
            toast.error(err.message || "Failed to create admin");
        } finally {
            setLoading(false);
        }
    };

    const handleComplete = () => {
        router.push("/");
    };

    if (checking) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-bg-navy via-bg-deep to-bg-navy">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-electric-teal mx-auto mb-4" />
                    <p className="text-moonstone">Checking system status...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-bg-navy via-bg-deep to-bg-navy p-4">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-electric-teal/5 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-royal-purple/5 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-lg relative">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-electric-teal to-royal-purple mb-4">
                        <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white font-manrope">Luminila Setup</h1>
                    <p className="text-moonstone mt-1">First-time configuration wizard</p>
                </div>

                {/* Progress Steps */}
                <div className="flex items-center justify-center gap-2 mb-8">
                    {["welcome", "database", "admin", "complete"].map((step, index) => (
                        <div key={step} className="flex items-center">
                            <div
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${currentStep === step
                                    ? "bg-electric-teal text-primary-foreground"
                                    : ["welcome", "database", "admin", "complete"].indexOf(currentStep) > index
                                        ? "bg-electric-teal/30 text-electric-teal"
                                        : "bg-surface-hover text-moonstone"
                                    }`}
                            >
                                {["welcome", "database", "admin", "complete"].indexOf(currentStep) > index ? (
                                    <CheckCircle className="w-4 h-4" />
                                ) : (
                                    index + 1
                                )}
                            </div>
                            {index < 3 && (
                                <div className={`w-8 h-0.5 mx-1 ${["welcome", "database", "admin", "complete"].indexOf(currentStep) > index
                                    ? "bg-electric-teal/30"
                                    : "bg-surface-hover"
                                    }`} />
                            )}
                        </div>
                    ))}
                </div>

                {/* Card */}
                <div className="bg-surface-card/50 backdrop-blur-xl border border-surface-hover rounded-2xl p-8 shadow-2xl">
                    {/* Welcome Step */}
                    {currentStep === "welcome" && (
                        <div className="text-center space-y-6">
                            <div className="w-16 h-16 rounded-2xl bg-electric-teal/10 flex items-center justify-center mx-auto">
                                <Sparkles className="w-8 h-8 text-electric-teal" />
                            </div>
                            <div>
                                <h2 className="text-xl font-semibold text-white mb-2">Welcome to Luminila</h2>
                                <p className="text-moonstone">
                                    Let's set up your inventory management system. This wizard will help you configure the database and create your admin account.
                                </p>
                            </div>
                            <div className="space-y-3 text-left">
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-hover/50">
                                    <Database className="w-5 h-5 text-electric-teal" />
                                    <span className="text-sm text-moonstone">Configure database connection</span>
                                </div>
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-hover/50">
                                    <User className="w-5 h-5 text-royal-purple" />
                                    <span className="text-sm text-moonstone">Create your admin account</span>
                                </div>
                                <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-hover/50">
                                    <Shield className="w-5 h-5 text-green-400" />
                                    <span className="text-sm text-moonstone">Set up roles and permissions</span>
                                </div>
                            </div>
                            <Button
                                onClick={() => setCurrentStep("database")}
                                className="w-full bg-gradient-to-r from-electric-teal to-royal-purple hover:opacity-90 text-white"
                            >
                                Get Started
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    )}

                    {/* Database Step */}
                    {currentStep === "database" && (
                        <div className="space-y-6">
                            <div className="text-center">
                                <div className="w-12 h-12 rounded-xl bg-electric-teal/10 flex items-center justify-center mx-auto mb-4">
                                    <Database className="w-6 h-6 text-electric-teal" />
                                </div>
                                <h2 className="text-xl font-semibold text-white">Database Setup</h2>
                            </div>

                            {/* Connection Status */}
                            <div className={`p-4 rounded-lg border ${dbConnected ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                                <div className="flex items-center gap-3">
                                    <Server className={`w-5 h-5 ${dbConnected ? "text-green-400" : "text-red-400"}`} />
                                    <div>
                                        <p className={`font-medium ${dbConnected ? "text-green-400" : "text-red-400"}`}>
                                            {dbConnected ? "PocketBase Connected" : "PocketBase Not Running"}
                                        </p>
                                        <p className="text-xs text-moonstone">
                                            {dbConnected ? pbUrl : "Start PocketBase first"}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {!dbConnected && (
                                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                    <div className="flex items-start gap-3">
                                        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5" />
                                        <div className="text-sm text-moonstone">
                                            <p className="font-medium text-amber-400 mb-1">Start PocketBase</p>
                                            <p>Run this command in terminal:</p>
                                            <code className="block mt-2 p-2 bg-bg-navy rounded text-xs">
                                                npm run dev:all
                                            </code>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {dbConnected && (
                                <>
                                    <div>
                                        <Label className="text-moonstone">PocketBase Admin Email</Label>
                                        <Input
                                            type="email"
                                            value={pbAdmin.email}
                                            onChange={(e) => setPbAdmin({ ...pbAdmin, email: e.target.value })}
                                            className="mt-1 bg-bg-navy border-surface-hover"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-moonstone">PocketBase Admin Password</Label>
                                        <Input
                                            type="password"
                                            value={pbAdmin.password}
                                            onChange={(e) => setPbAdmin({ ...pbAdmin, password: e.target.value })}
                                            className="mt-1 bg-bg-navy border-surface-hover"
                                        />
                                        <p className="text-xs text-moonstone/70 mt-1">
                                            Create this admin at: <a href={`${pbUrl}/_/`} target="_blank" className="text-electric-teal hover:underline">PocketBase Admin UI</a>
                                        </p>
                                    </div>
                                </>
                            )}

                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    onClick={() => setCurrentStep("welcome")}
                                    className="flex-1"
                                >
                                    <ArrowLeft className="w-4 h-4 mr-2" />
                                    Back
                                </Button>
                                <Button
                                    onClick={dbConnected ? handleSetupDatabase : checkStatus}
                                    disabled={loading}
                                    className="flex-1 bg-gradient-to-r from-electric-teal to-royal-purple hover:opacity-90"
                                >
                                    {loading ? (
                                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                    ) : null}
                                    {dbConnected ? "Setup Database" : "Retry Connection"}
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Admin Account Step */}
                    {currentStep === "admin" && (
                        <div className="space-y-6">
                            <div className="text-center">
                                <div className="w-12 h-12 rounded-xl bg-royal-purple/10 flex items-center justify-center mx-auto mb-4">
                                    <User className="w-6 h-6 text-royal-purple" />
                                </div>
                                <h2 className="text-xl font-semibold text-white">Create Admin Account</h2>
                                <p className="text-moonstone text-sm mt-1">This will be your main login for the app</p>
                            </div>

                            <div>
                                <Label className="text-moonstone">Full Name</Label>
                                <Input
                                    type="text"
                                    placeholder="John Doe"
                                    value={appAdmin.name}
                                    onChange={(e) => setAppAdmin({ ...appAdmin, name: e.target.value })}
                                    className="mt-1 bg-bg-navy border-surface-hover"
                                />
                            </div>
                            <div>
                                <Label className="text-moonstone">Email</Label>
                                <Input
                                    type="email"
                                    placeholder="admin@yourstore.com"
                                    value={appAdmin.email}
                                    onChange={(e) => setAppAdmin({ ...appAdmin, email: e.target.value })}
                                    className="mt-1 bg-bg-navy border-surface-hover"
                                />
                            </div>
                            <div>
                                <Label className="text-moonstone">Password</Label>
                                <Input
                                    type="password"
                                    placeholder="Min 8 characters"
                                    value={appAdmin.password}
                                    onChange={(e) => setAppAdmin({ ...appAdmin, password: e.target.value })}
                                    className="mt-1 bg-bg-navy border-surface-hover"
                                />
                            </div>
                            <div>
                                <Label className="text-moonstone">Confirm Password</Label>
                                <Input
                                    type="password"
                                    placeholder="Repeat password"
                                    value={appAdmin.passwordConfirm}
                                    onChange={(e) => setAppAdmin({ ...appAdmin, passwordConfirm: e.target.value })}
                                    className="mt-1 bg-bg-navy border-surface-hover"
                                />
                            </div>

                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    onClick={() => setCurrentStep("database")}
                                    className="flex-1"
                                >
                                    <ArrowLeft className="w-4 h-4 mr-2" />
                                    Back
                                </Button>
                                <Button
                                    onClick={handleCreateAdmin}
                                    disabled={loading}
                                    className="flex-1 bg-gradient-to-r from-electric-teal to-royal-purple hover:opacity-90"
                                >
                                    {loading ? (
                                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                    ) : null}
                                    Create Account
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Complete Step */}
                    {currentStep === "complete" && (
                        <div className="text-center space-y-6">
                            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                                <CheckCircle className="w-8 h-8 text-green-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-semibold text-white mb-2">Setup Complete!</h2>
                                <p className="text-moonstone">
                                    Your Luminila inventory management system is ready to use.
                                </p>
                            </div>
                            <div className="p-4 rounded-lg bg-surface-hover/50 text-left">
                                <p className="text-sm text-moonstone mb-2">Your admin account:</p>
                                <p className="text-white font-medium">{appAdmin.email}</p>
                            </div>
                            <Button
                                onClick={handleComplete}
                                className="w-full bg-gradient-to-r from-electric-teal to-royal-purple hover:opacity-90"
                            >
                                Go to Dashboard
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <p className="text-center text-moonstone/50 text-sm mt-6">
                    &copy; {new Date().getFullYear()} Luminila. All rights reserved.
                </p>
            </div>
        </div>
    );
}
