"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {

    TrendingUp,
    Package,
    Receipt,
    FileSpreadsheet,
    Calendar,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { getSalesReport, exportToCSV } from "@/lib/reports";

const reports = [
    {
        id: "sales",
        title: "Sales Report",
        description: "Daily, weekly, monthly sales summary with invoice details",
        icon: TrendingUp,
        color: "text-green-400",
        bgColor: "bg-green-500/10",
        href: "/reports/sales",
    },
    {
        id: "gst",
        title: "GST Report (GSTR-1)",
        description: "B2B and B2C invoices in GSTR-1 format for filing",
        icon: Receipt,
        color: "text-primary",
        bgColor: "bg-primary/10",
        href: "/reports/gst",
    },
    {
        id: "stock",
        title: "Stock Report",
        description: "Current inventory levels, low stock alerts, valuation",
        icon: Package,
        color: "text-blue-400",
        bgColor: "bg-blue-500/10",
        href: "/reports/stock",
    },
];

export default function ReportsPage() {
    const router = useRouter();
    const [busyExport, setBusyExport] = useState<"invoices" | "summary" | null>(null);

    // Both Quick Export cards are wired here; they used to be styled as
    // clickable but did nothing (FIN-24).
    const handleExportInvoices = async () => {
        setBusyExport("invoices");
        try {
            const now = new Date();
            const start = format(startOfMonth(now), "yyyy-MM-dd");
            const end = format(endOfMonth(now), "yyyy-MM-dd");
            const { rows } = await getSalesReport(start, end);
            exportToCSV(rows, `invoices_${format(now, "yyyy-MM")}`);
        } catch (error) {
            console.error(error);
            alert("Failed to export invoices");
        } finally {
            setBusyExport(null);
        }
    };

    const handleExportMonthlySummary = async () => {
        setBusyExport("summary");
        try {
            const now = new Date();
            const start = format(startOfMonth(now), "yyyy-MM-dd");
            const end = format(endOfMonth(now), "yyyy-MM-dd");
            const { summary } = await getSalesReport(start, end);
            exportToCSV([
                { metric: "Period", value: `${start} to ${end}` },
                { metric: "Total Sales", value: summary.totalSales },
                { metric: "Total Tax", value: summary.totalTax },
                { metric: "Total Orders", value: summary.totalOrders },
                { metric: "Total Items", value: summary.totalItems },
            ], `monthly_summary_${format(now, "yyyy-MM")}`);
        } catch (error) {
            console.error(error);
            alert("Failed to export the monthly summary");
        } finally {
            setBusyExport(null);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Reports"
                subtitle="Generate and export business reports"
            />

            <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-8 scroll-smooth">
                <div className="max-w-4xl mx-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
                        {reports.map((report) => {
                            const Icon = report.icon;
                            return (
                                <Card
                                    key={report.id}
                                    className="bg-card border-border hover:border-primary/30 cursor-pointer transition-all group"
                                    onClick={() => router.push(report.href)}
                                >
                                    <CardContent className="pt-6">
                                        <div className={`p-4 rounded-xl ${report.bgColor} w-fit mb-4 group-hover:scale-110 transition-transform`}>
                                            <Icon className={`w-8 h-8 ${report.color}`} />
                                        </div>
                                        <h3 className="font-semibold text-lg mb-2">{report.title}</h3>
                                        <p className="text-sm text-muted-foreground">
                                            {report.description}
                                        </p>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>

                    {/* Quick Actions */}
                    <div className="mt-12">
                        <h3 className="text-lg font-semibold mb-4 text-primary">Quick Exports</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Card
                                className="bg-muted border-border hover:bg-card cursor-pointer transition-colors"
                                onClick={handleExportInvoices}
                                aria-busy={busyExport === "invoices"}
                            >
                                <CardContent className="pt-6 flex items-center gap-4">
                                    <FileSpreadsheet className="w-6 h-6 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">
                                            {busyExport === "invoices" ? "Exporting..." : "Export All Invoices"}
                                        </p>
                                        <p className="text-xs text-muted-foreground">CSV format for this month</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card
                                className="bg-muted border-border hover:bg-card cursor-pointer transition-colors"
                                onClick={handleExportMonthlySummary}
                                aria-busy={busyExport === "summary"}
                            >
                                <CardContent className="pt-6 flex items-center gap-4">
                                    <Calendar className="w-6 h-6 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">
                                            {busyExport === "summary" ? "Exporting..." : "Monthly Summary"}
                                        </p>
                                        <p className="text-xs text-muted-foreground">Revenue, tax, and orders</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}


