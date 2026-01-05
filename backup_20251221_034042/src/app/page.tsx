"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout";
import { formatPrice } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import {
  Diamond,
  TrendingUp,
  AlertTriangle,
  Banknote,
  Clock,
  Package,
  CheckCircle,
  Truck,
  ArrowUpRight
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalStockValue: 0,
    dailyRevenue: 0,
    pendingOrdersCount: 0,
    lowStockCount: 0
  });
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // 1. Fetch Sales
      const { data: salesData } = await supabase
        .from('sales')
        .select('*')
        .order('created_at', { ascending: false });

      const sales = salesData || [];
      const dailySales = sales.filter(s => new Date(s.created_at) >= today);
      const dailyRevenue = dailySales.reduce((sum, s) => sum + Number(s.total), 0);
      const pendingOrders = sales.filter(s => s.status === 'pending').length;

      // 2. Fetch Products
      const { data: productsData } = await supabase
        .from('products')
        .select(`
          id, name, base_price, image_url,
          variants:product_variants (id, stock_level, price_adjustment, variant_name)
        `);

      let totalValue = 0;
      let lowStockList: any[] = [];
      let lowStockCounter = 0;

      if (productsData) {
        productsData.forEach((p: any) => {
          if (p.variants?.length > 0) {
            p.variants.forEach((v: any) => {
              const price = Number(p.base_price) + Number(v.price_adjustment || 0);
              const stock = v.stock_level || 0;
              totalValue += price * stock;
              if (stock <= 5) {
                lowStockList.push({
                  id: v.id,
                  title: `${p.name} - ${v.variant_name}`,
                  stock: stock,
                  image: p.image_url
                });
                lowStockCounter++;
              }
            });
          }
        });
      }

      setStats({
        totalStockValue: totalValue,
        dailyRevenue,
        pendingOrdersCount: pendingOrders,
        lowStockCount: lowStockCounter
      });

      setRecentSales(sales.slice(0, 5).map(s => ({
        id: s.id.slice(0, 8).toUpperCase(),
        customer: s.customer_name || "Walk-in Customer",
        amount: s.total,
        status: s.status,
        date: new Date(s.created_at).toLocaleDateString(),
        channel: s.channel
      })));

      setLowStockItems(lowStockList.slice(0, 5));

    } catch (error) {
      console.error("Error fetching data", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const channels = [
      supabase.channel('sales').on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, fetchData).subscribe(),
      supabase.channel('products').on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchData).subscribe(),
    ];
    return () => { channels.forEach(c => supabase.removeChannel(c)) };
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-background p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">Overview of your store's performance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button>Download Report</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Stock Value</CardTitle>
            <Diamond className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPrice(stats.totalStockValue)}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <ArrowUpRight className="h-3 w-3 text-emerald-500" />
              <span className="text-emerald-500 font-medium">+2.1%</span> from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Daily Revenue</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPrice(stats.dailyRevenue)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              For today
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingOrdersCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Requires processing</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.lowStockCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Items below threshold</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-7">

        {/* Sales Chart / Trends */}
        <Card className="col-span-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Sales Trends</CardTitle>
              <CardDescription>Revenue performance over time.</CardDescription>
            </div>
            <Select defaultValue="30days">
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[240px] flex items-end justify-between gap-2 px-4 pb-4">
              {[45, 20, 60, 35, 80, 50, 70, 40, 55, 65, 30, 75].map((h, i) => (
                <div key={i} className="flex-1 bg-primary/20 hover:bg-primary/40 transition-colors rounded-t-sm relative group" style={{ height: `${h}%` }}>
                </div>
              ))}
              {/* Placeholder chart bars */}
            </div>
          </CardContent>
        </Card>

        {/* Needs Attention / Low Stock */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Needs Attention</CardTitle>
            <CardDescription>
              {stats.lowStockCount} items have low stock.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[240px] pr-4">
              {lowStockItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-8">
                  <CheckCircle className="h-12 w-12 mb-2 text-emerald-500/50" />
                  <p>All stock levels healthy!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {lowStockItems.map((item, idx) => (
                    <div key={idx} className="flex items-center">
                      <Avatar className="h-9 w-9 rounded-lg border">
                        <AvatarImage src={item.image} alt={item.title} className="object-cover" />
                        <AvatarFallback className="rounded-lg"><Package className="h-4 w-4" /></AvatarFallback>
                      </Avatar>
                      <div className="ml-4 space-y-1">
                        <p className="text-sm font-medium leading-none">{item.title}</p>
                        <p className="text-xs text-muted-foreground">Only {item.stock} left</p>
                      </div>
                      <div className="ml-auto font-medium text-destructive text-sm">Low</div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Recent Sales */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Recent Sales</CardTitle>
          <CardDescription>
            You made {stats.dailyRevenue > 0 ? 'sales' : 'no sales'} today.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">Loading...</TableCell>
                </TableRow>
              ) : recentSales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">No recent transactions.</TableCell>
                </TableRow>
              ) : (
                recentSales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="font-medium">{sale.id}</TableCell>
                    <TableCell>{sale.customer}</TableCell>
                    <TableCell className="capitalize">
                      <Badge variant="outline">{sale.channel}</Badge>
                    </TableCell>
                    <TableCell>{sale.date}</TableCell>
                    <TableCell>{formatPrice(sale.amount)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={sale.status === 'confirmed' ? "default" : "secondary"}>
                        {sale.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
