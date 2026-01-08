"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
    CreditCard,
    FileText,
    FolderTree,
    Tags,
    Plus,
    Trash2,
    Edit,
    Loader2,
} from "lucide-react";
import { LogoUpload } from "@/components/settings/LogoUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { getCategories, createCategory, deleteCategory, type Category } from "@/lib/categories";
import { getAttributes, createAttribute, deleteAttribute, type ProductAttribute, type AttributeType } from "@/lib/attributes";

interface SettingSection {
    id: string;
    title: string;
    icon: React.ReactNode;
}

const sections: SettingSection[] = [
    { id: "store", title: "Store Settings", icon: <Store size={20} /> },
    { id: "invoice", title: "Invoice & GST", icon: <FileText size={20} /> },
    { id: "categories", title: "Categories", icon: <FolderTree size={20} /> },
    { id: "attributes", title: "Product Attributes", icon: <Tags size={20} /> },
    { id: "integrations", title: "Integrations", icon: <Database size={20} /> },
    { id: "whatsapp", title: "WhatsApp", icon: <MessageCircle size={20} /> },
    { id: "notifications", title: "Notifications", icon: <Bell size={20} /> },
    { id: "security", title: "Security", icon: <Shield size={20} /> },
];

export default function SettingsPage() {
    const router = useRouter();
    const [activeSection, setActiveSection] = useState("store");
    const [isSaving, setIsSaving] = useState(false);

    // Unified Settings State
    const [settings, setSettings] = useState({
        storeName: "Zennila",
        currency: "INR",
        email: "contact@zennila.com",
        phone: "+91 98765 43210",
        address: "123 Fashion Street, Mumbai, Maharashtra 400001",
        lowStockThreshold: 5,
        companyLogo: null as string | null,
        defaultPrintMode: "regular",
        gstin: "",
        pan: "",
        stateCode: "",
        bankName: "",
        accountNumber: "",
        ifsc: "",
        branch: "",
        invoiceFooter: "Thank you for your business!",
        // Integrations
        shopifyStore: "",
        shopifyToken: "",
        // PhonePe
        phonepeMerchantId: "",
        phonepeSaltKey: "",
        phonepeSaltIndex: "1",
        phonepeEnv: "UAT",
    });

    // Categories state
    const [categories, setCategories] = useState<Category[]>([]);
    const [showCategoryDialog, setShowCategoryDialog] = useState(false);
    const [newCategory, setNewCategory] = useState({ name: "", parent_id: "" });

    // Attributes state
    const [attributes, setAttributes] = useState<ProductAttribute[]>([]);
    const [showAttributeDialog, setShowAttributeDialog] = useState(false);
    const [newAttribute, setNewAttribute] = useState({
        name: "",
        attribute_type: "text" as AttributeType,
        options: "",
        is_required: false,
    });

    // Load data
    useEffect(() => {
        // Load settings from localStorage
        const savedSettings = localStorage.getItem("luminila_settings");
        if (savedSettings) {
            try {
                setSettings(prev => ({ ...prev, ...JSON.parse(savedSettings) }));
            } catch (e) {
                console.error("Failed to parse settings", e);
            }
        }

        if (activeSection === "categories") {
            getCategories().then(setCategories);
        } else if (activeSection === "attributes") {
            getAttributes().then(setAttributes);
        }
    }, [activeSection]);

    // Mock connection statuses
    const connections = {
        supabase: true,
        shopify: false,
        woocommerce: false,
        whatsapp: false,
        phonepe: !!(settings.phonepeMerchantId && settings.phonepeSaltKey),
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Save to localStorage
            localStorage.setItem("luminila_settings", JSON.stringify(settings));

            // Simulate network delay
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Show toast (native for now)
            const el = document.createElement('div');
            el.textContent = `Settings Saved`;
            el.className = 'fixed bottom-4 right-4 bg-emerald-500 text-white px-4 py-2 rounded shadow-lg z-[100] animate-fade-in-up font-bold flex items-center gap-2';
            el.innerHTML = '<span class="text-xl">✓</span> Settings Saved Successfully';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 2000);

        } catch (error) {
            console.error("Failed to save settings", error);
            alert("Failed to save settings");
        } finally {
            setIsSaving(false);
        }
    };

    const handleAddCategory = async () => {
        try {
            await createCategory({
                name: newCategory.name,
                parent: newCategory.parent_id || undefined,
            });
            setNewCategory({ name: "", parent_id: "" });
            setShowCategoryDialog(false);
            getCategories().then(setCategories);
        } catch (err) {
            console.error("Error adding category:", err);
        }
    };

    const handleDeleteCategory = async (id: string) => {
        if (!confirm("Delete this category?")) return;
        try {
            await deleteCategory(id);
            getCategories().then(setCategories);
        } catch (err) {
            console.error("Error deleting category:", err);
        }
    };

    const handleAddAttribute = async () => {
        try {
            await createAttribute({
                name: newAttribute.name,
                attribute_type: newAttribute.attribute_type,
                options: newAttribute.attribute_type === "select"
                    ? newAttribute.options.split(",").map(o => o.trim()).filter(Boolean)
                    : undefined,
                is_required: newAttribute.is_required,
            });
            setNewAttribute({ name: "", attribute_type: "text", options: "", is_required: false });
            setShowAttributeDialog(false);
            getAttributes().then(setAttributes);
        } catch (err) {
            console.error("Error adding attribute:", err);
        }
    };

    const handleDeleteAttribute = async (id: string) => {
        if (!confirm("Delete this attribute?")) return;
        try {
            await deleteAttribute(id);
            getAttributes().then(setAttributes);
        } catch (err) {
            console.error("Error deleting attribute:", err);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Settings"
                subtitle="Configure your Luminila workspace"
                action={
                    <Button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold min-w-[140px]"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="mr-2 h-4 w-4" />
                                Save Changes
                            </>
                        )}
                    </Button>
                }
            />

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
                                                value={settings.storeName}
                                                onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                                                className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                Currency
                                            </label>
                                            <select
                                                value={settings.currency}
                                                onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                                                className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                            >
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
                                                value={settings.email}
                                                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                                                className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                Contact Phone
                                            </label>
                                            <input
                                                type="tel"
                                                value={settings.phone}
                                                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
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
                                            value={settings.address}
                                            onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                                            className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                            Low Stock Threshold
                                        </label>
                                        <input
                                            type="number"
                                            value={settings.lowStockThreshold}
                                            onChange={(e) => setSettings({ ...settings, lowStockThreshold: parseInt(e.target.value) || 0 })}
                                            min={1}
                                            className="input w-32 bg-bg-navy border-surface-hover text-white focus:border-primary"
                                        />
                                        <p className="text-xs text-moonstone mt-2 italic">
                                            Alert when product stock falls below this number
                                        </p>
                                    </div>
                                </div>
                            )}

                            {activeSection === "invoice" && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="border-b border-surface-hover pb-4">
                                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                            <FileText className="text-primary" size={24} />
                                            Invoice & GST Settings
                                        </h2>
                                        <p className="text-moonstone text-sm mt-1">Configure invoice appearance and GST details</p>
                                    </div>

                                    {/* Company Logo */}
                                    <div>
                                        <label className="block text-xs font-bold text-moonstone uppercase mb-3">
                                            Company Logo
                                        </label>
                                        <LogoUpload
                                            currentLogo={settings.companyLogo || undefined}
                                            onLogoChange={(logo) => setSettings({ ...settings, companyLogo: logo })}
                                        />
                                        <p className="text-xs text-moonstone mt-2 italic">
                                            Appears on invoices and receipts
                                        </p>
                                    </div>

                                    {/* Print Mode */}
                                    <div>
                                        <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                            Default Print Mode
                                        </label>
                                        <select
                                            value={settings.defaultPrintMode}
                                            onChange={(e) => setSettings({ ...settings, defaultPrintMode: e.target.value })}
                                            className="input w-48 bg-bg-navy border-surface-hover text-white focus:border-primary"
                                        >
                                            <option value="regular">A4 (Regular)</option>
                                            <option value="thermal58">Thermal 58mm</option>
                                            <option value="thermal80">Thermal 80mm</option>
                                        </select>
                                        <p className="text-xs text-moonstone mt-2 italic">
                                            Select your preferred invoice print format
                                        </p>
                                    </div>

                                    {/* GST Details */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                GSTIN
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="22AAAAA0000A1Z5"
                                                maxLength={15}
                                                value={settings.gstin}
                                                onChange={(e) => setSettings({ ...settings, gstin: e.target.value })}
                                                className="input bg-bg-navy border-surface-hover text-white focus:border-primary uppercase"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                PAN
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="AAAAA0000A"
                                                maxLength={10}
                                                value={settings.pan}
                                                onChange={(e) => setSettings({ ...settings, pan: e.target.value })}
                                                className="input bg-bg-navy border-surface-hover text-white focus:border-primary uppercase"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                State Code
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="27 (Maharashtra)"
                                                maxLength={2}
                                                value={settings.stateCode}
                                                onChange={(e) => setSettings({ ...settings, stateCode: e.target.value })}
                                                className="input w-32 bg-bg-navy border-surface-hover text-white focus:border-primary"
                                            />
                                        </div>
                                    </div>

                                    {/* Bank Details */}
                                    {/* Bank Details */}
                                    <div className="border-t border-surface-hover pt-6">
                                        <h3 className="text-sm font-bold text-white mb-4">Bank Details (for invoices)</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Bank Name
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="State Bank of India"
                                                    value={settings.bankName}
                                                    onChange={(e) => setSettings({ ...settings, bankName: e.target.value })}
                                                    className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Account Number
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="1234567890"
                                                    value={settings.accountNumber}
                                                    onChange={(e) => setSettings({ ...settings, accountNumber: e.target.value })}
                                                    className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    IFSC Code
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="SBIN0001234"
                                                    value={settings.ifsc}
                                                    onChange={(e) => setSettings({ ...settings, ifsc: e.target.value })}
                                                    className="input bg-bg-navy border-surface-hover text-white focus:border-primary uppercase"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Branch
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="Mumbai Main"
                                                    value={settings.branch}
                                                    onChange={(e) => setSettings({ ...settings, branch: e.target.value })}
                                                    className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Invoice Footer */}
                                    <div>
                                        <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                            Invoice Footer Text
                                        </label>
                                        <textarea
                                            rows={2}
                                            value={settings.invoiceFooter}
                                            onChange={(e) => setSettings({ ...settings, invoiceFooter: e.target.value })}
                                            className="input bg-bg-navy border-surface-hover text-white focus:border-primary"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Categories Section */}
                            {activeSection === "categories" && (
                                <div className="space-y-6 animate-fade-in">
                                    <div className="border-b border-border pb-4 flex items-center justify-between">
                                        <div>
                                            <h2 className="text-xl font-bold flex items-center gap-2">
                                                <FolderTree className="text-primary" size={24} />
                                                Product Categories
                                            </h2>
                                            <p className="text-muted-foreground text-sm mt-1">
                                                Define custom categories for your products
                                            </p>
                                        </div>
                                        <Button onClick={() => setShowCategoryDialog(true)}>
                                            <Plus className="w-4 h-4 mr-2" />
                                            Add Category
                                        </Button>
                                    </div>

                                    <div className="grid gap-3">
                                        {categories.length === 0 ? (
                                            <Card className="bg-muted/30 border-dashed">
                                                <CardContent className="py-12 text-center">
                                                    <FolderTree className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                                                    <p className="text-muted-foreground">No categories yet</p>
                                                    <Button
                                                        variant="outline"
                                                        className="mt-4"
                                                        onClick={() => setShowCategoryDialog(true)}
                                                    >
                                                        Add First Category
                                                    </Button>
                                                </CardContent>
                                            </Card>
                                        ) : (
                                            categories.map((cat) => (
                                                <Card key={cat.id} className="bg-card border-border">
                                                    <CardContent className="py-3 px-4 flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <FolderTree className="w-5 h-5 text-primary" />
                                                            <span className="font-medium">{cat.name}</span>
                                                            {cat.slug && (
                                                                <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                                                                    {cat.slug}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="text-destructive hover:text-destructive"
                                                            onClick={() => cat.id && handleDeleteCategory(cat.id)}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </CardContent>
                                                </Card>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Attributes Section */}
                            {activeSection === "attributes" && (
                                <div className="space-y-6 animate-fade-in">
                                    <div className="border-b border-border pb-4 flex items-center justify-between">
                                        <div>
                                            <h2 className="text-xl font-bold flex items-center gap-2">
                                                <Tags className="text-primary" size={24} />
                                                Product Attributes
                                            </h2>
                                            <p className="text-muted-foreground text-sm mt-1">
                                                Define custom fields like Material, Color, Size, etc.
                                            </p>
                                        </div>
                                        <Button onClick={() => setShowAttributeDialog(true)}>
                                            <Plus className="w-4 h-4 mr-2" />
                                            Add Attribute
                                        </Button>
                                    </div>

                                    <div className="grid gap-3">
                                        {attributes.length === 0 ? (
                                            <Card className="bg-muted/30 border-dashed">
                                                <CardContent className="py-12 text-center">
                                                    <Tags className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                                                    <p className="text-muted-foreground">No custom attributes yet</p>
                                                    <Button
                                                        variant="outline"
                                                        className="mt-4"
                                                        onClick={() => setShowAttributeDialog(true)}
                                                    >
                                                        Add First Attribute
                                                    </Button>
                                                </CardContent>
                                            </Card>
                                        ) : (
                                            attributes.map((attr) => (
                                                <Card key={attr.id} className="bg-card border-border">
                                                    <CardContent className="py-3 px-4 flex items-center justify-between">
                                                        <div className="flex items-center gap-4">
                                                            <Tags className="w-5 h-5 text-primary" />
                                                            <div>
                                                                <span className="font-medium">{attr.name}</span>
                                                                <div className="flex gap-2 mt-1">
                                                                    <span className="text-xs bg-muted px-2 py-0.5 rounded capitalize">
                                                                        {attr.attribute_type}
                                                                    </span>
                                                                    {attr.is_required && (
                                                                        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                                                                            Required
                                                                        </span>
                                                                    )}
                                                                    {attr.options && attr.options.length > 0 && (
                                                                        <span className="text-xs text-muted-foreground">
                                                                            {attr.options.length} options
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="text-destructive hover:text-destructive"
                                                            onClick={() => attr.id && handleDeleteAttribute(attr.id)}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </CardContent>
                                                </Card>
                                            ))
                                        )}
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
                                                    <button
                                                        className="btn btn-outline py-1.5 px-4 text-xs"
                                                        onClick={() => alert("Shopify Integration: Coming Soon!")}
                                                    >
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


                                    {/* PhonePe */}
                                    <div className="p-6 bg-bg-navy border border-surface-hover rounded-xl hover:border-primary/30 transition-colors">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-[#5f259f]/10 rounded-xl flex items-center justify-center text-[#5f259f] font-bold border border-[#5f259f]/20">
                                                    <CreditCard size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-white text-lg">PhonePe</h3>
                                                    <p className="text-sm text-moonstone">
                                                        Payment Gateway Integration
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {connections.phonepe ? (
                                                    <span className="badge badge-success flex items-center gap-1.5 py-1 px-3">
                                                        <CheckCircle size={14} />
                                                        Connected
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-warning flex items-center gap-1.5 py-1 px-3">
                                                        <XCircle size={14} />
                                                        Not Connected
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Merchant ID
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="MERC123"
                                                    value={settings.phonepeMerchantId}
                                                    onChange={(e) => setSettings({ ...settings, phonepeMerchantId: e.target.value })}
                                                    className="input bg-surface-navy border-surface-hover text-white focus:border-primary"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Salt Key
                                                </label>
                                                <input
                                                    type="password"
                                                    placeholder="xxxx-xxxx-xxxx"
                                                    value={settings.phonepeSaltKey}
                                                    onChange={(e) => setSettings({ ...settings, phonepeSaltKey: e.target.value })}
                                                    className="input bg-surface-navy border-surface-hover text-white focus:border-primary"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Salt Index
                                                </label>
                                                <input
                                                    type="text"
                                                    placeholder="1"
                                                    value={settings.phonepeSaltIndex}
                                                    onChange={(e) => setSettings({ ...settings, phonepeSaltIndex: e.target.value })}
                                                    className="input bg-surface-navy border-surface-hover text-white focus:border-primary"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">
                                                    Environment
                                                </label>
                                                <select
                                                    value={settings.phonepeEnv}
                                                    onChange={(e) => setSettings({ ...settings, phonepeEnv: e.target.value })}
                                                    className="input bg-surface-navy border-surface-hover text-white focus:border-primary"
                                                >
                                                    <option value="UAT">Sandbox / UAT</option>
                                                    <option value="PROD">Production</option>
                                                </select>
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
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => router.push('/whatsapp')}
                                        >
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

            {/* Add Category Dialog */}
            <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add New Category</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 mt-4">
                        <div className="space-y-2">
                            <Label>Category Name</Label>
                            <Input
                                placeholder="e.g. Electronics, Clothing, etc."
                                value={newCategory.name}
                                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Parent Category (Optional)</Label>
                            <Select
                                value={newCategory.parent_id}
                                onValueChange={(v) => v && setNewCategory({ ...newCategory, parent_id: v })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="">None (Top Level)</SelectItem>
                                    {categories.map((cat) => (
                                        <SelectItem key={cat.id} value={cat.id || ""}>
                                            {cat.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowCategoryDialog(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleAddCategory} disabled={!newCategory.name}>
                                Add Category
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Add Attribute Dialog */}
            <Dialog open={showAttributeDialog} onOpenChange={setShowAttributeDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add New Attribute</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 mt-4">
                        <div className="space-y-2">
                            <Label>Attribute Name</Label>
                            <Input
                                placeholder="e.g. Material, Color, Size"
                                value={newAttribute.name}
                                onChange={(e) => setNewAttribute({ ...newAttribute, name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <Select
                                value={newAttribute.attribute_type}
                                onValueChange={(v) => setNewAttribute({ ...newAttribute, attribute_type: v as AttributeType })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="text">Text</SelectItem>
                                    <SelectItem value="select">Select (Dropdown)</SelectItem>
                                    <SelectItem value="number">Number</SelectItem>
                                    <SelectItem value="boolean">Yes/No</SelectItem>
                                    <SelectItem value="date">Date</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {newAttribute.attribute_type === "select" && (
                            <div className="space-y-2">
                                <Label>Options (comma-separated)</Label>
                                <Input
                                    placeholder="Gold, Silver, Bronze"
                                    value={newAttribute.options}
                                    onChange={(e) => setNewAttribute({ ...newAttribute, options: e.target.value })}
                                />
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="is_required"
                                checked={newAttribute.is_required}
                                onChange={(e) => setNewAttribute({ ...newAttribute, is_required: e.target.checked })}
                                className="w-4 h-4"
                            />
                            <Label htmlFor="is_required">Required field</Label>
                        </div>
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowAttributeDialog(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleAddAttribute} disabled={!newAttribute.name}>
                                Add Attribute
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div >
    );
}


