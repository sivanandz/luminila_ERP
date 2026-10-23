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

    Loader2,
    Truck,
    Download,
    Barcode,
} from "lucide-react";
import { SKUTaxonomySettings } from "@/components/settings/SKUTaxonomySettings";
import { SalesChannelsSettings } from "@/components/settings/SalesChannelsSettings";
import { LogoUpload } from "@/components/settings/LogoUpload";
import { isUpiDiscountEnabled, setUpiDiscountEnabled } from "@/lib/channel-pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { getCategories, createCategory, deleteCategory, type Category } from "@/lib/categories";
import { getAttributes, createAttribute, deleteAttribute, type ProductAttribute, type AttributeType } from "@/lib/attributes";
import { EwayBillSettings } from "@/components/settings/EwayBillSettings";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getStoreSettings, saveStoreSettings, getDefaultStoreSettings, type StoreSettings } from "@/lib/settings";
import { pb, getPocketBaseUrl } from "@/lib/pocketbase";
import { getDetailedSessionStatus, getBusinessProfile, type DetailedSessionStatus, type BusinessProfile } from "@/lib/whatsapp";

interface SettingSection {
    id: string;
    title: string;
    icon: React.ReactNode;
}

const sections: SettingSection[] = [
    { id: "store", title: "Store Settings", icon: <Store size={20} /> },
    { id: "channels", title: "Sales Channels & Pricing", icon: <Globe size={20} /> },
    { id: "sku_taxonomies", title: "SKU Architecture", icon: <Barcode size={20} /> },
    { id: "invoice", title: "Invoice & GST", icon: <FileText size={20} /> },
    { id: "ewaybill", title: "E-way Bill", icon: <Truck size={20} /> },
    { id: "categories", title: "Categories", icon: <FolderTree size={20} /> },
    { id: "attributes", title: "Product Attributes", icon: <Tags size={20} /> },
    { id: "integrations", title: "Integrations", icon: <Database size={20} /> },
    { id: "whatsapp", title: "WhatsApp", icon: <MessageCircle size={20} /> },
    { id: "notifications", title: "Notifications", icon: <Bell size={20} /> },
    { id: "security", title: "Security", icon: <Shield size={20} /> },
];

