"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Sparkles } from "lucide-react";
import { ClientResponseError } from "pocketbase";

interface PocketBaseFieldError {
    message?: string;
}

import { useAuth } from "@/contexts/AuthContext";
import { isSingleAccountMode, SINGLE_ACCOUNT_EMAIL } from "@/lib/deployment-mode";
import Link from "next/link";

export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const [formData, setFormData] = useState({
        email: isSingleAccountMode() ? SINGLE_ACCOUNT_EMAIL : "",
        password: "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            await login(formData.email, formData.password);
            toast.success("Welcome back!");
            router.push("/");
        } catch (err) {
            console.error("Auth error:", err);
            const pbErr = err instanceof ClientResponseError ? err : null;
            let message = pbErr?.response?.message || (err instanceof Error ? err.message : undefined) || "Authentication failed";
            const responseData = pbErr?.response?.data;
            if (responseData && Object.keys(responseData).length > 0) {
                const fieldErrors = Object.entries(responseData)
                    .map(([field, errObj]) => `${field}: ${(errObj as PocketBaseFieldError | undefined)?.message || 'invalid'}`)
                    .join(", ");
                if (fieldErrors) message = fieldErrors;
            }
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-md relative z-10">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4 shadow-lg shadow-primary/5">
                        <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold text-foreground tracking-tight">Luminila</h1>
                    <p className="text-muted-foreground mt-1 text-sm">Inventory Management System</p>
                </div>

                {/* Card */}
                <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
                    <h2 className="text-xl font-semibold text-foreground mb-6">
                        Sign in to your account
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <Label htmlFor="email" className="text-foreground text-sm font-medium">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="mt-1.5 bg-background border-input"
                                required
                            />
                        </div>

                        <div>
                            <Label htmlFor="password" className="text-foreground text-sm font-medium">Password</Label>
                            <div className="relative mt-1.5">
                                <Input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="••••••••"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="bg-background border-input pr-10"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full h-11 bg-primary text-primary-foreground font-semibold hover:bg-primary/90 text-sm rounded-lg cursor-pointer transition-colors shadow-md shadow-primary/20"
                        >
                            {loading ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : null}
                            Sign In
                        </Button>

                        <div className="pt-1" />
                    </form>

                    {!isSingleAccountMode() && (
                        <div className="mt-6 text-center space-y-2">
                            <div>
                                <Link href="/setup?force=true" className="text-muted-foreground hover:text-primary transition-colors text-xs font-medium">
                                    First time here or need to reconfigure? Run initial setup wizard
                                </Link>
                            </div>
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
