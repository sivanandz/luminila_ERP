"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Sparkles } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const [formData, setFormData] = useState({
        email: "",
        password: "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            await login(formData.email, formData.password);
            toast.success("Welcome back!");
            router.push("/");
        } catch (err: any) {
            console.error("Auth error:", err);
            let message = err?.response?.message || err?.message || "Authentication failed";
            if (err?.response?.data && Object.keys(err.response.data).length > 0) {
                const fieldErrors = Object.entries(err.response.data)
                    .map(([field, errObj]: [string, any]) => `${field}: ${errObj?.message || 'invalid'}`)
                    .join(", ");
                if (fieldErrors) message = fieldErrors;
            }
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-bg-navy via-bg-deep to-bg-navy p-4">
            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-electric-teal/5 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-royal-purple/5 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-md relative">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-electric-teal to-royal-purple mb-4">
                        <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white font-manrope">Luminila</h1>
                    <p className="text-moonstone mt-1">Inventory Management System</p>
                </div>

                {/* Card */}
                <div className="bg-surface-card/50 backdrop-blur-xl border border-surface-hover rounded-2xl p-8 shadow-2xl">
                    <h2 className="text-xl font-semibold text-white mb-6">
                        Sign in to your account
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <Label htmlFor="email" className="text-moonstone">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="mt-1 bg-bg-navy border-surface-hover focus:border-electric-teal"
                                required
                            />
                        </div>

                        <div>
                            <Label htmlFor="password" className="text-moonstone">Password</Label>
                            <div className="relative mt-1">
                                <Input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="••••••••"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="bg-bg-navy border-surface-hover focus:border-electric-teal pr-10"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-moonstone hover:text-white transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full h-11 bg-primary text-primary-foreground font-bold hover:bg-primary/90 text-sm rounded-lg cursor-pointer transition-colors shadow-md"
                        >
                            {loading ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : null}
                            Sign In
                        </Button>
                    </form>

                    <div className="mt-6 text-center">
                        <Link href="/setup" className="text-moonstone hover:text-electric-teal transition-colors text-sm">
                            First time here? Run initial setup
                        </Link>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-moonstone/50 text-sm mt-6">
                    &copy; {new Date().getFullYear()} Luminila. All rights reserved.
                </p>
            </div>
        </div>
    );
}
