"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pb } from "@/lib/pocketbase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Sparkles } from "lucide-react";

export default function LoginPage() {
    const router = useRouter();
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const [formData, setFormData] = useState({
        email: "",
        password: "",
        passwordConfirm: "",
        name: "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            if (isLogin) {
                // Login
                await pb.collection("users").authWithPassword(
                    formData.email,
                    formData.password
                );
                toast.success("Welcome back!");
                router.push("/");
            } else {
                // Register
                if (formData.password !== formData.passwordConfirm) {
                    toast.error("Passwords do not match");
                    setLoading(false);
                    return;
                }

                if (formData.password.length < 8) {
                    toast.error("Password must be at least 8 characters");
                    setLoading(false);
                    return;
                }

                // Create user
                await pb.collection("users").create({
                    email: formData.email,
                    password: formData.password,
                    passwordConfirm: formData.passwordConfirm,
                    name: formData.name,
                    emailVisibility: true,
                });

                // Auto-login after registration
                await pb.collection("users").authWithPassword(
                    formData.email,
                    formData.password
                );

                toast.success("Account created successfully!");
                router.push("/");
            }
        } catch (err: any) {
            console.error("Auth error:", err);
            const message = err?.response?.message || err?.message || "Authentication failed";
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
                        {isLogin ? "Sign in to your account" : "Create new account"}
                    </h2>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!isLogin && (
                            <div>
                                <Label htmlFor="name" className="text-moonstone">Full Name</Label>
                                <Input
                                    id="name"
                                    type="text"
                                    placeholder="John Doe"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="mt-1 bg-bg-navy border-surface-hover focus:border-electric-teal"
                                    required={!isLogin}
                                />
                            </div>
                        )}

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

                        {!isLogin && (
                            <div>
                                <Label htmlFor="passwordConfirm" className="text-moonstone">Confirm Password</Label>
                                <Input
                                    id="passwordConfirm"
                                    type="password"
                                    placeholder="••••••••"
                                    value={formData.passwordConfirm}
                                    onChange={(e) => setFormData({ ...formData, passwordConfirm: e.target.value })}
                                    className="mt-1 bg-bg-navy border-surface-hover focus:border-electric-teal"
                                    required={!isLogin}
                                />
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-electric-teal to-royal-purple hover:opacity-90 text-white font-medium py-2.5"
                        >
                            {loading ? (
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : null}
                            {isLogin ? "Sign In" : "Create Account"}
                        </Button>
                    </form>

                    <div className="mt-6 text-center">
                        <button
                            type="button"
                            onClick={() => setIsLogin(!isLogin)}
                            className="text-moonstone hover:text-electric-teal transition-colors text-sm"
                        >
                            {isLogin
                                ? "Don't have an account? Sign up"
                                : "Already have an account? Sign in"}
                        </button>
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
