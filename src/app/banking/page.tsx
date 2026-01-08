"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout";
import {
    getBankAccounts,
    createBankAccount,
    getBankingStats,
    type BankAccount
} from "@/lib/banking";
import { formatPrice } from "@/lib/utils";
import {
    Plus,
    Landmark,
    CreditCard,
    ArrowUpRight,
    ArrowDownLeft,
    History as HistoryIcon,
    Wallet
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function BankingPage() {
    const router = useRouter();
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [stats, setStats] = useState({ totalBalance: 0, totalAccounts: 0 });
    const [loading, setLoading] = useState(true);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // New Account Form
    const [newAccount, setNewAccount] = useState({
        account_name: "",
        account_number: "",
        bank_name: "",
        ifsc_code: "",
        opening_balance: "0",
        currency: "INR"
    });

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        try {
            const [accData, statsData] = await Promise.all([
                getBankAccounts(),
                getBankingStats()
            ]);
            setAccounts(accData);
            setStats(statsData);
        } catch (error) {
            console.error(error);
            toast.error("Failed to load banking data");
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateAccount() {
        if (!newAccount.account_name || !newAccount.bank_name) {
            toast.error("Please fill required fields");
            return;
        }

        setSubmitting(true);
        try {
            await createBankAccount({
                account_name: newAccount.account_name,
                account_number: newAccount.account_number,
                bank_name: newAccount.bank_name,
                ifsc_code: newAccount.ifsc_code,
                opening_balance: parseFloat(newAccount.opening_balance) || 0,
                currency: newAccount.currency,
                is_active: true
            });

            toast.success("Bank account added successfully");
            setShowAddDialog(false);
            setNewAccount({
                account_name: "",
                account_number: "",
                bank_name: "",
                ifsc_code: "",
                opening_balance: "0",
                currency: "INR"
            });
            fetchData();
        } catch (error) {
            console.error(error);
            toast.error("Failed to create account");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Banking & Ledger"
                subtitle="Manage bank accounts and transactions"
            >
                <div className="flex items-center gap-3">
                    <Button
                        onClick={() => router.push('/banking/transactions')}
                        variant="outline"
                        className="border-surface-hover text-moonstone hover:text-white"
                    >
                        <HistoryIcon className="mr-2 h-4 w-4" />
                        Transactions
                    </Button>
                    <Button onClick={() => setShowAddDialog(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Account
                    </Button>
                </div>
            </Header>

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="max-w-7xl mx-auto flex flex-col gap-8">

                    {/* Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 rounded-xl p-6">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="p-3 bg-primary/20 rounded-lg text-primary">
                                    <Wallet size={24} />
                                </div>
                                <div>
                                    <p className="text-moonstone text-sm font-medium">Total Balance</p>
                                    <h3 className="text-2xl font-bold text-white">{formatPrice(stats.totalBalance)}</h3>
                                </div>
                            </div>
                        </div>

                        <div className="bg-surface-navy border border-surface-hover rounded-xl p-6">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="p-3 bg-blue-500/20 rounded-lg text-blue-400">
                                    <Landmark size={24} />
                                </div>
                                <div>
                                    <p className="text-moonstone text-sm font-medium">Active Accounts</p>
                                    <h3 className="text-2xl font-bold text-white">{stats.totalAccounts}</h3>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Accounts Grid */}
                    <h2 className="text-xl font-bold text-white">Your Accounts</h2>

                    {loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="h-48 bg-surface-navy rounded-xl border border-surface-hover animate-pulse" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {accounts.map(acc => (
                                <div
                                    key={acc.id}
                                    className="bg-surface-navy border border-surface-hover rounded-xl p-6 hover:border-primary/50 transition-colors group cursor-pointer"
                                    onClick={() => router.push(`/banking/transactions?accountId=${acc.id}`)}
                                >
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="p-3 bg-bg-navy rounded-lg text-white group-hover:bg-primary group-hover:text-bg-navy transition-colors">
                                            <Landmark size={24} />
                                        </div>
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${acc.is_active ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                            }`}>
                                            {acc.is_active ? 'ACTIVE' : 'INACTIVE'}
                                        </span>
                                    </div>

                                    <h3 className="text-lg font-bold text-white mb-1">{acc.account_name}</h3>
                                    <p className="text-sm text-moonstone mb-4">{acc.bank_name} • {acc.account_number}</p>

                                    <div className="pt-4 border-t border-surface-hover flex justify-between items-end">
                                        <div>
                                            <p className="text-xs text-moonstone uppercase tracking-wider mb-1">Available Balance</p>
                                            <p className="text-xl font-bold text-primary">{formatPrice(acc.current_balance)}</p>
                                        </div>
                                        <Button variant="ghost" size="sm" className="text-moonstone hover:text-white">
                                            View <ArrowUpRight size={16} className="ml-1" />
                                        </Button>
                                    </div>
                                </div>
                            ))}

                            {/* Add Account Card */}
                            <button
                                onClick={() => setShowAddDialog(true)}
                                className="border-2 border-dashed border-surface-hover rounded-xl p-6 flex flex-col items-center justify-center gap-4 text-moonstone hover:text-white hover:border-primary/50 transition-colors min-h-[200px]"
                            >
                                <div className="p-4 rounded-full bg-surface-navy text-moonstone">
                                    <Plus size={24} />
                                </div>
                                <span className="font-bold">Add Bank Account</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Add Account Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Add Bank Account</DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="accName">Account Name (Alias)</Label>
                            <Input
                                id="accName"
                                placeholder="e.g. HDFC Main Ops"
                                className="bg-bg-navy border-surface-hover"
                                value={newAccount.account_name}
                                onChange={e => setNewAccount({ ...newAccount, account_name: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="bankName">Bank Name</Label>
                                <Input
                                    id="bankName"
                                    placeholder="e.g. HDFC Bank"
                                    className="bg-bg-navy border-surface-hover"
                                    value={newAccount.bank_name}
                                    onChange={e => setNewAccount({ ...newAccount, bank_name: e.target.value })}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="ifsc">IFSC Code</Label>
                                <Input
                                    id="ifsc"
                                    placeholder="e.g. HDFC0001234"
                                    className="bg-bg-navy border-surface-hover uppercase"
                                    value={newAccount.ifsc_code}
                                    onChange={e => setNewAccount({ ...newAccount, ifsc_code: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="accNum">Account Number</Label>
                            <Input
                                id="accNum"
                                placeholder="e.g. 50100..."
                                className="bg-bg-navy border-surface-hover"
                                value={newAccount.account_number}
                                onChange={e => setNewAccount({ ...newAccount, account_number: e.target.value })}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="opening">Opening Balance</Label>
                            <Input
                                id="opening"
                                type="number"
                                placeholder="0.00"
                                className="bg-bg-navy border-surface-hover"
                                value={newAccount.opening_balance}
                                onChange={e => setNewAccount({ ...newAccount, opening_balance: e.target.value })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddDialog(false)} className="border-surface-hover text-moonstone hover:text-white">Cancel</Button>
                        <Button onClick={handleCreateAccount} disabled={submitting}>
                            {submitting ? "Adding..." : "Add Account"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
