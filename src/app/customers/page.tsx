"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
    Users,
    Plus,
    Search,
    Crown,
    Building2,
    User,
    Phone,
    Mail,
    Sparkles,
    Send,
    BarChart3,
    Calendar,
    Zap,
    TrendingUp,
    CheckCircle2,
    AlertCircle,
    Eye,
    MessageCircle,
    Percent,
    ShoppingBag,
    Tag,
    Clock,
    RefreshCw,
    Loader2,
    Flame,
    ArrowUpRight,
    ExternalLink,
    Filter,
    Layers,
    DollarSign,
    Check,
    X,
    HeartHandshake,
    Pencil,
    Edit3,
    SlidersHorizontal,
    CheckSquare,
    Square,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import {
    getCustomers,
    createCustomer,
    getCustomerStats,
    type Customer,
    type CustomerType,
} from "@/lib/customers";
import { formatINR } from "@/lib/gst";
import {
    computeRFMAnalysis,
    type RFMCustomer,
    type CohortSummary,
    type RFMSegmentId,
} from "@/lib/crm-rfm";
import {
    getCampaignAnalyticsOverview,
    createMarketingCampaign,
    type MarketingCampaign,
    type CampaignAnalyticsOverview,
    type CampaignCategory,
} from "@/lib/campaign-attribution";
import {
    getLifecycleConfigs,
    updateLifecycleConfig,
    scanAndDispatchLifecycleTriggers,
    getEligibleRecipientsForFlow,
    dispatchCustomRecipientsMessages,
    type LifecycleFlowConfig,
    type LifecycleFlowId,
    type EligibleRecipient,
} from "@/lib/crm-lifecycle-triggers";
import { queueCampaign } from "@/lib/whatsapp-broadcast";

