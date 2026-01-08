"use client";

import { useState, useEffect, Suspense } from "react";
import { Header } from "@/components/layout";
import {
    getBankTransactions,
    createBankTransaction,
    getBankAccounts,
    type BankTransaction,
    type BankAccount
} from "@/lib/banking";
import { formatPrice, formatDate } from "@/lib/utils";
import {
    Plus,
    ArrowUpRight,
    ArrowDownLeft,
    RefreshCw,
    Search,
    ArrowRightLeft,
    History as HistoryIcon
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

function TransactionsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialAccountId = searchParams.get("accountId") || "all";

    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [accounts, setAccounts] = useState<BankAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedAccount, setSelectedAccount] = useState(initialAccountId);

    // Add Transaction State
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [newTx, setNewTx] = useState({
        account_id: "",
        type: "deposit",
        amount: "",
        description: "",
        reference_number: "",
        transaction_date: new Date().toISOString().split('T')[0]
    });

    useEffect(() => {
        fetchData();
    }, [selectedAccount]);

    // Update selected account if param changes
    useEffect(() => {
        if (searchParams.get("accountId")) {
            setSelectedAccount(searchParams.get("accountId")!);
        }
    }, [searchParams]);

    async function fetchData() {
        setLoading(true);
        try {
            const [txData, accData] = await Promise.all([
                getBankTransactions(selectedAccount === 'all' ? undefined : selectedAccount),
                getBankAccounts()
            ]);
            setTransactions(txData);
            setAccounts(accData);

            // Set default account for new tx if filtered
            if (selectedAccount !== 'all') {
                setNewTx(prev => ({ ...prev, account_id: selectedAccount }));
            } else if (accData.length > 0) {
                setNewTx(prev => ({ ...prev, account_id: accData[0].id }));
            }
        } catch (error) {
            console.error(error);
            toast.error("Failed to load transactions");
        } finally {
            setLoading(false);
        }
    }

    async function handleSubmit() {
        if (!newTx.account_id || !newTx.amount || !newTx.description) {
            toast.error("Please fill required fields");
            return;
        }

        setSubmitting(true);
        try {
            await createBankTransaction({
                account: newTx.account_id,
                transaction_date: newTx.transaction_date,
                type: newTx.type as any,
                amount: parseFloat(newTx.amount),
                description: newTx.description,
                reference_number: newTx.reference_number
            });

            toast.success("Transaction recorded");
            setShowAddDialog(false);
            setNewTx({
                account_id: selectedAccount !== 'all' ? selectedAccount : (accounts[0]?.id || ""),
                type: "deposit",
                amount: "",
                description: "",
                reference_number: "",
                transaction_date: new Date().toISOString().split('T')[0]
            });
            fetchData();
        } catch (error) {
            console.error(error);
            toast.error("Failed to save transaction");
        } finally {
            setSubmitting(false);
        }
    }

    const getIcon = (type: string) => {
        switch (type) {
            case 'deposit': return <ArrowDownLeft className="text-green-400" size={18} />;
            case 'withdrawal': return <ArrowUpRight className="text-red-400" size={18} />;
            case 'transfer': return <ArrowRightLeft className="text-blue-400" size={18} />;
            default: return <RefreshCw className="text-gray-400" size={18} />;
        }
    };

    const getColor = (type: string) => {
        switch (type) {
            case 'deposit': return 'text-green-400';
            case 'withdrawal': return 'text-red-400';
            default: return 'text-white';
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Transactions"
                subtitle="Bank ledger entries"
            >
                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        className="border-surface-hover text-moonstone hover:text-white"
                        onClick={() => router.push('/banking')}
                    >
                        accounts
                    </Button>
                    <Button onClick={() => setShowAddDialog(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Entry
                    </Button>
                </div>
            </Header>

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Filters */}
                <div className="flex items-center justify-between mb-6 gap-4">
                    <div className="flex items-center gap-2 bg-surface-navy p-1 rounded-lg border border-surface-hover">
                        <Select value={selectedAccount} onValueChange={(val) => val && setSelectedAccount(val)}>
                            <SelectTrigger className="w-[200px] border-none bg-transparent">
                                <SelectValue placeholder="Select Account" {...({} as any)} />
                            </SelectTrigger>
                            <SelectContent className="bg-surface-navy border-surface-hover text-white">
                                <SelectItem value="all">All Accounts</SelectItem>
                                {accounts.map(acc => (
                                    <SelectItem key={acc.id} value={acc.id}>{acc.account_name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="relative group max-w-sm flex-1 md:flex-none">
                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone">
                            <Search size={16} />
                        </div>
                        <input
                            className="bg-surface-navy border border-surface-hover text-white text-sm rounded-lg block w-full pl-10 py-2 focus:ring-1 focus:ring-primary placeholder-moonstone transition-all"
                            placeholder="Search description..."
                            type="text"
                        />
                    </div>
                </div>

                {/* Table */}
                <div className="bg-surface-navy rounded-xl border border-surface-hover overflow-hidden">
                    {loading ? (
                        <div className="p-8 text-center text-moonstone">Loading transactions...</div>
                    ) : transactions.length === 0 ? (
                        <div className="p-12 text-center flex flex-col items-center justify-center gap-4">
                            <div className="w-16 h-16 bg-surface-hover rounded-full flex items-center justify-center text-moonstone">
                                <HistoryIcon size={32} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">No transactions found</h3>
                                <p className="text-moonstone text-sm">Add a deposit or withdrawal to get started</p>
                            </div>
                        </div>
                    ) : (
                        <table className="w-full text-left">
                            <thead className="bg-bg-navy/50 border-b border-surface-hover">
                                <tr>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase">Date</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase">Description</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase">Account</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase">Ref #</th>
                                    <th className="py-4 px-6 text-xs font-bold text-moonstone uppercase text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-hover">
                                {transactions.map((tx) => (
                                    <tr key={tx.id} className="hover:bg-bg-navy/30 transition-colors">
                                        <td className="py-4 px-6 text-sm text-moonstone">
                                            {formatDate(tx.transaction_date)}
                                        </td>
                                        <td className="py-4 px-6">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded bg-bg-navy border border-surface-hover ${tx.type === 'deposit' ? 'text-green-400' : 'text-red-400'}`}>
                                                    {getIcon(tx.type)}
                                                </div>
                                                <div>
                                                    <p className="text-white font-medium">{tx.description}</p>
                                                    <p className="text-xs text-moonstone capitalize opacity-70">{tx.type}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-4 px-6 text-sm text-white">
                                            {tx.expand?.account?.account_name || 'Unknown'}
                                        </td>
                                        <td className="py-4 px-6 text-sm text-moonstone font-mono">
                                            {tx.reference_number || '-'}
                                        </td>
                                        <td className={`py-4 px-6 text-right font-bold ${getColor(tx.type)}`}>
                                            {tx.type === 'withdrawal' ? '-' : '+'}{formatPrice(tx.amount)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Add Transaction Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className="bg-surface-navy border-surface-hover text-white sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Record Transaction</DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Type</Label>
                                <Select
                                    value={newTx.type}
                                    onValueChange={(val) => setNewTx({ ...newTx, type: val as any })}
                                >
                                    <SelectTrigger className="bg-bg-navy border-surface-hover">
                                        <SelectValue {...({} as any)} />
                                    </SelectTrigger>
                                    <SelectContent className="bg-surface-navy border-surface-hover text-white">
                                        <SelectItem value="deposit">Deposit (In)</SelectItem>
                                        <SelectItem value="withdrawal">Withdrawal (Out)</SelectItem>
                                        {/* Transfer is trickier UI wise, skip for now */}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Date</Label>
                                <Input
                                    type="date"
                                    className="bg-bg-navy border-surface-hover"
                                    value={newTx.transaction_date}
                                    onChange={e => setNewTx({ ...newTx, transaction_date: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <Label>Account</Label>
                            <Select
                                value={newTx.account_id}
                                onValueChange={(val) => val && setNewTx({ ...newTx, account_id: val })}
                            >
                                <SelectTrigger className="bg-bg-navy border-surface-hover">
                                    <SelectValue placeholder="Select Account" {...({} as any)} />
                                </SelectTrigger>
                                <SelectContent className="bg-surface-navy border-surface-hover text-white">
                                    {accounts.map(acc => (
                                        <SelectItem key={acc.id} value={acc.id}>{acc.account_name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label>Amount</Label>
                            <Input
                                type="number"
                                placeholder="0.00"
                                className="bg-bg-navy border-surface-hover font-bold text-lg"
                                value={newTx.amount}
                                onChange={e => setNewTx({ ...newTx, amount: e.target.value })}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Description</Label>
                            <Input
                                placeholder="e.g. Sales Deposit"
                                className="bg-bg-navy border-surface-hover"
                                value={newTx.description}
                                onChange={e => setNewTx({ ...newTx, description: e.target.value })}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Reference Number</Label>
                            <Input
                                placeholder="e.g. UPI/NEFT Ref"
                                className="bg-bg-navy border-surface-hover"
                                value={newTx.reference_number}
                                onChange={e => setNewTx({ ...newTx, reference_number: e.target.value })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddDialog(false)} className="border-surface-hover text-moonstone hover:text-white">Cancel</Button>
                        <Button onClick={handleSubmit} disabled={submitting}>
                            {submitting ? "Saving..." : "Save Entry"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function TransactionsPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
            <TransactionsContent />
        </Suspense>
    );
}
