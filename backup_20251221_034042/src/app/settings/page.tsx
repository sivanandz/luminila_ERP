"use client";

import { useState } from "react";
import { Header } from "@/components/layout";
import {
    Store,
    Database,
    MessageCircle,
    Shield,
    Bell,
    Palette,
    Save,
    ExternalLink,
    CheckCircle,
    XCircle,
    Globe,
    CreditCard
} from "lucide-react";

interface SettingSection {
    id: string;
    title: string;
    icon: React.ReactNode;
}

const sections: SettingSection[] = [
    { id: "store", title: "Store Settings", icon: <Store size={20} /> },
    { id: "integrations", title: "Integrations", icon: <Database size={20} /> },
    { id: "whatsapp", title: "WhatsApp", icon: <MessageCircle size={20} /> },
    { id: "notifications", title: "Notifications", icon: <Bell size={20} /> },
    { id: "security", title: "Security", icon: <Shield size={20} /> },
];

export default function SettingsPage() {
    const [activeSection, setActiveSection] = useState("store");
    const [isSaving, setIsSaving] = useState(false);

    // Mock connection statuses
    const connections = {
        supabase: true,
        shopify: false,
        woocommerce: false,
        whatsapp: false,
    };

    const handleSave = async () => {
        setIsSaving(true);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setIsSaving(false);
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Settings" subtitle="Configure your Luminila workspace" />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="card sticky top-0 p-2 bg-surface-navy border-surface-hover">
                            <nav className="space-y-1">
                                {sections.map((section) => (
                                    <button
                                        key={section.id}
                                        onClick={() => setActiveSection(section.id)}
                                        className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all ${activeSection === section.id
                                                ? "bg-primary text-bg-navy font-bold shadow-[0_0_10px_rgba(238,189,43,0.2)]"
                                                : "text-moonstone hover:bg-bg-navy hover:text-white"
                                            }`}
                                    >
                                        <span className={activeSection === section.id ? "text-bg-navy" : "text-moonstone group-hover:text-white"}>
                                            {section.icon}
                                        </span>
                                        <span className="font-medium text-sm">{section.title}</span>
                                    </button>
                                ))}
                            </nav>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="lg:col-span-3">
                        <div className="card bg-surface-navy border-surface-hover min-h-[500px]">
                            {activeSection === "store" && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="border-b border-surface-hover pb-4">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <Store className="text-primary" size={24} />
                                            Store Settings
                                        </h2>
                                        <p className="text-moonstone text-sm mt-1">Manage your store details and preferences</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                Store Name
                                            </label>
                                            <input
                                                type="text"
                                                defaultValue="Zennila"
                                                className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                Currency
                                            </label>
                                            <select className="input bg-bg-navy border-surface-hover text-white focus:border-primary">
                                                <option value="INR">₹ INR - Indian Rupee</option>
                                                <option value="USD">$ USD - US Dollar</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                Contact Email
                                            </label>
                                            <input
                                                type="email"
                                                defaultValue="contact@zennila.com"
                                                className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                Contact Phone
                                            </label>
                                            <input
                                                type="tel"
                                                defaultValue="+91 98765 43210"
                                                className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                            Store Address
                                        </label>
                                        <textarea
                                            rows={3}
                                            defaultValue="123 Fashion Street, Mumbai, Maharashtra 400001"
                                            className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                            Low Stock Threshold
                                        </label>
                                        <input
                                            type="number"
                                            defaultValue={5}
                                            min={1}
                                            className="input w-32 bg-bg-navy border-surface-hover text-white focus:border-primary"
                                        />
                                        <p className="text-xs text-moonstone mt-2 italic">
                                            Alert when product stock falls below this number
                                        </p>
                                    </div>
                                </div>
                            )}

                            {activeSection === "integrations" && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="border-b border-surface-hover pb-4">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <Database className="text-primary" size={24} />
                                            Integrations
                                        </h2>
                                        <p className="text-moonstone text-sm mt-1">Connect with external services and platforms</p>
                                    </div>

                                    {/* Supabase */}
                                    <div className="p-6 bg-bg-navy border border-surface-hover rounded-xl hover:border-primary/30 transition-colors">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500 font-bold border border-emerald-500/20">
                                                    <Database size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-white text-lg">Supabase</h3>
                                                    <p className="text-sm text-moonstone">
                                                        Database & Authentication Provider
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {connections.supabase ? (
                                                    <span className="badge badge-success flex items-center gap-1.5 py-1 px-3">
                                                        <CheckCircle size={14} />
                                                        Connected
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-error flex items-center gap-1.5 py-1 px-3">
                                                        <XCircle size={14} />
                                                        Not Connected
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Project URL
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="https://xxx.supabase.co"
                                                    className="input bg-surface-navy border-surface-hover text-white"
                                                    readOnly={connections.supabase}
                                                    value={connections.supabase ? "https://zennila-db.supabase.co" : ""}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Anon Key
                                                </label>
                                                <input
                                                    type="password"
                                                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                                                    className="input bg-surface-navy border-surface-hover text-white"
                                                    readOnly={connections.supabase}
                                                    value={connections.supabase ? "************************" : ""}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Shopify */}
                                    <div className="p-6 bg-bg-navy border border-surface-hover rounded-xl hover:border-primary/30 transition-colors">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-[#96BF48]/10 rounded-xl flex items-center justify-center text-[#96BF48] font-bold border border-[#96BF48]/20">
                                                    <Globe size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-white text-lg">Shopify</h3>
                                                    <p className="text-sm text-moonstone">
                                                        E-commerce Store Sync
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {connections.shopify ? (
                                                    <span className="badge badge-success flex items-center gap-1.5">
                                                        <CheckCircle size={14} />
                                                        Connected
                                                    </span>
                                                ) : (
                                                    <button className="btn btn-outline py-1.5 px-4 text-xs">
                                                        <ExternalLink size={14} />
                                                        Connect
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Store Domain
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="zennila.myshopify.com"
                                                    className="input bg-surface-navy border-surface-hover text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Access Token
                                                </label>
                                                <input
                                                    type="password"
                                                    placeholder="shpat_xxxxx"
                                                    className="input bg-surface-navy border-surface-hover text-white"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeSection === "whatsapp" && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="border-b border-surface-hover pb-4">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <MessageCircle className="text-primary" size={24} />
                                            WhatsApp Automation
                                        </h2>
                                        <p className="text-moonstone text-sm mt-1">Configure automated messaging and sidecar connection</p>
                                    </div>

                                    <div className="p-8 border border-dashed border-surface-hover bg-bg-navy/50 rounded-xl text-center">
                                        <div className="w-16 h-16 bg-[#25D366]/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-[#25D366]/20">
                                            <MessageCircle size={32} className="text-[#25D366]" />
                                        </div>
                                        <h3 className="font-bold text-lg text-white">
                                            Connect WhatsApp Web
                                        </h3>
                                        <p className="text-moonstone mt-2 mb-6 max-w-sm mx-auto">
                                            Scan QR code with your mobile to enable order notifications and customer support integration.
                                        </p>
                                        <button className="btn btn-primary">
                                            Open WhatsApp Dashboard
                                        </button>
                                    </div>
                                </div>
                            )}

                            {activeSection === "notifications" && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="border-b border-surface-hover pb-4">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <Bell className="text-primary" size={24} />
                                            Notifications
                                        </h2>
                                        <p className="text-moonstone text-sm mt-1">Control system alerts and triggers</p>
                                    </div>

                                    <div className="space-y-4">
                                        {[
                                            { key: "lowStock", label: "Low Stock Alerts", desc: "When product stock falls below threshold" },
                                            { key: "newOrder", label: "New Order", desc: "When a new order is received from Shopify" },
                                            { key: "syncError", label: "Sync Errors", desc: "When synchronization with external services fails" },
                                        ].map((item) => (
                                            <div key={item.key} className="flex items-center justify-between p-4 bg-bg-navy border border-surface-hover rounded-xl">
                                                <div>
                                                    <p className="font-bold text-white text-sm">{item.label}</p>
                                                    <p className="text-xs text-moonstone mt-1">{item.desc}</p>
                                                </div>
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" defaultChecked className="sr-only peer" />
                                                    <div className="w-11 h-6 bg-surface-hover peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Save Button */}
                            <div className="mt-8 pt-6 border-t border-surface-hover flex justify-end">
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="btn btn-primary px-8"
                                >
                                    <Save size={18} />
                                    {isSaving ? "Saving..." : "Save Changes"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