const typeConfig: Record<CustomerType, { label: string; icon: typeof User; color: string }> = {
    retail: { label: "Retail", icon: User, color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    wholesale: { label: "Wholesale", icon: Building2, color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    vip: { label: "VIP", icon: Crown, color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
};

const leadStatusConfig: Record<string, { label: string; class: string }> = {
    new_lead: { label: "New Lead", class: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    contacted: { label: "Contacted", class: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
    quoted: { label: "Quoted", class: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    awaiting_payment: { label: "Awaiting Pay", class: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
    won: { label: "Client Won", class: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    vip: { label: "VIP Patron", class: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
};

const CRM_TABS: { value: "directory" | "rfm" | "campaigns" | "lifecycle"; label: string; icon: any; iconColor?: string }[] = [
    { value: "directory", label: "Customer Directory", icon: Users },
    { value: "rfm", label: "RFM Segments", icon: Layers },
    { value: "campaigns", label: "Campaign Analytics", icon: BarChart3 },
    { value: "lifecycle", label: "Auto-Triggers", icon: Sparkles, iconColor: "text-amber-500" },
];

export default function CustomersPage() {
    const router = useRouter();

    // Active View Tab
    const [activeTab, setActiveTab] = useState<"directory" | "rfm" | "campaigns" | "lifecycle">("directory");

    // General Customer State
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [stats, setStats] = useState<Awaited<ReturnType<typeof getCustomerStats>> | null>(null);

    // RFM Segmentation State
    const [rfmData, setRfmData] = useState<{ customers: RFMCustomer[]; cohorts: Record<RFMSegmentId, CohortSummary> } | null>(null);
    const [selectedCohort, setSelectedCohort] = useState<RFMSegmentId>("all");
    const [rfmLoading, setRfmLoading] = useState(false);

    // Campaigns & Analytics State
    const [campaignAnalytics, setCampaignAnalytics] = useState<CampaignAnalyticsOverview | null>(null);
    const [showNewCampaignDialog, setShowNewCampaignDialog] = useState(false);
    const [newCampaignForm, setNewCampaignForm] = useState({
        title: "",
        category: "promotional" as CampaignCategory,
        promo_code: "",
        discount_percent: 10,
        target_segment: "all_active",
        template: "Hello {{customer_name}}, ✨ Luminila Jewels is pleased to present our new collection with an exclusive {{promo_code}} voucher!",
    });
    const [creatingCampaign, setCreatingCampaign] = useState(false);

    // Lifecycle Automated Flows State
    const [lifecycleConfigs, setLifecycleConfigs] = useState<LifecycleFlowConfig[]>([]);
    const [scanningLifecycle, setScanningLifecycle] = useState(false);
    const [previewFlow, setPreviewFlow] = useState<LifecycleFlowId | null>(null);
    const [previewRecipients, setPreviewRecipients] = useState<EligibleRecipient[]>([]);
    const [loadingPreview, setLoadingPreview] = useState(false);

    // Flow Template Editing State
    const [editingFlow, setEditingFlow] = useState<LifecycleFlowConfig | null>(null);
    const [editFlowForm, setEditFlowForm] = useState({
        template: "",
        promoCode: "",
        triggerDaysOffset: 3,
        enabled: true,
    });

    // Preview Recipient Customization State
    const [recipientMessages, setRecipientMessages] = useState<Record<string, string>>({});
    const [selectedRecipients, setSelectedRecipients] = useState<Record<string, boolean>>({});
    const [dispatchingRecipients, setDispatchingRecipients] = useState(false);

    // Global Scan Review Modal State
    const [showScanReviewModal, setShowScanReviewModal] = useState(false);
    const [allScanRecipients, setAllScanRecipients] = useState<{ flowId: LifecycleFlowId; flowName: string; recipient: EligibleRecipient }[]>([]);
    const [scanMessages, setScanMessages] = useState<Record<string, string>>({});
    const [scanSelected, setScanSelected] = useState<Record<string, boolean>>({});
    const [dispatchingScan, setDispatchingScan] = useState(false);

    // Quick Add Customer Dialog
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [formData, setFormData] = useState({
        name: "",
        phone: "",
        email: "",
        customer_type: "retail" as CustomerType,
        ring_size: "",
        bangle_size: "",
        preferred_metal: "Rose Gold",
        date_of_birth: "",
        anniversary: "",
    });
    const [savingCustomer, setSavingCustomer] = useState(false);

    // Fetch initial customer data
    const fetchData = async () => {
        setLoading(true);
        try {
            const [customersData, statsData] = await Promise.all([
                getCustomers({
                    type: typeFilter !== "all" ? (typeFilter as CustomerType) : undefined,
                }),
                getCustomerStats(),
            ]);
            setCustomers(customersData);
            setStats(statsData);
        } catch (err) {
            console.error("Failed to load customer directory:", err);
            toast.error("Failed to load customers");
        } finally {
            setLoading(false);
        }
    };

    // Load RFM Analysis
    const loadRFM = async () => {
        setRfmLoading(true);
        try {
            const result = await computeRFMAnalysis(customers);
            setRfmData(result);
        } catch (err) {
            console.error("RFM computation error:", err);
        } finally {
            setRfmLoading(false);
        }
    };

    // Load Campaign Analytics
    const loadCampaignAnalytics = async () => {
        try {
            const data = await getCampaignAnalyticsOverview();
            setCampaignAnalytics(data);
        } catch (err) {
            console.error("Campaign analytics error:", err);
        }
    };

    // Load Lifecycle Flows
    const loadLifecycle = () => {
        const configs = getLifecycleConfigs();
        setLifecycleConfigs(configs);
    };

    useEffect(() => {
        fetchData();
        loadLifecycle();
    }, [typeFilter]);

    useEffect(() => {
        if (activeTab === "rfm" && !rfmData) {
            loadRFM();
        } else if (activeTab === "campaigns") {
            loadCampaignAnalytics();
        } else if (activeTab === "lifecycle") {
            loadLifecycle();
        }
    }, [activeTab, customers]);

    // Filtered customer list for Directory tab
    const filteredCustomers = useMemo(() => {
        return customers.filter((c) => {
            if (!searchQuery) return true;
            const query = searchQuery.toLowerCase();
            return (
                c.name?.toLowerCase().includes(query) ||
                c.phone?.includes(query) ||
                c.email?.toLowerCase().includes(query) ||
                (c as any).ring_size?.toLowerCase().includes(query) ||
                (c as any).preferred_metal?.toLowerCase().includes(query)
            );
        });
    }, [customers, searchQuery]);

    // Handle Quick Add Customer
    const handleAddCustomer = async () => {
        if (!formData.name) {
            toast.error("Name is required");
            return;
        }
        setSavingCustomer(true);
        try {
            await createCustomer(formData as any);
            toast.success("Customer created successfully");
            setShowAddDialog(false);
            setFormData({
                name: "",
                phone: "",
                email: "",
                customer_type: "retail",
                ring_size: "",
                bangle_size: "",
                preferred_metal: "Rose Gold",
                date_of_birth: "",
                anniversary: "",
            });
            fetchData();
        } catch (err) {
            toast.error("Failed to create customer: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setSavingCustomer(false);
        }
    };

    // Handle Launch Campaign from Cohort
    const handleLaunchCohortCampaign = (cohortId: RFMSegmentId) => {
        setNewCampaignForm({
            ...newCampaignForm,
            target_segment: cohortId === "champions" ? "vip_tiers" : cohortId === "at_risk" ? "all_active" : "all_active",
            title: `Campaign: ${cohortId.toUpperCase()} Concierge Drop`,
            promo_code: cohortId === "champions" ? "VIPLUX" : cohortId === "celebrations" ? "CELEBRATE" : "GOLD2024",
        });
        setActiveTab("campaigns");
        setShowNewCampaignDialog(true);
    };

    // Handle Submit New Campaign
    const handleCreateCampaignSubmit = async () => {
        if (!newCampaignForm.title || !newCampaignForm.template) {
            toast.error("Campaign title and template are required");
            return;
        }

        setCreatingCampaign(true);
        try {
            // 1. Create campaign record
            const created = await createMarketingCampaign({
                title: newCampaignForm.title,
                category: newCampaignForm.category,
                promo_code: newCampaignForm.promo_code || undefined,
                discount_percent: newCampaignForm.discount_percent,
                target_segment: newCampaignForm.target_segment,
                status: "active",
                total_recipients: 0,
            });

            // 2. Queue into WhatsApp broadcast engine
            const queueRes = await queueCampaign({
                campaign: created.title,
                template: `${newCampaignForm.template}${newCampaignForm.promo_code ? `\n\nUse Code: *${newCampaignForm.promo_code}* for ${newCampaignForm.discount_percent}% off.` : ""}`,
                segment: (newCampaignForm.target_segment as any) || "all_active",
            });

            toast.success(`Campaign "${created.title}" launched! ${queueRes.queued} messages queued with anti-ban jitter.`);
            setShowNewCampaignDialog(false);
            await loadCampaignAnalytics();
        } catch (err) {
            toast.error("Campaign creation failed: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setCreatingCampaign(false);
        }
    };

    // Handle Toggle Lifecycle Flow
    const handleToggleFlow = (flowId: LifecycleFlowId, currentVal: boolean) => {
        const updated = updateLifecycleConfig(flowId, { enabled: !currentVal });
        setLifecycleConfigs(updated);
        toast.success(`Automated flow "${flowId}" ${!currentVal ? "enabled" : "paused"}`);
    };

    // Handle Open Edit Flow Template
    const handleOpenEditFlow = (flow: LifecycleFlowConfig) => {
        setEditingFlow(flow);
        setEditFlowForm({
            template: flow.template,
            promoCode: flow.promoCode,
            triggerDaysOffset: flow.triggerDaysOffset,
            enabled: flow.enabled,
        });
    };

    // Handle Save Edit Flow Template
    const handleSaveEditFlow = () => {
        if (!editingFlow) return;
        if (!editFlowForm.template.trim()) {
            toast.error("Template cannot be empty");
            return;
        }
        const updated = updateLifecycleConfig(editingFlow.id, {
            template: editFlowForm.template.trim(),
            promoCode: editFlowForm.promoCode.trim(),
            triggerDaysOffset: Number(editFlowForm.triggerDaysOffset) || 1,
            enabled: editFlowForm.enabled,
        });
        setLifecycleConfigs(updated);
        setEditingFlow(null);
        toast.success(`Updated message template for "${editingFlow.name}"`);
    };

    // Handle Trigger Preview with Recipient Customization
    const handleOpenFlowPreview = async (flowId: LifecycleFlowId) => {
        setPreviewFlow(flowId);
        setLoadingPreview(true);
        try {
            const list = await getEligibleRecipientsForFlow(flowId);
            setPreviewRecipients(list);
            const msgMap: Record<string, string> = {};
            const selMap: Record<string, boolean> = {};
            list.forEach((r) => {
                msgMap[r.customer.id] = r.personalizedMessage;
                selMap[r.customer.id] = true;
            });
            setRecipientMessages(msgMap);
            setSelectedRecipients(selMap);
        } catch (err) {
            toast.error("Failed to preview recipients: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setLoadingPreview(false);
        }
    };

    // Handle Dispatch Reviewed Recipients
    const handleDispatchReviewedRecipients = async () => {
        if (!previewFlow) return;
        const toSend = previewRecipients
            .filter((r) => selectedRecipients[r.customer.id])
            .map((r) => ({
                customerId: r.customer.id,
                phone: r.phone,
                message: recipientMessages[r.customer.id] || r.personalizedMessage,
            }));

        if (toSend.length === 0) {
            toast.error("Please select at least one customer to dispatch");
            return;
        }

        setDispatchingRecipients(true);
        try {
            const res = await dispatchCustomRecipientsMessages(previewFlow, toSend);
            toast.success(`Queued ${res.queuedCount} reviewed personalized message(s) with anti-ban jitter.`);
            setPreviewFlow(null);
            loadLifecycle();
        } catch (err) {
            toast.error("Failed to dispatch: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setDispatchingRecipients(false);
        }
    };

    // Handle Scan & Review All Active Flows for Today
    const handleScanAndReviewToday = async () => {
        setScanningLifecycle(true);
        try {
            const enabledFlows = lifecycleConfigs.filter((f) => f.enabled);
            const aggregated: { flowId: LifecycleFlowId; flowName: string; recipient: EligibleRecipient }[] = [];
            const msgMap: Record<string, string> = {};
            const selMap: Record<string, boolean> = {};

            for (const flow of enabledFlows) {
                const recipients = await getEligibleRecipientsForFlow(flow.id);
                for (const r of recipients) {
                    const key = `${flow.id}_${r.customer.id}`;
                    aggregated.push({ flowId: flow.id, flowName: flow.name, recipient: r });
                    msgMap[key] = r.personalizedMessage;
                    selMap[key] = true;
                }
            }

            if (aggregated.length === 0) {
                toast.info("No customers due for milestone triggers today across all active flows.");
                return;
            }

            setAllScanRecipients(aggregated);
            setScanMessages(msgMap);
            setScanSelected(selMap);
            setShowScanReviewModal(true);
        } catch (err) {
            toast.error("Scan failed: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setScanningLifecycle(false);
        }
    };

    // Handle Dispatch All Reviewed Scan Recipients
    const handleDispatchScanRecipients = async () => {
        const approved = allScanRecipients.filter((item) => scanSelected[`${item.flowId}_${item.recipient.customer.id}`]);
        if (approved.length === 0) {
            toast.error("Please select at least one recipient to dispatch");
            return;
        }

        setDispatchingScan(true);
        try {
            let totalQueued = 0;
            // Group by flow
            const byFlow: Record<string, { customerId: string; phone: string; message: string }[]> = {};
            approved.forEach((item) => {
                const key = `${item.flowId}_${item.recipient.customer.id}`;
                if (!byFlow[item.flowId]) byFlow[item.flowId] = [];
                byFlow[item.flowId].push({
                    customerId: item.recipient.customer.id,
                    phone: item.recipient.phone,
                    message: scanMessages[key] || item.recipient.personalizedMessage,
                });
            });

            for (const [fId, recs] of Object.entries(byFlow)) {
                const res = await dispatchCustomRecipientsMessages(fId as LifecycleFlowId, recs);
                totalQueued += res.queuedCount;
            }

            toast.success(`Dispatched ${totalQueued} reviewed milestone messages with humanized anti-ban jitter.`);
            setShowScanReviewModal(false);
            loadLifecycle();
        } catch (err) {
            toast.error("Dispatch failed: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setDispatchingScan(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-background">
            <Header
                title="Customer CRM & Campaign Suite"
                subtitle="360° jewelry profiles, RFM behavioral cohorts, and revenue-attributed WhatsApp campaigns"
                action={
                    <div className="flex items-center gap-2">
                        {activeTab === "campaigns" && (
                            <Button
                                size="sm"
                                onClick={() => setShowNewCampaignDialog(true)}
                                className="h-9 gap-1.5 font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                            >
                                <Zap className="w-3.5 h-3.5 fill-current" /> New WhatsApp Campaign
                            </Button>
                        )}
                        {activeTab === "lifecycle" && (
                            <Button
                                size="sm"
                                onClick={handleScanAndReviewToday}
                                disabled={scanningLifecycle}
                                className="h-9 gap-1.5 font-bold text-xs bg-primary text-primary-foreground shadow-sm"
                            >
                                {scanningLifecycle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                                Review &amp; Dispatch Auto-Triggers
                            </Button>
                        )}
                        <Button
                            size="sm"
                            onClick={() => setShowAddDialog(true)}
                            className="h-9 gap-1.5 text-xs font-semibold"
                        >
                            <Plus className="w-4 h-4" /> Add Customer
                        </Button>
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                {/* Master Navigation: Dropdown on narrow screens, Pill Tabs on desktop */}
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                    {/* Mobile / Narrow Viewport: Themed Dropdown Selector */}
                    <div className="block sm:hidden w-full">
                        {(() => {
                            const curTab = CRM_TABS.find((t) => t.value === activeTab) || CRM_TABS[0];
                            const CurIcon = curTab.icon;
                            return (
                                <Select value={activeTab} onValueChange={(v) => v && setActiveTab(v as any)}>
                                    <SelectTrigger className="w-full h-10 bg-card border-border text-xs font-semibold px-3 rounded-xl flex items-center justify-between shadow-xs">
                                        <div className="flex items-center gap-2">
                                            <CurIcon className={cn("w-4 h-4", curTab.iconColor || "text-primary")} />
                                            <span className="font-semibold text-xs text-foreground">{curTab.label}</span>
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="bg-popover border-border">
                                        {CRM_TABS.map((tab) => {
                                            const TabIcon = tab.icon;
                                            return (
                                                <SelectItem key={tab.value} value={tab.value} className="text-xs font-medium py-2">
                                                    <div className="flex items-center gap-2">
                                                        <TabIcon className={cn("w-3.5 h-3.5", tab.iconColor || "text-primary")} />
                                                        <span>{tab.label}</span>
                                                    </div>
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                            );
                        })()}
                    </div>

                    {/* Tablet / Desktop: Sleek Pill Tabs */}
                    <div className="hidden sm:inline-flex">
                        <TabsList className="inline-flex h-9 items-center justify-start gap-1 rounded-xl bg-muted/50 p-1 border border-border w-auto">
                            {CRM_TABS.map((tab) => {
                                const TabIcon = tab.icon;
                                return (
                                    <TabsTrigger
                                        key={tab.value}
                                        value={tab.value}
                                        className="h-7 px-3 text-xs font-semibold gap-1.5 shrink-0 data-active:bg-background data-active:shadow-sm"
                                    >
                                        <TabIcon className={cn("w-3.5 h-3.5", tab.iconColor)} /> {tab.label}
                                    </TabsTrigger>
                                );
                            })}
                        </TabsList>
                    </div>

                    {/* ============================================================== */}
                    {/* TAB 1: CUSTOMER DIRECTORY & 360° PROFILE */}
                    {/* ============================================================== */}
                    <TabsContent value="directory" className="space-y-6 mt-4">
                        {/* Stats Strip */}
                        {stats && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                <Card className="bg-card border-border shadow-sm">
                                    <CardContent className="p-4 flex items-center justify-between">
                                        <div>
                                            <span className="text-xs text-muted-foreground">Total Customers</span>
                                            <p className="text-2xl font-bold mt-0.5">{stats.totalCustomers}</p>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                                            <Users className="w-5 h-5" />
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="bg-card border-border shadow-sm">
                                    <CardContent className="p-4 flex items-center justify-between">
                                        <div>
                                            <span className="text-xs text-muted-foreground">VIP Patrons</span>
                                            <p className="text-2xl font-bold text-amber-500 mt-0.5">{stats.byType?.vip || 0}</p>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                                            <Crown className="w-5 h-5" />
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="bg-card border-border shadow-sm">
                                    <CardContent className="p-4 flex items-center justify-between">
                                        <div>
                                            <span className="text-xs text-muted-foreground">Wholesale Partners</span>
                                            <p className="text-2xl font-bold text-emerald-500 mt-0.5">{stats.byType?.wholesale || 0}</p>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500">
                                            <Building2 className="w-5 h-5" />
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="bg-card border-border shadow-sm">
                                    <CardContent className="p-4 flex items-center justify-between">
                                        <div>
                                            <span className="text-xs text-muted-foreground">Total CRM Spending</span>
                                            <p className="text-2xl font-bold text-primary mt-0.5">
                                                {formatINR(customers.reduce((acc, c) => acc + (c.total_spent || 0), 0))}
                                            </p>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                                            <DollarSign className="w-5 h-5" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {/* Search & Filter Toolbar */}
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border shadow-sm">
                            <div className="relative flex-1 min-w-[260px]">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    placeholder="Search by name, phone, email, ring size, or metal..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 h-9 text-xs bg-background"
                                />
                                {searchQuery && (
                                    <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v || "all")}>
                                    <SelectTrigger className="h-9 w-36 text-xs bg-background">
                                        <SelectValue placeholder="Customer Tier" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Tiers</SelectItem>
                                        <SelectItem value="retail">Retail</SelectItem>
                                        <SelectItem value="wholesale">Wholesale</SelectItem>
                                        <SelectItem value="vip">VIP</SelectItem>
                                    </SelectContent>
                                </Select>

                                <Button size="icon" variant="ghost" onClick={fetchData} className="h-9 w-9 text-muted-foreground" title="Refresh">
                                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                                </Button>
                            </div>
                        </div>

                        {/* Customers Directory Table */}
                        <div className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border">
                                        <tr>
                                            <th className="py-3 px-4">Customer & Contact</th>
                                            <th className="py-3 px-4">Tier & Lead Status</th>
                                            <th className="py-3 px-4">Jewelry Specs</th>
                                            <th className="py-3 px-4">Orders & Lifetime Spend</th>
                                            <th className="py-3 px-4">Milestones</th>
                                            <th className="py-3 px-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {loading ? (
                                            <tr>
                                                <td colSpan={6} className="py-12 text-center text-muted-foreground">
                                                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                                                    Loading customer directory...
                                                </td>
                                            </tr>
                                        ) : filteredCustomers.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-12 text-center text-muted-foreground">
                                                    No customers found matching the active search.
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredCustomers.map((c) => {
                                                const typeInfo = typeConfig[c.customer_type] || typeConfig.retail;
                                                const TypeIcon = typeInfo.icon;
                                                const leadStatus = (c as any).lead_status || "new_lead";
                                                const leadInfo = leadStatusConfig[leadStatus] || leadStatusConfig.new_lead;

                                                return (
                                                    <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                                                        <td className="py-3.5 px-4">
                                                            <div className="font-bold text-foreground text-sm flex items-center gap-2">
                                                                {c.name}
                                                            </div>
                                                            <div className="flex items-center gap-3 text-muted-foreground mt-0.5 text-[11px]">
                                                                {c.phone && <span className="flex items-center gap-1 font-mono"><Phone className="w-3 h-3" /> {c.phone}</span>}
                                                                {c.email && <span className="flex items-center gap-1 truncate max-w-[150px]"><Mail className="w-3 h-3" /> {c.email}</span>}
                                                            </div>
                                                        </td>

                                                        <td className="py-3.5 px-4">
                                                            <div className="flex flex-col gap-1 items-start">
                                                                <Badge variant="outline" className={`text-[10px] gap-1 font-semibold ${typeInfo.color}`}>
                                                                    <TypeIcon className="w-3 h-3" /> {typeInfo.label}
                                                                </Badge>
                                                                <Badge variant="outline" className={`text-[9px] ${leadInfo.class}`}>
                                                                    {leadInfo.label}
                                                                </Badge>
                                                            </div>
                                                        </td>

                                                        <td className="py-3.5 px-4 text-[11px] text-muted-foreground">
                                                            {((c as any).ring_size || (c as any).preferred_metal || (c as any).bangle_size) ? (
                                                                <div className="space-y-0.5">
                                                                    {(c as any).ring_size && <div>Ring: <span className="font-semibold text-foreground">{(c as any).ring_size}</span></div>}
                                                                    {(c as any).bangle_size && <div>Bangle: <span className="font-semibold text-foreground">{(c as any).bangle_size}</span></div>}
                                                                    {(c as any).preferred_metal && <div className="text-primary font-medium">{(c as any).preferred_metal}</div>}
                                                                </div>
                                                            ) : (
                                                                <span className="italic text-muted-foreground/60">Not specified</span>
                                                            )}
                                                        </td>

                                                        <td className="py-3.5 px-4">
                                                            <div className="font-bold text-foreground text-sm">
                                                                {formatINR(c.total_spent || 0)}
                                                            </div>
                                                            <div className="text-[11px] text-muted-foreground">
                                                                {c.total_orders || 0} orders • {c.loyalty_points || 0} pts
                                                            </div>
                                                        </td>

                                                        <td className="py-3.5 px-4 text-[11px]">
                                                            {(c.date_of_birth || (c as any).birthday_date || c.anniversary || (c as any).anniversary_date) ? (
                                                                <div className="space-y-0.5 text-muted-foreground">
                                                                    {(c.date_of_birth || (c as any).birthday_date) && (
                                                                        <div className="flex items-center gap-1">
                                                                            🎂 <span className="text-foreground">{(c.date_of_birth || (c as any).birthday_date)?.slice(5)}</span>
                                                                        </div>
                                                                    )}
                                                                    {(c.anniversary || (c as any).anniversary_date) && (
                                                                        <div className="flex items-center gap-1">
                                                                            💍 <span className="text-foreground">{(c.anniversary || (c as any).anniversary_date)?.slice(5)}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-muted-foreground/50 text-[10px]">No dates</span>
                                                            )}
                                                        </td>

                                                        <td className="py-3.5 px-4 text-right">
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                {c.phone && (
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => router.push(`/whatsapp?chatId=${encodeURIComponent(c.phone!)}`)}
                                                                        className="h-7 px-2 text-[11px] gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 font-semibold"
                                                                        title="Open WhatsApp Chat"
                                                                    >
                                                                        <MessageCircle className="w-3.5 h-3.5" /> Chat
                                                                    </Button>
                                                                )}
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => router.push(`/customers/detail?id=${c.id}`)}
                                                                    className="h-7 px-2 text-[11px] font-medium"
                                                                >
                                                                    Profile <ArrowUpRight className="w-3 h-3 ml-0.5" />
                                                                </Button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </TabsContent>

                    {/* ============================================================== */}
                    {/* TAB 2: RFM CUSTOMER SEGMENTS & BEHAVIORAL COHORTS */}
                    {/* ============================================================== */}
                    <TabsContent value="rfm" className="space-y-6 mt-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-bold text-foreground">Dynamic RFM Customer Segmentation</h3>
                                <p className="text-xs text-muted-foreground">
                                    Behavioral cohorts calculated from purchase recency, order frequency, and lifetime monetary spend.
                                </p>
                            </div>
                            <Button size="sm" variant="outline" onClick={loadRFM} disabled={rfmLoading} className="h-8 gap-1.5 text-xs">
                                <RefreshCw className={`w-3.5 h-3.5 ${rfmLoading ? "animate-spin" : ""}`} /> Refresh Analysis
                            </Button>
                        </div>

                        {rfmData && (
                            <>
                                {/* Cohort Cards Grid */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                    {(Object.keys(rfmData.cohorts) as RFMSegmentId[]).filter((k) => k !== "all").map((cohortId) => {
                                        const c = rfmData.cohorts[cohortId];
                                        const isSelected = selectedCohort === cohortId;
                                        return (
                                            <div
                                                key={cohortId}
                                                onClick={() => setSelectedCohort(cohortId)}
                                                className={`p-4 rounded-xl border transition-all cursor-pointer bg-card flex flex-col justify-between ${
                                                    isSelected ? "ring-2 ring-primary border-primary shadow-md" : "hover:border-primary/50 border-border"
                                                }`}
                                            >
                                                <div>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <Badge variant="outline" className={`text-[10px] font-semibold ${c.badgeClass}`}>
                                                            {c.label}
                                                        </Badge>
                                                        <span className="text-lg font-bold text-foreground">{c.count}</span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>
                                                </div>

                                                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[11px]">
                                                    <span className="text-muted-foreground font-mono">LTV: {formatINR(c.totalLTV)}</span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleLaunchCohortCampaign(cohortId);
                                                        }}
                                                        className="text-primary hover:underline font-bold flex items-center gap-0.5 text-[11px]"
                                                    >
                                                        <Zap className="w-3 h-3 fill-current" /> Campaign
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Active Cohort Member List */}
                                <div className="border border-border rounded-xl bg-card p-4 space-y-4 shadow-sm">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                                                <span>Cohort Members: {rfmData.cohorts[selectedCohort].label}</span>
                                                <Badge variant="secondary" className="text-xs">
                                                    {rfmData.customers.filter((c) => selectedCohort === "all" || c.segment === selectedCohort).length} customers
                                                </Badge>
                                            </h4>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                Recommended strategy: <span className="font-semibold text-foreground">{rfmData.cohorts[selectedCohort].suggestedAction}</span>
                                            </p>
                                        </div>

                                        <Button
                                            size="sm"
                                            onClick={() => handleLaunchCohortCampaign(selectedCohort)}
                                            className="h-8 gap-1.5 text-xs font-bold bg-primary text-primary-foreground shadow-sm"
                                        >
                                            <Send className="w-3.5 h-3.5" /> Broadcast to This Cohort
                                        </Button>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] border-b border-border">
                                                <tr>
                                                    <th className="py-2.5 px-3">Customer</th>
                                                    <th className="py-2.5 px-3">Phone</th>
                                                    <th className="py-2.5 px-3">Recency</th>
                                                    <th className="py-2.5 px-3">Orders</th>
                                                    <th className="py-2.5 px-3">Total Spend</th>
                                                    <th className="py-2.5 px-3">Milestone Alert</th>
                                                    <th className="py-2.5 px-3 text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {rfmData.customers
                                                    .filter((c) => selectedCohort === "all" || c.segment === selectedCohort)
                                                    .map((member) => (
                                                        <tr key={member.id} className="hover:bg-muted/20">
                                                            <td className="py-2.5 px-3 font-semibold text-foreground">{member.name}</td>
                                                            <td className="py-2.5 px-3 font-mono text-muted-foreground">{member.phone || "—"}</td>
                                                            <td className="py-2.5 px-3">
                                                                <span className={member.recencyDays > 60 ? "text-amber-500 font-semibold" : "text-muted-foreground"}>
                                                                    {member.recencyDays === 999 ? "Never" : `${member.recencyDays}d ago`}
                                                                </span>
                                                            </td>
                                                            <td className="py-2.5 px-3">{member.frequency}</td>
                                                            <td className="py-2.5 px-3 font-bold text-foreground">{formatINR(member.monetary)}</td>
                                                            <td className="py-2.5 px-3">
                                                                {member.hasUpcomingBirthday && (
                                                                    <Badge className="bg-pink-500/10 text-pink-500 border-pink-500/30 text-[9px]">
                                                                        Birthday in {member.daysToBirthday}d
                                                                    </Badge>
                                                                )}
                                                                {member.hasUpcomingAnniversary && (
                                                                    <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/30 text-[9px]">
                                                                        Anniversary in {member.daysToAnniversary}d
                                                                    </Badge>
                                                                )}
                                                            </td>
                                                            <td className="py-2.5 px-3 text-right">
                                                                {member.phone && (
                                                                    <button
                                                                        onClick={() => router.push(`/whatsapp?chatId=${encodeURIComponent(member.phone!)}`)}
                                                                        className="text-emerald-600 dark:text-emerald-400 hover:underline font-bold text-[11px]"
                                                                    >
                                                                        Message
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </>
                        )}
                    </TabsContent>

                    {/* ============================================================== */}
                    {/* TAB 3: WHATSAPP CAMPAIGNS & REVENUE ATTRIBUTION ANALYTICS */}
                    {/* ============================================================== */}
                    <TabsContent value="campaigns" className="space-y-6 mt-4">
                        {campaignAnalytics && (
                            <>
                                {/* KPI Metric Cards */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <Card className="bg-card border-border shadow-sm">
                                        <CardContent className="p-4">
                                            <span className="text-xs text-muted-foreground">Total Attributed Revenue</span>
                                            <p className="text-2xl font-bold text-emerald-500 mt-0.5">{formatINR(campaignAnalytics.totalRevenue)}</p>
                                            <span className="text-[10px] text-muted-foreground mt-1 block">7-day rolling window &amp; promo codes</span>
                                        </CardContent>
                                    </Card>

                                    <Card className="bg-card border-border shadow-sm">
                                        <CardContent className="p-4">
                                            <span className="text-xs text-muted-foreground">Orders Converted</span>
                                            <p className="text-2xl font-bold text-foreground mt-0.5">{campaignAnalytics.totalOrders}</p>
                                            <span className="text-[10px] text-emerald-500 font-semibold mt-1 block">
                                                {campaignAnalytics.overallConversionRate}% conversion rate
                                            </span>
                                        </CardContent>
                                    </Card>

                                    <Card className="bg-card border-border shadow-sm">
                                        <CardContent className="p-4">
                                            <span className="text-xs text-muted-foreground">Read Engagement</span>
                                            <p className="text-2xl font-bold text-foreground mt-0.5">{campaignAnalytics.overallReadRate}%</p>
                                            <span className="text-[10px] text-muted-foreground mt-1 block">{campaignAnalytics.totalRead} of {campaignAnalytics.totalDelivered} read</span>
                                        </CardContent>
                                    </Card>

                                    <Card className="bg-card border-border shadow-sm">
                                        <CardContent className="p-4">
                                            <span className="text-xs text-muted-foreground">Active Campaigns</span>
                                            <p className="text-2xl font-bold text-primary mt-0.5">{campaignAnalytics.activeCampaigns}</p>
                                            <span className="text-[10px] text-muted-foreground mt-1 block">{campaignAnalytics.totalCampaigns} all-time campaigns</span>
                                        </CardContent>
                                    </Card>
                                </div>

                                {/* Conversion Funnel Visualization */}
                                <Card className="bg-card border-border shadow-sm">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-sm font-bold flex items-center justify-between">
                                            <span>WhatsApp Campaign Conversion Funnel</span>
                                            <span className="text-xs text-muted-foreground font-normal">Tracking full recipient journey from dispatch to revenue</span>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                                            {campaignAnalytics.funnel.map((stage, i) => (
                                                <div key={stage.label} className="p-3 rounded-xl bg-muted/30 border border-border flex flex-col justify-between">
                                                    <div>
                                                        <span className="text-[11px] font-semibold text-muted-foreground block">{stage.label}</span>
                                                        <p className="text-xl font-bold text-foreground mt-1">{stage.count}</p>
                                                    </div>
                                                    <div className="mt-3">
                                                        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                                                            <div className={`h-full ${stage.color}`} style={{ width: `${Math.max(5, stage.percentage)}%` }} />
                                                        </div>
                                                        <span className="text-[10px] font-bold text-muted-foreground mt-1 block">{stage.percentage}%</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Campaign Performance Table */}
                                <div className="border border-border rounded-xl bg-card p-4 space-y-4 shadow-sm">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-bold text-sm text-foreground">Marketing Campaigns &amp; Attributed Sales</h4>
                                        <Button
                                            size="sm"
                                            onClick={() => setShowNewCampaignDialog(true)}
                                            className="h-8 gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                                        >
                                            <Plus className="w-3.5 h-3.5" /> Create Campaign
                                        </Button>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] border-b border-border">
                                                <tr>
                                                    <th className="py-2.5 px-3">Campaign</th>
                                                    <th className="py-2.5 px-3">Promo Code</th>
                                                    <th className="py-2.5 px-3">Recipients</th>
                                                    <th className="py-2.5 px-3">Delivery &amp; Read</th>
                                                    <th className="py-2.5 px-3">Orders Converted</th>
                                                    <th className="py-2.5 px-3">Attributed Revenue</th>
                                                    <th className="py-2.5 px-3 text-right">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {campaignAnalytics.campaigns.map((cmp) => {
                                                    const readRate = cmp.delivered_count > 0 ? Math.round((cmp.read_count / cmp.delivered_count) * 100) : 0;
                                                    const convRate = cmp.sent_count > 0 ? Math.round((cmp.orders_converted / cmp.sent_count) * 100 * 10) / 10 : 0;
                                                    return (
                                                        <tr key={cmp.id} className="hover:bg-muted/20">
                                                            <td className="py-3 px-3">
                                                                <span className="font-bold text-foreground text-sm block">{cmp.title}</span>
                                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{cmp.category.replace("_", " ")}</span>
                                                            </td>
                                                            <td className="py-3 px-3">
                                                                {cmp.promo_code ? (
                                                                    <Badge variant="outline" className="font-mono text-[10px] bg-primary/10 text-primary border-primary/20">
                                                                        {cmp.promo_code} ({cmp.discount_percent}% OFF)
                                                                    </Badge>
                                                                ) : (
                                                                    <span className="text-muted-foreground">—</span>
                                                                )}
                                                            </td>
                                                            <td className="py-3 px-3 font-semibold text-foreground">{cmp.total_recipients || cmp.sent_count}</td>
                                                            <td className="py-3 px-3">
                                                                <div className="text-[11px] font-semibold text-foreground">
                                                                    {cmp.delivered_count} delivered ({readRate}% read)
                                                                </div>
                                                                <span className="text-[10px] text-muted-foreground">{cmp.replied_count} replies</span>
                                                            </td>
                                                            <td className="py-3 px-3">
                                                                <div className="font-bold text-foreground">{cmp.orders_converted} orders</div>
                                                                <span className="text-[10px] text-emerald-500 font-semibold">{convRate}% conv rate</span>
                                                            </td>
                                                            <td className="py-3 px-3 font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                                                                {formatINR(cmp.attributed_revenue)}
                                                            </td>
                                                            <td className="py-3 px-3 text-right">
                                                                <Badge
                                                                    variant="outline"
                                                                    className={`text-[10px] font-semibold ${
                                                                        cmp.status === "active"
                                                                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                                                                            : "bg-muted text-muted-foreground"
                                                                    }`}
                                                                >
                                                                    {cmp.status.toUpperCase()}
                                                                </Badge>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </>
                        )}
                    </TabsContent>

                    {/* ============================================================== */}
                    {/* TAB 4: AUTOMATED MILESTONE & LIFECYCLE TRIGGERS */}
                    {/* ============================================================== */}
                    <TabsContent value="lifecycle" className="space-y-6 mt-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-amber-500" /> Automated Lifecycle &amp; Milestone Triggers
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    Autonomous campaigns that scan customer dates daily and dispatch personalized vouchers via the anti-ban queue.
                                </p>
                            </div>

                            <Button
                                size="sm"
                                onClick={handleScanAndReviewToday}
                                disabled={scanningLifecycle}
                                className="h-8 gap-1.5 text-xs font-bold bg-primary text-primary-foreground shadow-sm"
                            >
                                {scanningLifecycle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                                Review &amp; Dispatch Eligible Today
                            </Button>
                        </div>

                        {/* Lifecycle Flow Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {lifecycleConfigs.map((flow) => (
                                <Card key={flow.id} className="bg-card border-border shadow-sm flex flex-col justify-between">
                                    <CardHeader className="pb-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <CardTitle className="text-sm font-bold flex items-center gap-2">
                                                    {flow.id === "birthday_reward" && "🎂"}
                                                    {flow.id === "anniversary_gift" && "💍"}
                                                    {flow.id === "lapsed_vip_winback" && "👑"}
                                                    {flow.id === "post_delivery_review" && "🌟"}
                                                    {flow.name}
                                                </CardTitle>
                                                <p className="text-xs text-muted-foreground mt-1">{flow.description}</p>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    checked={flow.enabled}
                                                    onCheckedChange={() => handleToggleFlow(flow.id, flow.enabled)}
                                                />
                                            </div>
                                        </div>
                                    </CardHeader>

                                    <CardContent className="space-y-4 pt-0">
                                        <div className="p-3 rounded-lg bg-muted/40 border border-border text-xs space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] text-muted-foreground block font-bold uppercase tracking-wider">
                                                    Active Message Template
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleOpenEditFlow(flow)}
                                                    className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-1"
                                                >
                                                    <Pencil className="w-3 h-3" /> Edit
                                                </button>
                                            </div>
                                            <p className="italic text-foreground">{flow.template}</p>
                                        </div>

                                        <div className="flex items-center justify-between text-xs pt-2 border-t border-border">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="font-mono text-[10px]">
                                                    Code: {flow.promoCode}
                                                </Badge>
                                                <span className="text-muted-foreground text-[11px]">{flow.totalSentCount} sent</span>
                                            </div>

                                            <div className="flex items-center gap-1.5">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleOpenEditFlow(flow)}
                                                    className="h-7 text-xs gap-1 border-border font-semibold text-foreground hover:bg-muted"
                                                >
                                                    <Pencil className="w-3 h-3 text-primary" /> Edit
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => handleOpenFlowPreview(flow.id)}
                                                    className="h-7 text-xs gap-1 text-primary hover:underline font-semibold"
                                                >
                                                    <Eye className="w-3.5 h-3.5" /> Preview &amp; Dispatch
                                                </Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </TabsContent>
                </Tabs>
            </div>

            {/* ============================================================== */}
            {/* DIALOG: CREATE NEW CAMPAIGN (WITH EDITABLE TEMPLATES & PREVIEW) */}
            {/* ============================================================== */}
            <Dialog open={showNewCampaignDialog} onOpenChange={setShowNewCampaignDialog}>
                <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Zap className="w-5 h-5 text-emerald-500" /> Launch WhatsApp Marketing Campaign
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Broadcast targeted messages with anti-ban humanized staggered dispatch (8-22s intervals) and 7-day revenue attribution.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Campaign Title</Label>
                            <Input
                                value={newCampaignForm.title}
                                onChange={(e) => setNewCampaignForm({ ...newCampaignForm, title: e.target.value })}
                                placeholder="e.g. Akshaya Tritiya Gold Pre-Booking"
                                className="h-9 text-xs"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Campaign Category</Label>
                                <Select
                                    value={newCampaignForm.category}
                                    onValueChange={(v: any) => setNewCampaignForm({ ...newCampaignForm, category: v })}
                                >
                                    <SelectTrigger className="h-9 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="promotional">Promotional</SelectItem>
                                        <SelectItem value="flash_drop">Flash Drop</SelectItem>
                                        <SelectItem value="vip_concierge">VIP Concierge</SelectItem>
                                        <SelectItem value="clearance">Clearance</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Target Audience Cohort</Label>
                                <Select
                                    value={newCampaignForm.target_segment}
                                    onValueChange={(v) => setNewCampaignForm({ ...newCampaignForm, target_segment: v || "all_active" })}
                                >
                                    <SelectTrigger className="h-9 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all_active">All Active Opted-In</SelectItem>
                                        <SelectItem value="vip_tiers">VIP Champions Only</SelectItem>
                                        <SelectItem value="wholesale">Wholesale Merchants</SelectItem>
                                        <SelectItem value="points_over_500">Loyalty Points &gt; 500</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Promo Code (For Attribution)</Label>
                                <Input
                                    value={newCampaignForm.promo_code}
                                    onChange={(e) => setNewCampaignForm({ ...newCampaignForm, promo_code: e.target.value.toUpperCase() })}
                                    placeholder="GOLD10"
                                    className="h-9 text-xs font-mono font-bold"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Discount Percent (%)</Label>
                                <Input
                                    type="number"
                                    value={newCampaignForm.discount_percent}
                                    onChange={(e) => setNewCampaignForm({ ...newCampaignForm, discount_percent: Number(e.target.value) })}
                                    className="h-9 text-xs font-semibold"
                                />
                            </div>
                        </div>

                        {/* Template Presets */}
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Template Presets (Click to load &amp; customize)</Label>
                            <div className="grid grid-cols-2 gap-1.5">
                                {[
                                    { label: "✨ Festive Drop", text: "Dear {{customer_name}}, ✨ Luminila Jewels is pleased to present our new collection with an exclusive {{promo_code}} voucher!" },
                                    { label: "💎 VIP Salon", text: "Namaste {{first_name}}, as a cherished VIP patron, you are invited to a private jewelry styling salon with exclusive access to handcrafted heirloom sets." },
                                    { label: "🏮 Pre-Booking", text: "Exclusive Festive Pre-Booking open at Luminila! Lock in today's gold rate with zero making charges for the first 50 bookings." },
                                    { label: "👑 Milestone Offer", text: "Hi {{first_name}}! ⭐ Celebrate with Luminila Jewels. Use code {{promo_code}} to get {{discount_percent}}% off your special celebration purchase." },
                                ].map((p) => (
                                    <button
                                        key={p.label}
                                        type="button"
                                        onClick={() => setNewCampaignForm({ ...newCampaignForm, template: p.text })}
                                        className="p-2 text-left rounded-md border border-border bg-muted/40 hover:bg-muted text-[11px] font-medium text-foreground transition-colors"
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Message Template Textarea & Tag Inserters */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs font-semibold">Editable Message Template</Label>
                                <div className="flex items-center gap-1">
                                    {["{{customer_name}}", "{{first_name}}", "{{promo_code}}", "{{discount_percent}}"].map((tag) => (
                                        <button
                                            key={tag}
                                            type="button"
                                            onClick={() => setNewCampaignForm({ ...newCampaignForm, template: `${newCampaignForm.template} ${tag}` })}
                                            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted border border-border text-primary hover:bg-primary/10 transition-colors"
                                        >
                                            + {tag.replace(/[{}]/g, "")}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <Textarea
                                rows={4}
                                value={newCampaignForm.template}
                                onChange={(e) => setNewCampaignForm({ ...newCampaignForm, template: e.target.value })}
                                className="text-xs leading-relaxed font-sans bg-background"
                                placeholder="Edit your personalized campaign message..."
                            />
                        </div>

                        {/* Live Rendered WhatsApp Message Preview */}
                        <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs space-y-1">
                            <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block flex items-center gap-1">
                                <Eye className="w-3 h-3" /> Live Rendered WhatsApp Bubble (Sample: Priya Sharma):
                            </span>
                            <div className="p-2.5 rounded-md bg-card border border-border text-[11px] text-foreground leading-relaxed whitespace-pre-wrap shadow-sm font-sans">
                                {newCampaignForm.template
                                    .replace(/\{\{customer_name\}\}/gi, "Priya Sharma")
                                    .replace(/\{\{first_name\}\}/gi, "Priya")
                                    .replace(/\{\{promo_code\}\}/gi, newCampaignForm.promo_code || "PROMO")
                                    .replace(/\{\{discount_percent\}\}/gi, String(newCampaignForm.discount_percent || 10))}
                                {newCampaignForm.promo_code ? `\n\nUse Code: *${newCampaignForm.promo_code}* for ${newCampaignForm.discount_percent}% off.` : ""}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                        <Button variant="outline" size="sm" onClick={() => setShowNewCampaignDialog(false)} className="h-8 text-xs">
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleCreateCampaignSubmit}
                            disabled={creatingCampaign}
                            className="h-8 gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                            {creatingCampaign ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            Queue &amp; Dispatch Campaign
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ============================================================== */}
            {/* DIALOG: EDIT FLOW TEMPLATE */}
            {/* ============================================================== */}
            <Dialog open={!!editingFlow} onOpenChange={(open) => !open && setEditingFlow(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="w-5 h-5 text-primary" /> Edit Milestone Message Template
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Customize the automated trigger copy, voucher code, and timing for &ldquo;{editingFlow?.name}&rdquo;.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Voucher Promo Code</Label>
                                <Input
                                    value={editFlowForm.promoCode}
                                    onChange={(e) => setEditFlowForm({ ...editFlowForm, promoCode: e.target.value.toUpperCase() })}
                                    placeholder="BDAY1000"
                                    className="h-9 text-xs font-mono font-bold"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Trigger Offset (Days)</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={365}
                                    value={editFlowForm.triggerDaysOffset}
                                    onChange={(e) => setEditFlowForm({ ...editFlowForm, triggerDaysOffset: Number(e.target.value) })}
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs font-semibold">Message Copy Template</Label>
                                <span className="text-[10px] text-muted-foreground font-mono">Insert tags below:</span>
                            </div>
                            <div className="flex flex-wrap gap-1 mb-1">
                                {["{{customer_name}}", "{{first_name}}", "{{promo_code}}", "{{loyalty_points}}"].map((tag) => (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => setEditFlowForm((prev) => ({ ...prev, template: `${prev.template} ${tag}` }))}
                                        className="px-2 py-0.5 rounded text-[10px] font-mono bg-muted border border-border text-primary hover:bg-primary/10 transition-colors"
                                    >
                                        + {tag}
                                    </button>
                                ))}
                            </div>
                            <Textarea
                                rows={4}
                                value={editFlowForm.template}
                                onChange={(e) => setEditFlowForm({ ...editFlowForm, template: e.target.value })}
                                className="text-xs font-sans leading-relaxed resize-none bg-background"
                                placeholder="Enter customized template message..."
                            />
                        </div>

                        {/* Live WhatsApp Sample Preview */}
                        <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 text-xs space-y-1.5">
                            <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                                <Eye className="w-3.5 h-3.5" /> Sample Customer Live Preview (Priya Sharma):
                            </div>
                            <div className="p-2.5 rounded-md bg-card/90 border border-border text-[11px] text-foreground leading-relaxed shadow-sm font-sans">
                                {editFlowForm.template
                                    .replace(/\{\{customer_name\}\}/gi, "Priya Sharma")
                                    .replace(/\{\{first_name\}\}/gi, "Priya")
                                    .replace(/\{\{promo_code\}\}/gi, editFlowForm.promoCode || "PROMO")
                                    .replace(/\{\{loyalty_points\}\}/gi, "350")}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                        <Button variant="outline" size="sm" onClick={() => setEditingFlow(null)} className="h-8 text-xs">
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleSaveEditFlow}
                            className="h-8 gap-1.5 text-xs font-bold bg-primary text-primary-foreground"
                        >
                            <Check className="w-3.5 h-3.5" /> Save Template
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ============================================================== */}
            {/* DIALOG: PREVIEW & CUSTOMIZE LIFECYCLE RECIPIENTS */}
            {/* ============================================================== */}
            <Dialog open={!!previewFlow} onOpenChange={(open) => !open && setPreviewFlow(null)}>
                <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <div className="flex items-center justify-between gap-2 pr-6">
                            <DialogTitle className="flex items-center gap-2">
                                <Eye className="w-5 h-5 text-primary" /> Lifecycle Trigger Recipients &amp; Message Review
                            </DialogTitle>
                            {previewFlow && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        const flow = lifecycleConfigs.find((f) => f.id === previewFlow);
                                        if (flow) {
                                            setPreviewFlow(null);
                                            handleOpenEditFlow(flow);
                                        }
                                    }}
                                    className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
                                >
                                    <Pencil className="w-3 h-3" /> Edit Base Template
                                </Button>
                            )}
                        </div>
                        <DialogDescription className="text-xs">
                            Review and customize each customer&apos;s personalized message below before dispatching into the anti-ban queue.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto py-2 space-y-3">
                        {loadingPreview ? (
                            <div className="p-8 text-center text-muted-foreground">
                                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                                Evaluating eligible customers...
                            </div>
                        ) : previewRecipients.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground text-xs">
                                No customers currently due for this trigger today.
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                                    <span>{previewRecipients.length} customer(s) due today</span>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const allTrue: Record<string, boolean> = {};
                                                previewRecipients.forEach((r) => { allTrue[r.customer.id] = true; });
                                                setSelectedRecipients(allTrue);
                                            }}
                                            className="text-primary hover:underline text-[11px] font-medium"
                                        >
                                            Select All
                                        </button>
                                        <span>•</span>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedRecipients({})}
                                            className="text-muted-foreground hover:underline text-[11px] font-medium"
                                        >
                                            Deselect All
                                        </button>
                                    </div>
                                </div>

                                {previewRecipients.map((r) => {
                                    const isChecked = !!selectedRecipients[r.customer.id];
                                    const msg = recipientMessages[r.customer.id] ?? r.personalizedMessage;
                                    return (
                                        <div
                                            key={r.customer.id}
                                            className={cn(
                                                "p-3 rounded-lg border transition-colors space-y-2 text-xs",
                                                isChecked ? "bg-card border-border" : "bg-muted/20 border-border/50 opacity-60"
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={(e) => setSelectedRecipients({ ...selectedRecipients, [r.customer.id]: e.target.checked })}
                                                        className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                                                    />
                                                    <div>
                                                        <span className="font-bold text-foreground text-sm">{r.customer.name}</span>
                                                        <span className="text-[11px] font-mono text-muted-foreground ml-2">{r.phone}</span>
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                                                    {r.reason}
                                                </Badge>
                                            </div>

                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                                    <span className="font-semibold text-foreground flex items-center gap-1">
                                                        <Edit3 className="w-3 h-3 text-emerald-500" /> Personalized Message Copy (Editable):
                                                    </span>
                                                    {msg !== r.personalizedMessage && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setRecipientMessages({ ...recipientMessages, [r.customer.id]: r.personalizedMessage })}
                                                            className="text-primary hover:underline text-[10px]"
                                                        >
                                                            Reset to original
                                                        </button>
                                                    )}
                                                </div>
                                                <Textarea
                                                    rows={3}
                                                    value={msg}
                                                    onChange={(e) => setRecipientMessages({ ...recipientMessages, [r.customer.id]: e.target.value })}
                                                    className="text-xs font-sans leading-relaxed bg-background"
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </>
                        )}
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-border">
                        <span className="text-xs text-muted-foreground">
                            {Object.values(selectedRecipients).filter(Boolean).length} of {previewRecipients.length} selected for dispatch
                        </span>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPreviewFlow(null)} className="h-8 text-xs">
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleDispatchReviewedRecipients}
                                disabled={dispatchingRecipients || Object.values(selectedRecipients).filter(Boolean).length === 0}
                                className="h-8 gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                                {dispatchingRecipients ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                Dispatch to Selected ({Object.values(selectedRecipients).filter(Boolean).length})
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ============================================================== */}
            {/* DIALOG: GLOBAL MILESTONE SCAN REVIEW & DISPATCH */}
            {/* ============================================================== */}
            <Dialog open={showScanReviewModal} onOpenChange={setShowScanReviewModal}>
                <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-amber-500" /> Milestone Triggers Review &amp; Dispatch
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            The following customers qualify for automated lifecycle milestone messages today. Review and customize their messages before dispatching into the anti-ban queue.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto py-2 space-y-3">
                        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                            <span>{allScanRecipients.length} customer(s) due today across active flows</span>
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const allTrue: Record<string, boolean> = {};
                                        allScanRecipients.forEach((item) => {
                                            allTrue[`${item.flowId}_${item.recipient.customer.id}`] = true;
                                        });
                                        setScanSelected(allTrue);
                                    }}
                                    className="text-primary hover:underline text-[11px] font-medium"
                                >
                                    Select All
                                </button>
                                <span>•</span>
                                <button
                                    type="button"
                                    onClick={() => setScanSelected({})}
                                    className="text-muted-foreground hover:underline text-[11px] font-medium"
                                >
                                    Deselect All
                                </button>
                            </div>
                        </div>

                        {allScanRecipients.map((item) => {
                            const key = `${item.flowId}_${item.recipient.customer.id}`;
                            const isChecked = !!scanSelected[key];
                            const msg = scanMessages[key] ?? item.recipient.personalizedMessage;

                            return (
                                <div
                                    key={key}
                                    className={cn(
                                        "p-3 rounded-lg border transition-colors space-y-2 text-xs",
                                        isChecked ? "bg-card border-border" : "bg-muted/20 border-border/50 opacity-60"
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(e) => setScanSelected({ ...scanSelected, [key]: e.target.checked })}
                                                className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                                            />
                                            <div>
                                                <span className="font-bold text-foreground text-sm">{item.recipient.customer.name}</span>
                                                <span className="text-[11px] font-mono text-muted-foreground ml-2">{item.recipient.phone}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <Badge variant="secondary" className="text-[10px]">
                                                {item.flowName}
                                            </Badge>
                                            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                                                {item.recipient.reason}
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                            <span className="font-semibold text-foreground flex items-center gap-1">
                                                <Edit3 className="w-3 h-3 text-emerald-500" /> Personalized Message Copy (Editable):
                                            </span>
                                            {msg !== item.recipient.personalizedMessage && (
                                                <button
                                                    type="button"
                                                    onClick={() => setScanMessages({ ...scanMessages, [key]: item.recipient.personalizedMessage })}
                                                    className="text-primary hover:underline text-[10px]"
                                                >
                                                    Reset to original
                                                </button>
                                            )}
                                        </div>
                                        <Textarea
                                            rows={3}
                                            value={msg}
                                            onChange={(e) => setScanMessages({ ...scanMessages, [key]: e.target.value })}
                                            className="text-xs font-sans leading-relaxed bg-background"
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-border">
                        <span className="text-xs text-muted-foreground">
                            {Object.values(scanSelected).filter(Boolean).length} of {allScanRecipients.length} approved for dispatch
                        </span>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setShowScanReviewModal(false)} className="h-8 text-xs">
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleDispatchScanRecipients}
                                disabled={dispatchingScan || Object.values(scanSelected).filter(Boolean).length === 0}
                                className="h-8 gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                                {dispatchingScan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                Approve &amp; Dispatch ({Object.values(scanSelected).filter(Boolean).length})
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ============================================================== */}
            {/* DIALOG: QUICK ADD CUSTOMER */}
            {/* ============================================================== */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Add New Customer</DialogTitle>
                        <DialogDescription className="text-xs">
                            Create a customer profile with contact information and jewelry preferences.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs font-semibold">Full Name *</Label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Customer Name"
                                className="h-9 text-xs"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Phone Number</Label>
                                <Input
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="+91 98765 43210"
                                    className="h-9 text-xs"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Email Address</Label>
                                <Input
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="customer@example.com"
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Customer Tier</Label>
                                <Select
                                    value={formData.customer_type}
                                    onValueChange={(v) => setFormData({ ...formData, customer_type: (v as CustomerType) || "retail" })}
                                >
                                    <SelectTrigger className="h-9 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="retail">Retail</SelectItem>
                                        <SelectItem value="wholesale">Wholesale</SelectItem>
                                        <SelectItem value="vip">VIP</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Ring Size</Label>
                                <Input
                                    value={formData.ring_size}
                                    onChange={(e) => setFormData({ ...formData, ring_size: e.target.value })}
                                    placeholder="e.g. 14 (Indian)"
                                    className="h-9 text-xs"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Preferred Metal</Label>
                                <Select
                                    value={formData.preferred_metal}
                                    onValueChange={(v) => setFormData({ ...formData, preferred_metal: v || "Rose Gold" })}
                                >
                                    <SelectTrigger className="h-9 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Rose Gold">Rose Gold</SelectItem>
                                        <SelectItem value="Yellow Gold">Yellow Gold</SelectItem>
                                        <SelectItem value="Platinum">Platinum</SelectItem>
                                        <SelectItem value="Silver">Silver</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Date of Birth</Label>
                                <Input
                                    type="date"
                                    value={formData.date_of_birth}
                                    onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                                    className="h-9 text-xs"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Wedding Anniversary</Label>
                                <Input
                                    type="date"
                                    value={formData.anniversary}
                                    onChange={(e) => setFormData({ ...formData, anniversary: e.target.value })}
                                    className="h-9 text-xs"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                        <Button variant="outline" size="sm" onClick={() => setShowAddDialog(false)} className="h-8 text-xs">
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleAddCustomer}
                            disabled={savingCustomer}
                            className="h-8 text-xs font-semibold"
                        >
                            {savingCustomer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Customer"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
