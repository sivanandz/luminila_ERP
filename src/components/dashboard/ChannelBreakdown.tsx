"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/gst";

interface ChannelData {
    channel: string;
    orders: number;
    revenue: number;
    percentage: number;
    [key: string]: any;
}

interface ChannelBreakdownProps {
    data: ChannelData[];
    title?: string;
}

const COLORS = ['#b8860b', '#4CAF50', '#2196F3', '#9C27B0', '#FF5722', '#607D8B'];

const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
                <p className="font-medium mb-1">{data.channel}</p>
                <p className="text-sm text-primary">{formatINR(data.revenue)}</p>
                <p className="text-xs text-muted-foreground">{data.orders} orders</p>
            </div>
        );
    }
    return null;
};

export function ChannelBreakdown({ data, title = "Sales by Channel" }: ChannelBreakdownProps) {
    if (data.length === 0) {
        return (
            <Card className="bg-card border-border">
                <CardHeader>
                    <CardTitle className="text-primary">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground text-center py-12">
                        No channel data yet
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="bg-card border-border">
            <CardHeader>
                <CardTitle className="text-primary">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={80}
                                paddingAngle={2}
                                dataKey="revenue"
                            >
                                {data.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={COLORS[index % COLORS.length]}
                                        strokeWidth={0}
                                    />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                {/* Legend */}
                <div className="grid grid-cols-2 gap-2 mt-4">
                    {data.map((item, index) => (
                        <div key={item.channel} className="flex items-center gap-2">
                            <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                            />
                            <span className="text-sm truncate">{item.channel}</span>
                            <span className="text-xs text-muted-foreground ml-auto">
                                {item.percentage}%
                            </span>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}


