"use client";

import { ShoppingBag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/gst";

interface TopProduct {
    id: string;
    name: string;
    sku: string;
    totalSold: number;
    revenue: number;
}

interface TopProductsProps {
    products: TopProduct[];
    title?: string;
}

export function TopProducts({ products, title = "Top Selling Products" }: TopProductsProps) {
    const maxRevenue = Math.max(...products.map(p => p.revenue), 1);

    return (
        <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-primary">{title}</CardTitle>
                <ShoppingBag className="w-5 h-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {products.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">
                            No sales data yet
                        </p>
                    ) : (
                        products.map((product, index) => (
                            <div key={product.id} className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-mono text-muted-foreground w-5">
                                            {index + 1}.
                                        </span>
                                        <div>
                                            <p className="font-medium text-sm truncate max-w-[180px]">
                                                {product.name}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {product.sku} · {product.totalSold} sold
                                            </p>
                                        </div>
                                    </div>
                                    <p className="text-sm font-mono font-semibold">
                                        {formatINR(product.revenue)}
                                    </p>
                                </div>
                                <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-champagne/50 to-champagne rounded-full transition-all duration-500"
                                        style={{ width: `${(product.revenue / maxRevenue) * 100}%` }}
                                    />
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
}


