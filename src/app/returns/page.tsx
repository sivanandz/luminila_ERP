"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
    RotateCcw,
    Plus,
    Search,
    Filter,
    FileText,
    Clock,
    CheckCircle,
    XCircle,
    DollarSign,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import {
    getCreditNotes,
    getReturnsStats,
    type CreditNote,
    type CreditNoteStatus,
} from "@/lib/returns";
import { formatINR } from "@/lib/gst";

const statusConfig: Record<CreditNoteStatus, { label: string; color: string; icon: any }> = {
    pending: { label: "Pending", color: "bg-yellow-500/20 text-yellow-400", icon: Clock },
    approved: { label: "Approved", color: "bg-blue-500/20 text-blue-400", icon: CheckCircle },
    refunded: { label: "Refunded", color: "bg-green-500/20 text-green-400", icon: DollarSign },
    exchanged: { label: "Exchanged", color: "bg-purple-500/20 text-purple-400", icon: RotateCcw },
    cancelled: { label: "Cancelled", color: "bg-red-500/20 text-red-400", icon: XCircle },
};

export default function ReturnsPage() {
    const router = useRouter();
    const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");

    const loadData = async () => {
        setLoading(true);
        const [notesData, statsData] = await Promise.all([
            getCreditNotes({
                status: statusFilter !== "all" ? statusFilter as CreditNoteStatus : undefined,
            }),
            getReturnsStats(),
        ]);
        setCreditNotes(notesData);
        setStats(statsData);
        setLoading(false);
    };

    useEffect(() => {
        loadData();
    }, [statusFilter]);

    const filteredNotes = creditNotes.filter((cn) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            cn.credit_note_number?.toLowerCase().includes(query) ||
            cn.buyer_name?.toLowerCase().includes(query)
        );
    });

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Returns & Credit Notes"
                subtitle={`${stats?.totalReturns || 0} returns processed`}
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-primary/10">
                                <RotateCcw className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Total Returns</p>
                                <p className="text-2xl font-semibold">{stats?.totalReturns || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-yellow-500/10">
                                <Clock className="w-6 h-6 text-yellow-400" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Pending</p>
                                <p className="text-2xl font-semibold text-yellow-400">
                                    {stats?.pendingCount || 0}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-green-500/10">
                                <DollarSign className="w-6 h-6 text-green-400" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Refunded Value</p>
                                <p className="text-2xl font-semibold text-green-400">
                                    {formatINR(stats?.totalValue || 0)}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-blue-500/10">
                                <FileText className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">This Month</p>
                                <p className="text-2xl font-semibold">{stats?.thisMonth || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters */}
                <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="relative w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder="Search credit notes..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-card border-border"
                            />
                        </div>

                        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
                            <SelectTrigger className="w-36 bg-card border-border">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="approved">Approved</SelectItem>
                                <SelectItem value="refunded">Refunded</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <Button
                        onClick={() => router.push("/returns/create")}
                        className=""
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        New Return
                    </Button>
                </div>

                {/* Table */}
                <Card className="bg-card border-border">
                    <CardContent className="pt-6">
                        {loading ? (
                            <div className="text-center py-12 text-muted-foreground">Loading...</div>
                        ) : filteredNotes.length === 0 ? (
                            <div className="text-center py-12">
                                <RotateCcw className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                                <p className="text-muted-foreground">No credit notes found</p>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-border">
                                        <TableHead>Credit Note #</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Reason</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredNotes.map((cn) => {
                                        const config = statusConfig[cn.status];
                                        const StatusIcon = config.icon;
                                        return (
                                            <TableRow
                                                key={cn.id}
                                                className="border-border cursor-pointer hover:bg-muted/20"
                                                onClick={() => router.push(`/returns/detail?id=${cn.id}`)}
                                            >
                                                <TableCell className="font-mono text-sm">
                                                    {cn.credit_note_number}
                                                </TableCell>
                                                <TableCell>
                                                    {cn.created_at && format(new Date(cn.created_at), "dd MMM yyyy")}
                                                </TableCell>
                                                <TableCell>{cn.buyer_name}</TableCell>
                                                <TableCell className="capitalize">
                                                    {cn.return_reason?.replace("_", " ")}
                                                </TableCell>
                                                <TableCell className="text-right font-mono font-semibold">
                                                    {formatINR(cn.grand_total)}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={config.color}>
                                                        <StatusIcon className="w-3 h-3 mr-1" />
                                                        {config.label}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}


