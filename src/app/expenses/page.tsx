"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout";
import { formatPrice, formatDate } from "@/lib/utils";
import {
    getExpenses,
    createExpense,
    deleteExpense,
    getCategories,
    getExpenseStats,
    type Expense,
    type ExpenseCategory
} from "@/lib/expenses";
import {
    Plus,
    Search,
    Filter,
    Calendar,
    Wallet,
    CreditCard,
    Landmark,
    Banknote,
    MoreHorizontal,
    Trash2,
    PieChart,
    ArrowUpRight
} from "lucide-react";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function ExpensesPage() {
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Filters
    const [search, setSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [dateRange, setDateRange] = useState({
        start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
    });

    // Create Modal State
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newExpense, setNewExpense] = useState({
        amount: "",
        date: new Date().toISOString().split('T')[0],
        category_id: "",
        payment_mode: "cash",
        payee: "",
        description: "",
        reference_number: ""
    });

    useEffect(() => {
        loadData();
    }, [selectedCategory, dateRange]);

    // Initial load for categories
    useEffect(() => {
        getCategories().then(setCategories);
    }, []);

    const loadData = async () => {
        setLoading(true);
        const [expenseData, statsData] = await Promise.all([
            getExpenses({
                startDate: dateRange.start,
                endDate: dateRange.end,
                categoryId: selectedCategory,
                search
            }),
            getExpenseStats(dateRange.start, dateRange.end)
        ]);
        setExpenses(expenseData);
        setStats(statsData);
        setLoading(false);
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        loadData();
    };

    const handleCreate = async () => {
        if (!newExpense.amount || !newExpense.category_id || !newExpense.date) {
            toast.error("Please fill required fields (Amount, Date, Category)");
            return;
        }

        const result = await createExpense({
            ...newExpense,
            amount: parseFloat(newExpense.amount),
            payment_mode: newExpense.payment_mode as any
        });

        if (result) {
            toast.success("Expense recorded successfully");
            setIsCreateOpen(false);
            setNewExpense({
                amount: "",
                date: new Date().toISOString().split('T')[0],
                category_id: "",
                payment_mode: "cash",
                payee: "",
                description: "",
                reference_number: ""
            });
            loadData();
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm("Are you sure you want to delete this expense?")) {
            const success = await deleteExpense(id);
            if (success) loadData();
        }
    };

    return (
        <div className="flex flex-col h-full bg-bg-navy">
            <Header title="Expense Management" subtitle="Track business spending and costs" />

            <div className="flex-1 overflow-y-auto p-6">

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 max-w-7xl mx-auto">
                    <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-moonstone text-sm font-medium">Total Expenses</p>
                                <h3 className="text-3xl font-bold text-white mt-2">
                                    {stats ? formatPrice(stats.totalAmount) : "..."}
                                </h3>
                            </div>
                            <div className="p-3 bg-red-500/10 rounded-lg">
                                <ArrowUpRight className="text-red-500" size={24} />
                            </div>
                        </div>
                        <p className="text-xs text-moonstone mt-4">For selected period</p>
                    </div>

                    <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="text-moonstone text-sm font-medium">Top Category</p>
                                <h3 className="text-xl font-bold text-white mt-2 truncate max-w-[180px]">
                                    {stats?.byCategory[0]?.name || "N/A"}
                                </h3>
                                <p className="text-sm text-primary mt-1 font-mono">
                                    {stats?.byCategory[0] ? formatPrice(stats.byCategory[0].amount) : ""}
                                </p>
                            </div>
                            <div className="p-3 bg-primary/10 rounded-lg">
                                <PieChart className="text-primary" size={24} />
                            </div>
                        </div>
                        <p className="text-xs text-moonstone mt-4">
                            {stats?.byCategory[0] ? `${stats.byCategory[0].percentage.toFixed(1)}% of total` : "No data"}
                        </p>
                    </div>

                    <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover flex flex-col justify-center">
                        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                            <DialogTrigger asChild>
                                <Button className="w-full h-12 text-base font-bold">
                                    <Plus className="mr-2" size={20} />
                                    Record New Expense
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="bg-surface-navy border-surface-hover text-white sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle>Add New Expense</DialogTitle>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Date *</Label>
                                            <Input
                                                type="date"
                                                className="bg-bg-navy border-surface-hover"
                                                value={newExpense.date}
                                                onChange={(e) => setNewExpense({ ...newExpense, date: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Amount *</Label>
                                            <Input
                                                type="number"
                                                placeholder="0.00"
                                                className="bg-bg-navy border-surface-hover"
                                                value={newExpense.amount}
                                                onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Category *</Label>
                                        <Select
                                            value={newExpense.category_id}
                                            onValueChange={(v) => v && setNewExpense({ ...newExpense, category_id: v })}
                                        >
                                            <SelectTrigger className="bg-bg-navy border-surface-hover">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-surface-navy border-surface-hover text-white">
                                                {categories.map(cat => (
                                                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Payee / Vendor</Label>
                                        <Input
                                            placeholder="Who was paid?"
                                            className="bg-bg-navy border-surface-hover"
                                            value={newExpense.payee}
                                            onChange={(e) => setNewExpense({ ...newExpense, payee: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Description</Label>
                                        <Textarea
                                            placeholder="Details..."
                                            className="bg-bg-navy border-surface-hover resize-none"
                                            value={newExpense.description}
                                            onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>Payment Mode</Label>
                                            <Select
                                                value={newExpense.payment_mode}
                                                onValueChange={(v) => v && setNewExpense({ ...newExpense, payment_mode: v })}
                                            >
                                                <SelectTrigger className="bg-bg-navy border-surface-hover">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-surface-navy border-surface-hover text-white">
                                                    <SelectItem value="cash">Cash</SelectItem>
                                                    <SelectItem value="card">Card</SelectItem>
                                                    <SelectItem value="upi">UPI</SelectItem>
                                                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                                                    <SelectItem value="cheque">Cheque</SelectItem>
                                                    <SelectItem value="other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Ref No.</Label>
                                            <Input
                                                placeholder="Trx ID / Bill No."
                                                className="bg-bg-navy border-surface-hover font-mono text-xs"
                                                value={newExpense.reference_number}
                                                onChange={(e) => setNewExpense({ ...newExpense, reference_number: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                                    <Button onClick={handleCreate}>Save Expense</Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-surface-navy p-4 rounded-xl border border-surface-hover mb-6 max-w-7xl mx-auto flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <Label className="text-xs text-moonstone mb-1.5 block">Search</Label>
                        <form onSubmit={handleSearch} className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-moonstone" size={16} />
                            <Input
                                placeholder="Search payee, desc, amount..."
                                className="pl-9 bg-bg-navy border-surface-hover h-10 w-full"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </form>
                    </div>

                    <div className="w-[180px]">
                        <Label className="text-xs text-moonstone mb-1.5 block">Category</Label>
                        <Select value={selectedCategory} onValueChange={(v) => v && setSelectedCategory(v)}>
                            <SelectTrigger className="bg-bg-navy border-surface-hover h-10">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-surface-navy border-surface-hover text-white">
                                <SelectItem value="all">All Categories</SelectItem>
                                {categories.map(cat => (
                                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="w-[150px]">
                        <Label className="text-xs text-moonstone mb-1.5 block">From Date</Label>
                        <Input
                            type="date"
                            className="bg-bg-navy border-surface-hover h-10"
                            value={dateRange.start}
                            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                        />
                    </div>

                    <div className="w-[150px]">
                        <Label className="text-xs text-moonstone mb-1.5 block">To Date</Label>
                        <Input
                            type="date"
                            className="bg-bg-navy border-surface-hover h-10"
                            value={dateRange.end}
                            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                        />
                    </div>
                </div>

                {/* Expenses Table */}
                <div className="bg-surface-navy rounded-xl border border-surface-hover overflow-hidden max-w-7xl mx-auto">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-surface-hover text-xs font-bold text-moonstone uppercase bg-bg-navy/30">
                                    <th className="py-4 px-6 w-32">Date</th>
                                    <th className="py-4 px-6">Payee / Details</th>
                                    <th className="py-4 px-6">Category</th>
                                    <th className="py-4 px-6 w-32">Mode</th>
                                    <th className="py-4 px-6 text-right w-32">Amount</th>
                                    <th className="py-4 px-6 w-20 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-hover text-sm">
                                {loading ? (
                                    <tr>
                                        <td colSpan={6} className="py-8 text-center text-moonstone">Loading expenses...</td>
                                    </tr>
                                ) : expenses.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="py-12 text-center text-moonstone">
                                            <Wallet size={48} className="mx-auto mb-3 opacity-20" />
                                            No expenses found for this period
                                        </td>
                                    </tr>
                                ) : (
                                    expenses.map((expense) => (
                                        <tr key={expense.id} className="hover:bg-bg-navy/30 group transition-colors">
                                            <td className="py-4 px-6 text-moonstone font-mono text-xs">
                                                {formatDate(expense.date)}
                                                <div className="text-[10px] opacity-60 mt-0.5">{expense.expense_number}</div>
                                            </td>
                                            <td className="py-4 px-6">
                                                <div className="font-bold text-white">{expense.payee || 'Unknown Payee'}</div>
                                                {expense.description && (
                                                    <div className="text-xs text-moonstone mt-0.5 truncate max-w-[200px]">{expense.description}</div>
                                                )}
                                            </td>
                                            <td className="py-4 px-6">
                                                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-bg-navy text-primary border border-surface-hover">
                                                    {expense.category?.name}
                                                </span>
                                            </td>
                                            <td className="py-4 px-6">
                                                <div className="flex items-center gap-2 text-moonstone capitalize">
                                                    {expense.payment_mode === 'cash' && <Banknote size={14} />}
                                                    {expense.payment_mode === 'card' && <CreditCard size={14} />}
                                                    {expense.payment_mode === 'bank_transfer' && <Landmark size={14} />}
                                                    {expense.payment_mode}
                                                </div>
                                            </td>
                                            <td className="py-4 px-6 text-right font-bold text-white text-base">
                                                {formatPrice(expense.amount)}
                                            </td>
                                            <td className="py-4 px-6 text-center">
                                                <button
                                                    onClick={() => expense.id && handleDelete(expense.id)}
                                                    className="p-2 text-moonstone hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-full hover:bg-bg-navy"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
