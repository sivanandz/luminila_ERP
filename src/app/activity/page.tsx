"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
    Activity,
    Search,
    Filter,
    RefreshCw,
    Package,
    Receipt,
    ShoppingCart,
    Users,
    FileText,
    Settings,
    LogIn,
    Download,
    Printer,
    Edit,
    Trash2,
    Plus,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

import {
    getActivityLogs,
    getActivityStats,
    type ActivityLog,
    type ActivityAction,
    type EntityType,
} from "@/lib/activity";

const actionIcons: Record<ActivityAction, any> = {
    create: Plus,
    update: Edit,
    delete: Trash2,
    login: LogIn,
    logout: LogIn,
    export: Download,
    print: Printer,
    status_change: RefreshCw,
    payment: Receipt,
    sync: RefreshCw,
};

const actionColors: Record<ActivityAction, string> = {
    create: "bg-green-500/20 text-green-400",
    update: "bg-blue-500/20 text-blue-400",
    delete: "bg-red-500/20 text-red-400",
    login: "bg-purple-500/20 text-purple-400",
    logout: "bg-gray-500/20 text-gray-400",
    export: "bg-yellow-500/20 text-yellow-400",
    print: "bg-primary/20 text-primary",
    status_change: "bg-orange-500/20 text-orange-400",
    payment: "bg-green-500/20 text-green-400",
    sync: "bg-cyan-500/20 text-cyan-400",
};

const entityIcons: Record<EntityType, any> = {
    product: Package,
    invoice: FileText,
    sale: ShoppingCart,
    order: ShoppingCart,
    customer: Users,
    vendor: Users,
    purchase_order: FileText,
    grn: Package,
    user: Users,
    settings: Settings,
};

export default function ActivityPage() {
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [search, setSearch] = useState("");
    const [actionFilter, setActionFilter] = useState<string>("all");
    const [entityFilter, setEntityFilter] = useState<string>("all");

    const loadData = async () => {
        setLoading(true);
        const [logsData, statsData] = await Promise.all([
            getActivityLogs({
                action: actionFilter !== "all" ? actionFilter as ActivityAction : undefined,
                entity_type: entityFilter !== "all" ? entityFilter as EntityType : undefined,
                search: search || undefined,
            }, 100),
            getActivityStats(),
        ]);
        setLogs(logsData.logs);
        setStats(statsData);
        setLoading(false);
    };

    useEffect(() => {
        loadData();
    }, [actionFilter, entityFilter]);

    const handleSearch = () => {
        loadData();
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Activity Log" subtitle="System audit trail" />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-primary/10">
                                <Activity className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Today</p>
                                <p className="text-2xl font-semibold">{stats?.todayCount || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-blue-500/10">
                                <Activity className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">This Week</p>
                                <p className="text-2xl font-semibold">{stats?.weekCount || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-green-500/10">
                                <Plus className="w-6 h-6 text-green-400" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Creates (7d)</p>
                                <p className="text-2xl font-semibold">
                                    {stats?.byAction?.create || 0}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-4 mb-6">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search activity..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className="pl-10 bg-card"
                        />
                    </div>

                    <Select value={actionFilter} onValueChange={setActionFilter}>
                        <SelectTrigger className="w-40 bg-card">
                            <SelectValue placeholder="Action" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Actions</SelectItem>
                            <SelectItem value="create">Create</SelectItem>
                            <SelectItem value="update">Update</SelectItem>
                            <SelectItem value="delete">Delete</SelectItem>
                            <SelectItem value="export">Export</SelectItem>
                            <SelectItem value="print">Print</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={entityFilter} onValueChange={setEntityFilter}>
                        <SelectTrigger className="w-40 bg-card">
                            <SelectValue placeholder="Entity" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Entities</SelectItem>
                            <SelectItem value="product">Products</SelectItem>
                            <SelectItem value="invoice">Invoices</SelectItem>
                            <SelectItem value="sale">Sales</SelectItem>
                            <SelectItem value="customer">Customers</SelectItem>
                            <SelectItem value="purchase_order">Purchase Orders</SelectItem>
                        </SelectContent>
                    </Select>

                    <Button variant="outline" onClick={loadData}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>

                {/* Activity Feed */}
                <Card className="bg-card border-border">
                    <CardContent className="pt-6">
                        {loading ? (
                            <div className="text-center py-12 text-muted-foreground">Loading...</div>
                        ) : logs.length === 0 ? (
                            <div className="text-center py-12">
                                <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                                <p className="text-muted-foreground">No activity logs found</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {logs.map((log) => {
                                    const ActionIcon = actionIcons[log.action] || Activity;
                                    const EntityIcon = entityIcons[log.entity_type] || FileText;
                                    const colorClass = actionColors[log.action] || "bg-gray-500/20 text-gray-400";

                                    return (
                                        <div
                                            key={log.id}
                                            className="flex items-start gap-4 p-4 rounded-lg bg-muted/10 hover:bg-muted/20 transition-colors"
                                        >
                                            <div className={`p-2 rounded-lg ${colorClass.split(' ')[0]}`}>
                                                <ActionIcon className={`w-4 h-4 ${colorClass.split(' ')[1]}`} />
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <Badge variant="outline" className="text-xs capitalize">
                                                        {log.action.replace('_', ' ')}
                                                    </Badge>
                                                    <Badge variant="outline" className="text-xs capitalize">
                                                        <EntityIcon className="w-3 h-3 mr-1" />
                                                        {log.entity_type.replace('_', ' ')}
                                                    </Badge>
                                                </div>
                                                <p className="text-sm">{log.description}</p>
                                                {log.user_name && (
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        by {log.user_name}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                                                {format(new Date(log.created_at), "dd MMM, HH:mm")}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}


