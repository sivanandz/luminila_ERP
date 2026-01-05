"use client";

import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/gst";

interface SalesDataPoint {
    date: string;
    revenue: number;
    orders: number;
}

interface SalesChartProps {
    data: SalesDataPoint[];
    title?: string;
}

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
                <p className="text-sm text-muted-foreground mb-1">{label}</p>
                <p className="text-sm font-semibold text-primary">
                    {formatINR(payload[0].value)}
                </p>
                <p className="text-xs text-muted-foreground">
                    {payload[1]?.value || 0} orders
                </p>
            </div>
        );
    }
    return null;
};

export function SalesChart({ data, title = "Sales Trend" }: SalesChartProps) {
    // Format dates for display
    const formattedData = data.map(d => ({
        ...d,
        dateLabel: new Date(d.date).toLocaleDateString('en-IN', {
            month: 'short',
            day: 'numeric'
        }),
    }));

    return (
        <Card className="bg-card border-border">
            <CardHeader>
                <CardTitle className="text-primary">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={formattedData}>
                            <defs>
                                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#b8860b" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#b8860b" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                            <XAxis
                                dataKey="dateLabel"
                                stroke="#666"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                            />
                            <YAxis
                                stroke="#666"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}k`}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                                type="monotone"
                                dataKey="revenue"
                                stroke="#b8860b"
                                strokeWidth={2}
                                fill="url(#colorRevenue)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}