export default function SettingsPage() {
    const router = useRouter();
    const { user } = useAuth();
    const [activeSection, setActiveSection] = useState("store");
    const [isSaving, setIsSaving] = useState(false);
    const [isExportingSnapshot, setIsExportingSnapshot] = useState(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            const tab = params.get("tab");
            if (tab && (tab === "sku_taxonomies" || tab === "sku_architecture")) {
                setActiveSection("sku_taxonomies");
            } else if (tab && (tab === "channels" || tab === "sales_channels")) {
                setActiveSection("channels");
            } else if (tab && sections.some(s => s.id === tab)) {
                setActiveSection(tab);
            }
        }
    }, []);

    // Export complete DB snapshot (InvenTree feature)
    const handleExportDatabaseSnapshot = async () => {
        setIsExportingSnapshot(true);
        try {
            toast.info("Compiling full database snapshot from PocketBase...");
            const [products, variants, customers, invoices, invoiceItems, settingsList] = await Promise.all([
                pb.collection('products').getFullList({ sort: '-created' }).catch(() => []),
                pb.collection('product_variants').getFullList().catch(() => []),
                pb.collection('customers').getFullList().catch(() => []),
                pb.collection('invoices').getFullList().catch(() => []),
                pb.collection('invoice_items').getFullList().catch(() => []),
                pb.collection('store_settings').getFullList().catch(() => []),
            ]);

            const snapshot = {
                app: "Luminila Jewelry ERP",
                version: "2.1.0",
                exported_at: new Date().toISOString(),
                exported_by: user?.email || "admin",
                summary: {
                    products_count: products.length,
                    variants_count: variants.length,
                    customers_count: customers.length,
                    invoices_count: invoices.length,
                    invoice_items_count: invoiceItems.length,
                },
                data: {
                    products,
                    product_variants: variants,
                    customers,
                    invoices,
                    invoice_items: invoiceItems,
                    store_settings: settingsList,
                }
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(snapshot, null, 2));
            const downloadAnchor = document.createElement("a");
            const filename = `luminila_database_backup_${new Date().toISOString().split("T")[0]}.json`;
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", filename);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();

            toast.success(`Exported complete snapshot with ${products.length} products & ${invoices.length} invoices!`);
        } catch (err) {
            console.error("Snapshot export failed:", err);
            toast.error("Failed to generate database snapshot: " + ((err instanceof Error ? err.message : String(err)) || "Unknown error"));
        } finally {
            setIsExportingSnapshot(false);
        }
    };

    // Unified Settings State - initialized with clean scoped defaults
    const [settings, setSettings] = useState<StoreSettings>(() =>
        getDefaultStoreSettings(user?.name, user?.email)
    );

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

    const [waStatus, setWaStatus] = useState<DetailedSessionStatus | null>(null);
    const [waBusinessProfile, setWaBusinessProfile] = useState<BusinessProfile | null>(null);
    const [checkingWa, setCheckingWa] = useState(false);
    const [isSyncingWaProfile, setIsSyncingWaProfile] = useState(false);
    const [upiDiscountPolicyEnabled, setUpiDiscountPolicyEnabled] = useState<boolean>(() => isUpiDiscountEnabled());

    useEffect(() => {
        const handler = (e: Event) => {
            const custom = e as CustomEvent<{ enabled: boolean }>;
            if (custom.detail) setUpiDiscountPolicyEnabled(custom.detail.enabled);
        };
        window.addEventListener("luminila:upi-discount-toggled", handler);
        return () => window.removeEventListener("luminila:upi-discount-toggled", handler);
    }, []);

    // Proactively poll WhatsApp status and profile on mount
    useEffect(() => {
        let cancelled = false;
        getDetailedSessionStatus().then(status => {
            if (cancelled) return;
            setWaStatus(status);
            if (status.connected) {
                getBusinessProfile().then(profile => {
                    if (!cancelled && profile) setWaBusinessProfile(profile);
                }).catch(() => {});
            }
        }).catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    // Load settings scoped to current user/store (independent of section switching
    // so unsaved edits are not overwritten, and guarded against out-of-order loads)
    useEffect(() => {
        let cancelled = false;
        getStoreSettings(user?.id, user?.name, user?.email).then(loaded => {
            if (!cancelled) setSettings(loaded);
        });
        return () => {
            cancelled = true;
        };
    }, [user?.id, user?.name, user?.email]);

    // Load per-section data when the active section changes
    useEffect(() => {
        if (activeSection === "categories") {
            getCategories().then(setCategories);
        } else if (activeSection === "attributes") {
            getAttributes().then(setAttributes);
        } else if (activeSection === "whatsapp") {
            setCheckingWa(true);
            getDetailedSessionStatus()
                .then(st => {
                    setWaStatus(st);
                    if (st.connected) return getBusinessProfile().then(p => p && setWaBusinessProfile(p));
                })
                .finally(() => setCheckingWa(false));
        }
    }, [activeSection]);

    const handleSyncFromWhatsApp = async () => {
        setIsSyncingWaProfile(true);
        try {
            const status = await getDetailedSessionStatus();
            setWaStatus(status);
            if (!status.connected) {
                toast.error("WhatsApp session is not connected.");
                return;
            }
            const profile = await getBusinessProfile();
            if (profile) setWaBusinessProfile(profile);

            const updates: Partial<StoreSettings> = {};
            if (status.connectedNumber) {
                const formatted = status.connectedNumber.startsWith("+")
                    ? status.connectedNumber
                    : `+${status.connectedNumber}`;
                updates.whatsappPhone = formatted;
            }
            if (profile?.address && profile.address.trim()) {
                updates.address = profile.address.trim();
            }
            if (Object.keys(updates).length > 0) {
                setSettings(prev => ({ ...prev, ...updates }));
                toast.success("Synced address and contact details from connected WhatsApp Business profile!");
            } else {
                toast.info("WhatsApp connected, but no business profile address was found.");
            }
        } catch (err) {
            console.error("Failed to sync from WhatsApp profile:", err);
            toast.error("Failed to sync from WhatsApp profile: " + ((err instanceof Error ? err.message : String(err)) || "Unknown error"));
        } finally {
            setIsSyncingWaProfile(false);
        }
    };

    // Connection statuses
    const connections = {
        pocketbase: true,
        shopify: false,
        woocommerce: false,
        whatsapp: false,
        phonepe: !!(settings.phonepeMerchantId && settings.phonepeSaltKey),
        razorpay: !!(settings.razorpayKeyId && settings.razorpayKeySecret),
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveStoreSettings(settings, user?.id);
            toast.success("Settings Saved Successfully");
        } catch (error) {
            console.error("Failed to save settings", error);
            toast.error("Failed to save settings");
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
                        className="min-w-[140px]"
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

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-8 scroll-smooth">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-8">
                    {/* Settings Navigation: Themed Dropdown on Mobile/Narrow, Sidebar on Desktop */}
                    <div className="lg:col-span-1">
                        {/* Mobile Dropdown */}
                        <div className="block lg:hidden w-full">
                            {(() => {
                                const curSection = sections.find((s) => s.id === activeSection) || sections[0];
                                return (
                                    <Select value={activeSection} onValueChange={(v) => v && setActiveSection(v)}>
                                        <SelectTrigger className="w-full h-11 bg-card border-border text-xs font-semibold px-3 rounded-xl flex items-center justify-between shadow-xs">
                                            <div className="flex items-center gap-2.5">
                                                <span className="text-primary">{curSection.icon}</span>
                                                <span className="font-semibold text-xs text-foreground">{curSection.title}</span>
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent className="bg-popover border-border">
                                            {sections.map((section) => (
                                                <SelectItem key={section.id} value={section.id} className="text-xs font-medium py-2.5">
                                                    <div className="flex items-center gap-2.5">
                                                        <span className="text-primary">{section.icon}</span>
                                                        <span>{section.title}</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                );
                            })()}
                        </div>

                        {/* Desktop Sidebar */}
                        <div className="hidden lg:block card sticky top-0 p-3 lg:p-4 bg-card border border-border rounded-xl">
                            <nav className="flex flex-col space-y-1">
                                {sections.map((section) => (
                                    <button
                                        key={section.id}
                                        onClick={() => setActiveSection(section.id)}
                                        className={`w-full whitespace-nowrap flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${activeSection === section.id
                                            ? "bg-primary text-primary-foreground font-bold shadow-xs"
                                            : "text-muted-foreground hover:bg-background hover:text-foreground"
                                            }`}
                                    >
                                        <span className={activeSection === section.id ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground"}>
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
                        <div className="card bg-card border border-border rounded-xl min-h-[500px] p-6">
                            {activeSection === "store" && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="border-b border-border pb-4">
                                        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                            <Store className="text-primary" size={24} />
                                            Store Settings
                                        </h2>
                                        <p className="text-muted-foreground text-sm mt-1">Manage your store details and preferences</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                Store Name
                                            </Label>
                                            <Input
                                                type="text"
                                                value={settings.storeName}
                                                onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                Currency
                                            </Label>
                                            <Select
                                                value={settings.currency}
                                                onValueChange={(val) => val && setSettings({ ...settings, currency: val })}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select currency" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="INR">₹ INR - Indian Rupee</SelectItem>
                                                    <SelectItem value="USD">$ USD - US Dollar</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                Contact Email
                                            </Label>
                                            <Input
                                                type="email"
                                                value={settings.email}
                                                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                Contact Phone
                                            </Label>
                                            <Input
                                                type="tel"
                                                placeholder="+91 98765 43210"
                                                value={settings.phone}
                                                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    WhatsApp Business Phone
                                                </Label>
                                                {waStatus?.connected && waStatus.connectedNumber && (
                                                    <button
                                                        type="button"
                                                        className="text-xs text-primary hover:underline font-semibold flex items-center gap-1"
                                                        onClick={() => {
                                                            const formatted = waStatus.connectedNumber!.startsWith("+")
                                                                ? waStatus.connectedNumber!
                                                                : `+${waStatus.connectedNumber}`;
                                                            setSettings({ ...settings, whatsappPhone: formatted });
                                                            toast.success(`Used connected WhatsApp: ${formatted}`);
                                                        }}
                                                    >
                                                        Use Connected (+{waStatus.connectedNumber})
                                                    </button>
                                                )}
                                            </div>
                                            <Input
                                                type="tel"
                                                placeholder="+91 98765 43210 (Used for invoices & messaging)"
                                                value={settings.whatsappPhone || ""}
                                                onChange={(e) => setSettings({ ...settings, whatsappPhone: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                Street Address / Shop No / Building
                                            </Label>
                                            {waStatus?.connected && (
                                                <button
                                                    type="button"
                                                    disabled={isSyncingWaProfile}
                                                    className="text-xs text-primary hover:underline font-semibold flex items-center gap-1 disabled:opacity-50"
                                                    onClick={handleSyncFromWhatsApp}
                                                >
                                                    {isSyncingWaProfile ? <Loader2 size={12} className="animate-spin" /> : <MessageCircle size={12} />}
                                                    Auto-fill from Connected WhatsApp
                                                </button>
                                            )}
                                        </div>
                                        <Textarea
                                            rows={2}
                                            placeholder="Shop No. 12, Main Bazaar Road"
                                            value={settings.address}
                                            onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                                        />
                                        {waBusinessProfile?.address && settings.address !== waBusinessProfile.address.trim() && (
                                            <div className="flex items-center justify-between text-xs bg-muted/60 p-2 rounded-md border border-border">
                                                <span className="text-muted-foreground truncate">
                                                    WhatsApp Business Profile Address: <strong className="text-foreground">{waBusinessProfile.address.trim()}</strong>
                                                </span>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-6 text-xs px-2 shrink-0 ml-2"
                                                    onClick={() => {
                                                        setSettings(prev => ({ ...prev, address: waBusinessProfile.address!.trim() }));
                                                        toast.success("Applied address from WhatsApp profile");
                                                    }}
                                                >
                                                    Apply
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                City
                                            </Label>
                                            <Input
                                                type="text"
                                                placeholder="e.g. Bengaluru, Mumbai"
                                                value={settings.city || ""}
                                                onChange={(e) => setSettings({ ...settings, city: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                State
                                            </Label>
                                            <Input
                                                type="text"
                                                placeholder="e.g. Karnataka, Maharashtra"
                                                value={settings.state || ""}
                                                onChange={(e) => setSettings({ ...settings, state: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                PIN Code
                                            </Label>
                                            <Input
                                                type="text"
                                                placeholder="e.g. 560001"
                                                value={settings.pincode || ""}
                                                onChange={(e) => setSettings({ ...settings, pincode: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold text-muted-foreground uppercase">
                                            Low Stock Threshold
                                        </Label>
                                        <Input
                                            type="number"
                                            value={settings.lowStockThreshold}
                                            onChange={(e) => setSettings({ ...settings, lowStockThreshold: parseInt(e.target.value) || 0 })}
                                            min={1}
                                            className="w-32"
                                        />
                                        <p className="text-xs text-muted-foreground italic">
                                            Alert when product stock falls below this number
                                        </p>
                                    </div>
                                </div>
                            )}

                            {activeSection === "invoice" && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="border-b border-border pb-4">
                                        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                            <FileText className="text-primary" size={24} />
                                            Invoice & GST Settings
                                        </h2>
                                        <p className="text-muted-foreground text-sm mt-1">Configure invoice appearance and GST details</p>
                                    </div>

                                    {/* Company Logo */}
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold text-muted-foreground uppercase">
                                            Company Logo
                                        </Label>
                                        <LogoUpload
                                            currentLogo={settings.companyLogo || undefined}
                                            onLogoChange={(logo) => setSettings({ ...settings, companyLogo: logo })}
                                        />
                                        <p className="text-xs text-muted-foreground italic">
                                            Appears on invoices and receipts
                                        </p>
                                    </div>

                                    {/* Print Mode */}
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold text-muted-foreground uppercase">
                                            Default Print Mode
                                        </Label>
                                        <Select
                                            value={settings.defaultPrintMode}
                                            onValueChange={(val) => val && setSettings({ ...settings, defaultPrintMode: val })}
                                        >
                                            <SelectTrigger className="w-48">
                                                <SelectValue placeholder="Select print mode" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="regular">A4 (Regular)</SelectItem>
                                                <SelectItem value="thermal58">Thermal 58mm</SelectItem>
                                                <SelectItem value="thermal80">Thermal 80mm</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground italic">
                                            Select your preferred invoice print format
                                        </p>
                                    </div>
                                     {/* GST Registration Status */}
                                    <div className="p-4 rounded-xl border border-border bg-muted/40 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <Label htmlFor="gst-registered-toggle" className="text-sm font-bold text-foreground cursor-pointer">
                                                        GST Registered Business
                                                    </Label>
                                                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${settings.isGstRegistered !== false ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-600 border border-amber-500/20'}`}>
                                                        {settings.isGstRegistered !== false ? "Active • Standard GST Invoices" : "Turned Off • Bill of Supply (0% GST)"}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-muted-foreground">
                                                    {settings.isGstRegistered !== false
                                                        ? "Your store collects GST and generates standard Tax Invoices with GSTIN."
                                                        : "Unregistered or Composition Dealer: No GSTIN required. Invoices will automatically be issued as 'Bill of Supply' with 0% tax."}
                                                </p>
                                            </div>
                                            <Switch
                                                id="gst-registered-toggle"
                                                checked={settings.isGstRegistered !== false}
                                                onCheckedChange={(checked) => setSettings({ ...settings, isGstRegistered: checked })}
                                            />
                                        </div>
                                    </div>

                                    {/* GST Details */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    GSTIN
                                                </Label>
                                                {settings.isGstRegistered === false && (
                                                    <span className="text-[10px] text-amber-500 font-medium">Not Applicable (Unregistered)</span>
                                                )}
                                            </div>
                                            <Input
                                                type="text"
                                                placeholder={settings.isGstRegistered === false ? "Not Applicable (Unregistered Business)" : "22AAAAA0000A1Z5"}
                                                maxLength={15}
                                                disabled={settings.isGstRegistered === false}
                                                value={settings.gstin || ""}
                                                onChange={(e) => setSettings({ ...settings, gstin: e.target.value })}
                                                className={`uppercase ${settings.isGstRegistered === false ? "opacity-60 bg-muted cursor-not-allowed" : ""}`}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                PAN
                                            </Label>
                                            <Input
                                                type="text"
                                                placeholder="AAAAA0000A"
                                                maxLength={10}
                                                value={settings.pan}
                                                onChange={(e) => setSettings({ ...settings, pan: e.target.value })}
                                                className="uppercase"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                State Code
                                            </Label>
                                            <Input
                                                type="text"
                                                placeholder="27 (Maharashtra)"
                                                maxLength={2}
                                                value={settings.stateCode}
                                                onChange={(e) => setSettings({ ...settings, stateCode: e.target.value })}
                                                className="w-32"
                                            />
                                        </div>
                                    </div>

                                    {/* Bank Details */}
                                    <div className="border-t border-border pt-6">
                                        <h3 className="text-sm font-bold text-foreground mb-4">Bank Details (for invoices)</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Bank Name
                                                </Label>
                                                <Input
                                                    type="text"
                                                    placeholder="State Bank of India"
                                                    value={settings.bankName}
                                                    onChange={(e) => setSettings({ ...settings, bankName: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Account Number
                                                </Label>
                                                <Input
                                                    type="text"
                                                    placeholder="1234567890"
                                                    value={settings.accountNumber}
                                                    onChange={(e) => setSettings({ ...settings, accountNumber: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    IFSC Code
                                                </Label>
                                                <Input
                                                    type="text"
                                                    placeholder="SBIN0001234"
                                                    value={settings.ifsc}
                                                    onChange={(e) => setSettings({ ...settings, ifsc: e.target.value })}
                                                    className="uppercase"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Branch
                                                </Label>
                                                <Input
                                                    type="text"
                                                    placeholder="Mumbai Main"
                                                    value={settings.branch}
                                                    onChange={(e) => setSettings({ ...settings, branch: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Invoice Footer */}
                                    <div className="space-y-2">
                                        <Label className="text-xs font-bold text-muted-foreground uppercase">
                                            Invoice Footer Text
                                        </Label>
                                        <Textarea
                                            rows={2}
                                            value={settings.invoiceFooter}
                                            onChange={(e) => setSettings({ ...settings, invoiceFooter: e.target.value })}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* E-way Bill Section */}
                            {activeSection === "ewaybill" && (
                                <div className="animate-fade-in">
                                    <EwayBillSettings />
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
                                    <div className="border-b border-border pb-4">
                                        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                            <Database className="text-primary" size={24} />
                                            Integrations
                                        </h2>
                                        <p className="text-muted-foreground text-sm mt-1">Connect with external services and platforms</p>
                                    </div>

                                    {/* PocketBase */}
                                    <div className="p-6 bg-background border border-border rounded-xl hover:border-primary/30 transition-colors">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500 font-bold border border-emerald-500/20">
                                                    <Database size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-foreground text-lg">PocketBase</h3>
                                                    <p className="text-sm text-muted-foreground">
                                                        Database & Authentication Backend
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {connections.pocketbase ? (
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
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Server URL
                                                </Label>
                                                <Input
                                                    type="text"
                                                    placeholder="http://127.0.0.1:8090"
                                                    readOnly
                                                    value={getPocketBaseUrl()}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Admin Panel
                                                </Label>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => window.open(getPocketBaseUrl() + "/_/", "_blank")}
                                                >
                                                    <ExternalLink size={14} className="mr-1" />
                                                    Open Admin UI
                                                </Button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* PhonePe */}
                                    <div className="p-6 bg-background border border-border rounded-xl hover:border-primary/30 transition-colors">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-[#5f259f]/10 rounded-xl flex items-center justify-center text-[#5f259f] font-bold border border-[#5f259f]/20">
                                                    <CreditCard size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-foreground text-lg">PhonePe</h3>
                                                    <p className="text-sm text-muted-foreground">
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
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Merchant ID
                                                </Label>
                                                <Input
                                                    type="text"
                                                    placeholder="MERC123"
                                                    value={settings.phonepeMerchantId}
                                                    onChange={(e) => setSettings({ ...settings, phonepeMerchantId: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Salt Key
                                                </Label>
                                                <Input
                                                    type="password"
                                                    placeholder="xxxx-xxxx-xxxx"
                                                    value={settings.phonepeSaltKey}
                                                    onChange={(e) => setSettings({ ...settings, phonepeSaltKey: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Salt Index
                                                </Label>
                                                <Input
                                                    type="text"
                                                    placeholder="1"
                                                    value={settings.phonepeSaltIndex}
                                                    onChange={(e) => setSettings({ ...settings, phonepeSaltIndex: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Environment
                                                </Label>
                                                <Select
                                                    value={settings.phonepeEnv}
                                                    onValueChange={(val) => val && setSettings({ ...settings, phonepeEnv: val })}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select environment" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="UAT">Sandbox / UAT</SelectItem>
                                                        <SelectItem value="PROD">Production</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Razorpay */}
                                    <div className="card p-6 border border-border space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-blue-600/10 flex items-center justify-center text-blue-600 font-bold text-lg">
                                                    ₹
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-foreground text-lg">Razorpay</h3>
                                                    <p className="text-sm text-muted-foreground">
                                                        WhatsApp Payment Links & In-Chat Settlement
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {connections.razorpay ? (
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
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Key ID
                                                </Label>
                                                <Input
                                                    type="text"
                                                    placeholder="rzp_test_..."
                                                    value={settings.razorpayKeyId}
                                                    onChange={(e) => setSettings({ ...settings, razorpayKeyId: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Key Secret
                                                </Label>
                                                <Input
                                                    type="password"
                                                    placeholder="••••••••••••••••"
                                                    value={settings.razorpayKeySecret}
                                                    onChange={(e) => setSettings({ ...settings, razorpayKeySecret: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Webhook Secret
                                                </Label>
                                                <Input
                                                    type="password"
                                                    placeholder="Optional HMAC secret"
                                                    value={settings.razorpayWebhookSecret}
                                                    onChange={(e) => setSettings({ ...settings, razorpayWebhookSecret: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    Environment Mode
                                                </Label>
                                                <Select
                                                    value={settings.razorpayEnv}
                                                    onValueChange={(val) => val && setSettings({ ...settings, razorpayEnv: val })}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select environment" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="TEST">Test / Sandbox Mode</SelectItem>
                                                        <SelectItem value="PROD">Live Production Mode</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {/* UPI < ₹2,000 Surcharge Discount Policy Setting */}
                                            <div className="col-span-2 pt-3 border-t border-border/60">
                                                <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border">
                                                    <div className="space-y-0.5">
                                                        <Label className="text-sm font-semibold flex items-center gap-1.5 text-foreground cursor-pointer">
                                                            <span>⚡ UPI &lt; ₹2,000 Zero-MDR Surcharge Discount</span>
                                                        </Label>
                                                        <p className="text-xs text-muted-foreground">
                                                            Automatically waive/discount 2.2% merchant surcharge for UPI transactions under ₹2,000 during checkout (RBI/NPCI zero-MDR rule).
                                                        </p>
                                                    </div>
                                                    <input
                                                        type="checkbox"
                                                        checked={upiDiscountPolicyEnabled}
                                                        onChange={(e) => {
                                                            const val = e.target.checked;
                                                            setUpiDiscountPolicyEnabled(val);
                                                            setUpiDiscountEnabled(val);
                                                            toast.success(val ? "UPI < ₹2,000 surcharge discount enabled" : "UPI < ₹2,000 surcharge discount disabled");
                                                        }}
                                                        className="w-5 h-5 rounded text-primary focus:ring-primary accent-primary cursor-pointer"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Database Snapshot & Backup (InvenTree feature) */}
                                    <div className="p-6 bg-background border border-border rounded-xl hover:border-primary/30 transition-colors">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-400 font-bold border border-amber-500/20">
                                                    <Database size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-foreground text-lg">Database Backup & Snapshot</h3>
                                                    <p className="text-sm text-muted-foreground">
                                                        One-click JSON snapshot of inventory, customers, invoices, and settings
                                                    </p>
                                                </div>
                                            </div>
                                            <Button
                                                onClick={handleExportDatabaseSnapshot}
                                                disabled={isExportingSnapshot}
                                                className="bg-gold hover:bg-gold-light text-navy-dark font-semibold text-xs flex items-center gap-2"
                                            >
                                                {isExportingSnapshot ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Download className="w-4 h-4" />
                                                )}
                                                Download Snapshot
                                            </Button>
                                        </div>
                                        <div className="p-3 bg-surface-navy/60 rounded-lg text-xs text-moonstone border border-surface-hover flex items-center justify-between">
                                            <span>Format: JSON Full Dump (PocketBase compatible)</span>
                                            <span className="text-emerald-400 font-semibold">● Isolated Tenant PocketBase Live ({getPocketBaseUrl().replace(/^https?:\/\//, "")})</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeSection === "whatsapp" && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="border-b border-border pb-4">
                                        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                            <MessageCircle className="text-primary" size={24} />
                                            WhatsApp Automation & Store Binding
                                        </h2>
                                        <p className="text-muted-foreground text-sm mt-1">Configure your official store WhatsApp number and sidecar connectivity</p>
                                    </div>

                                    {/* Live Status Card */}
                                    <div className="p-6 bg-background border border-border rounded-xl">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${waStatus?.connected ? 'bg-[#25D366]/10 text-[#25D366] border-[#25D366]/30' : 'bg-amber-500/10 text-amber-500 border-amber-500/30'}`}>
                                                    <MessageCircle size={24} />
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-foreground text-base">WhatsApp Web Sidecar</h3>
                                                    <p className="text-xs text-muted-foreground">Session: luminila (port 21465)</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {checkingWa ? (
                                                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking...
                                                    </span>
                                                ) : waStatus?.connected ? (
                                                    <span className="badge badge-success flex items-center gap-1.5 py-1 px-3 text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded-md">
                                                        <CheckCircle size={14} />
                                                        Connected & Ready
                                                    </span>
                                                ) : (
                                                    <span className="badge badge-warning flex items-center gap-1.5 py-1 px-3 text-xs font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded-md">
                                                        <XCircle size={14} />
                                                        Disconnected
                                                    </span>
                                                )}
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => router.push('/whatsapp')}
                                                >
                                                    <ExternalLink size={14} className="mr-1" />
                                                    WhatsApp Dashboard
                                                </Button>
                                            </div>
                                        </div>

                                        {waStatus?.connected && (
                                            <div className="mt-4 p-3 bg-muted/40 rounded-lg border border-border/60 text-xs space-y-1">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-muted-foreground">Bound Account Profile:</span>
                                                    <span className="font-semibold text-foreground">{waStatus.pushname || "WhatsApp Business"}</span>
                                                </div>
                                                {waStatus.connectedNumber && (
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-muted-foreground">Active Phone Number:</span>
                                                        <span className="font-mono font-bold text-foreground">+{waStatus.connectedNumber}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Store WhatsApp Business Number Field */}
                                    <div className="p-6 bg-background border border-border rounded-xl space-y-4">
                                        <div>
                                            <h3 className="font-bold text-foreground text-base">Store WhatsApp Business Number</h3>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                This number is printed on customer receipts/invoices and used to contact your store.
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold text-muted-foreground uppercase">
                                                    WhatsApp Phone (with Country Code)
                                                </Label>
                                                <Input
                                                    type="tel"
                                                    placeholder="e.g. +91 98765 43210"
                                                    value={settings.whatsappPhone || ""}
                                                    onChange={(e) => setSettings({ ...settings, whatsappPhone: e.target.value })}
                                                />
                                            </div>

                                            {waStatus?.connected && waStatus.connectedNumber && (
                                                <div>
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        className="w-full text-xs font-semibold"
                                                        onClick={() => {
                                                            const formatted = waStatus.connectedNumber!.startsWith('+') 
                                                                ? waStatus.connectedNumber! 
                                                                : `+${waStatus.connectedNumber}`;
                                                            setSettings({ ...settings, whatsappPhone: formatted });
                                                            toast.success(`Populated store WhatsApp number: ${formatted}`);
                                                        }}
                                                    >
                                                        Use Connected Account (+{waStatus.connectedNumber})
                                                    </Button>
                                                </div>
                                            )}
                                        </div>

                                        <p className="text-xs text-muted-foreground italic">
                                            Tip: Save changes at the top right to persist this to your store profile and all invoices.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {activeSection === "notifications" && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="border-b border-border pb-4">
                                        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                                            <Bell className="text-primary" size={24} />
                                            Notifications
                                        </h2>
                                        <p className="text-muted-foreground text-sm mt-1">Control system alerts and triggers</p>
                                    </div>

                                    <div className="space-y-4">
                                        {[
                                            { key: "lowStock", label: "Low Stock Alerts", desc: "When product stock falls below threshold" },
                                            { key: "newOrder", label: "New Order", desc: "When a new online order is received" },
                                            { key: "syncError", label: "Sync Errors", desc: "When synchronization with external services fails" },
                                        ].map((item) => (
                                            <div key={item.key} className="flex items-center justify-between p-4 bg-background border border-border rounded-xl">
                                                <div>
                                                    <p className="font-bold text-foreground text-sm">{item.label}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                                                </div>
                                                <Switch defaultChecked />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {activeSection === "channels" && (
                                <div className="animate-fade-in">
                                    <SalesChannelsSettings />
                                </div>
                            )}

                            {activeSection === "sku_taxonomies" && (
                                <div className="animate-fade-in">
                                    <SKUTaxonomySettings />
                                </div>
                            )}

                            {/* Save Button */}
                            {activeSection !== "sku_taxonomies" && activeSection !== "channels" && (
                                <div className="mt-8 pt-6 border-t border-border flex justify-end">
                                    <Button
                                        onClick={handleSave}
                                        disabled={isSaving}
                                    >
                                        <Save className="mr-2 h-4 w-4" />
                                        {isSaving ? "Saving..." : "Save Changes"}
                                    </Button>
                                </div>
                            )}
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
                            <Switch
                                id="is_required"
                                checked={newAttribute.is_required}
                                onCheckedChange={(checked) => setNewAttribute({ ...newAttribute, is_required: checked })}
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


