"use client";

import { formatDistanceToNow } from "date-fns";
import {
    ShoppingCart,
    Receipt,
    Package,
    FileText,
    ArrowUpRight,
    ArrowDownRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/gst";

interface Activity {
    id: string;
    type: 'sale' | 'order' | 'stock' | 'invoice';
    title: string;
    description: string;
    amount?: number;
    timestamp: string;
}

interface RecentActivityProps {
    activities: Activity[];
    title?: string;
}

const typeConfig = {
    sale: {
        icon: ShoppingCart,
        color: 'text-green-400',
        bg: 'bg-green-500/10',
    },
    order: {
        icon: Receipt,
        color: 'text-blue-400',
        bg: 'bg-blue-500/10',
    },
    stock: {
        icon: Package,
        color: 'text-yellow-400',
        bg: 'bg-yellow-500/10',
    },
    invoice: {
        icon: FileText,
        color: 'text-primary',
        bg: 'bg-primary/10',
    },
};

export function RecentActivity({ activities, title = "Recent Activity" }: RecentActivityProps) {
    return (
        <Card className="bg-card border-border">
            <CardHeader>
                <CardTitle className="text-primary">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {activities.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">
                            No recent activity
                        </p>
                    ) : (
                        activities.map((activity) => {
                            const config = typeConfig[activity.type];
                            const Icon = config.icon;
                            const timeAgo = formatDistanceToNow(new Date(activity.timestamp), {
                                addSuffix: true
                            });

                            return (
                                <div
                                    key={activity.id}
                                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors"
                                >
                                    <div className={`p-2 rounded-lg ${config.bg}`}>
                                        <Icon className={`w-4 h-4 ${config.color}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-medium truncate">
                                                {activity.title}
                                            </p>
                                            {activity.amount !== undefined && (
                                                <span className="text-sm font-mono font-semibold text-primary">
                                                    {formatINR(activity.amount)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-xs text-muted-foreground truncate">
                                                {activity.description}
                                            </p>
                                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                {timeAgo}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </CardContent>
        </Card>
    );
}


