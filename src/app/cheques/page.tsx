"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatINR } from "@/lib/gst";
import {
    addCheque,
    advanceCheque,
    deleteCheque,
    listCheques,
    maturityOf,
    summariseCheques,
    type NewChequeInput,
} from "@/lib/cheque-register";
import type { ChequeDirection, ChequeRecord } from "@/lib/cheque-engine";

const STATUS_STYLES: Record<string, string> = {
    open: "bg-slate-600/20 text-slate-300 border-slate-600/40",
    deposited: "bg-amber-600/20 text-amber-400 border-amber-600/40",
    cleared: "bg-emerald-600/20 text-emerald-400 border-emerald-600/40",
    bounced: "bg-red-600/20 text-red-400 border-red-600/40",
    cancelled: "bg-muted text-muted-foreground border-border",
};

function today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function ChequeRegisterPage() {
    const [cheques, setCheques] = useState<ChequeRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [chequeNumber, setChequeNumber] = useState("");
    const [direction, setDirection] = useState<ChequeDirection>("received");
    const [partyName, setPartyName] = useState("");
    const [bankName, setBankName] = useState("");
    const [branchName, setBranchName] = useState("");
    const [chequeDate, setChequeDate] = useState(today());
    const [amount, setAmount] = useState("");
    const [notes, setNotes] = useState("");

    const summary = useMemo(() => summariseCheques(cheques), [cheques]);

    const load = async () => {
        try {
            setLoading(true);
            setCheques(await listCheques());
        } catch (error) {
            console.error(error);
            toast.error("Could not load the cheque register");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const resetForm = () => {
        setChequeNumber("");
        setPartyName("");
        setBankName("");
        setBranchName("");
        setChequeDate(today());
        setAmount("");
        setNotes("");
    };

    const handleAdd = async () => {
        const input: NewChequeInput = {
            chequeNumber,
            direction,
            partyName,
            bankName,
            branchName,
            chequeDate,
            amount: Number(amount) || 0,
            notes,
        };
        try {
            setSaving(true);
            setCheques(await addCheque(input));
            toast.success("Cheque registered");
            resetForm();
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Could not register the cheque");
        } finally {
            setSaving(false);
        }
    };

    const handleDeposit = async (cheque: ChequeRecord) => {
        const account = window.prompt("Bank account name for this deposit", "Current Account");
        if (!account) return;
        try {
            const { cheques: next, result } = await advanceCheque(cheque.id, "deposited", {
                targetBankAccountId: `acc_${account.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
                targetBankAccountName: account,
            });
            setCheques(next);
            toast.success(result.ledgerEffect.description || "Cheque deposited");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Could not deposit the cheque");
        }
    };

    const handleClear = async (cheque: ChequeRecord) => {
        try {
            const { cheques: next, result } = await advanceCheque(cheque.id, "cleared");
            setCheques(next);
            toast.success(result.ledgerEffect.description || "Cheque cleared");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Could not clear the cheque");
        }
    };

    const handleBounce = async (cheque: ChequeRecord) => {
        const reason = window.prompt("Bounce reason", "Insufficient funds");
        if (!reason) return;
        try {
            const { cheques: next, result } = await advanceCheque(cheque.id, "bounced", {
                bounceReason: reason,
                bouncePenaltyCharge: 0,
            });
            setCheques(next);
            toast.success(result.ledgerEffect.description || "Cheque marked bounced");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Could not mark the cheque bounced");
        }
    };

    const handleCancel = async (cheque: ChequeRecord) => {
        try {
            const { cheques: next } = await advanceCheque(cheque.id, "cancelled");
            setCheques(next);
            toast.success("Cheque cancelled");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Could not cancel the cheque");
        }
    };

    const handleDelete = async (cheque: ChequeRecord) => {
        if (!confirm(`Delete cheque ${cheque.chequeNumber}?`)) return;
        try {
            setCheques(await deleteCheque(cheque.id));
            toast.success("Cheque deleted");
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Could not delete the cheque");
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Cheque Register" subtitle="Post-dated cheques, deposit, clearing and bounce" />

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <Card className="bg-card">
                        <CardContent className="pt-5">
                            <p className="text-xs text-muted-foreground">In hand</p>
                            <p className="text-lg font-semibold font-mono">{formatINR(summary.openInHandAmount)}</p>
                            <p className="text-[11px] text-muted-foreground">{summary.openInHandCount} cheques</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card">
                        <CardContent className="pt-5">
                            <p className="text-xs text-muted-foreground">PDC due</p>
                            <p className="text-lg font-semibold font-mono">{formatINR(summary.pdcAmount)}</p>
                            <p className="text-[11px] text-muted-foreground">{summary.pdcCount} post-dated</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card">
                        <CardContent className="pt-5">
                            <p className="text-xs text-muted-foreground">Pending clearing</p>
                            <p className="text-lg font-semibold font-mono">{formatINR(summary.depositedPendingAmount)}</p>
                            <p className="text-[11px] text-muted-foreground">{summary.depositedPendingCount} deposited</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card">
                        <CardContent className="pt-5">
                            <p className="text-xs text-muted-foreground">Bounced</p>
                            <p className="text-lg font-semibold font-mono">{formatINR(summary.bouncedAmount)}</p>
                            <p className="text-[11px] text-muted-foreground">{summary.bouncedCount} dishonoured</p>
                        </CardContent>
                    </Card>
                    <Card className="bg-card">
                        <CardContent className="pt-5">
                            <p className="text-xs text-muted-foreground">Stale (90d+)</p>
                            <p className="text-lg font-semibold font-mono">{formatINR(summary.staleAmount)}</p>
                            <p className="text-[11px] text-muted-foreground">{summary.staleCount} past validity</p>
                        </CardContent>
                    </Card>
                </div>

                <Card className="bg-card">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Plus className="w-4 h-4" /> Register a cheque
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="space-y-1">
                                <Label>Cheque number</Label>
                                <Input value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} maxLength={6} placeholder="123456" className="font-mono" />
                            </div>
                            <div className="space-y-1">
                                <Label>Direction</Label>
                                <Select value={direction} onValueChange={(value) => setDirection((value ?? "received") as ChequeDirection)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="received">Received from customer</SelectItem>
                                        <SelectItem value="issued">Issued to supplier</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label>Party</Label>
                                <Input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="Asha Traders" />
                            </div>
                            <div className="space-y-1">
                                <Label>Bank</Label>
                                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="HDFC Bank" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="space-y-1">
                                <Label>Branch</Label>
                                <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Optional" />
                            </div>
                            <div className="space-y-1">
                                <Label>Cheque date</Label>
                                <Input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <Label>Amount</Label>
                                <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                                <Label>Notes</Label>
                                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={resetForm}>Clear</Button>
                            <Button onClick={handleAdd} disabled={saving}>
                                <CalendarClock className="w-4 h-4 mr-2" />
                                {saving ? "Saving..." : "Register cheque"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-card">
                    <CardHeader>
                        <CardTitle className="text-base">Register</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <p className="text-sm text-muted-foreground">Loading...</p>
                        ) : cheques.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No cheques registered.</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Cheque</TableHead>
                                        <TableHead>Party</TableHead>
                                        <TableHead>Bank</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead className="text-right">Maturity</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {cheques.map((cheque) => {
                                        const maturity = maturityOf(cheque);
                                        return (
                                            <TableRow key={cheque.id}>
                                                <TableCell className="font-mono text-xs">{cheque.chequeNumber}</TableCell>
                                                <TableCell>
                                                    <div>{cheque.partyName}</div>
                                                    <div className="text-[11px] text-muted-foreground">{cheque.direction === "received" ? "received" : "issued"}</div>
                                                </TableCell>
                                                <TableCell className="text-xs">{cheque.bankName}</TableCell>
                                                <TableCell className="font-mono text-xs">{cheque.chequeDate}</TableCell>
                                                <TableCell className="text-right text-xs">
                                                    <span className={maturity.isStale ? "text-red-400" : maturity.isMature ? "text-amber-400" : "text-muted-foreground"}>
                                                        {maturity.statusLabel}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right font-mono">{formatINR(cheque.amount)}</TableCell>
                                                <TableCell>
                                                    <Badge className={STATUS_STYLES[cheque.status] || STATUS_STYLES.cancelled}>
                                                        {cheque.status}
                                                    </Badge>
                                                    {cheque.bounceReason && (
                                                        <div className="text-[10px] text-red-400 mt-1">{cheque.bounceReason}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        {cheque.status === "open" && (
                                                            <Button variant="ghost" size="sm" onClick={() => handleDeposit(cheque)}>Deposit</Button>
                                                        )}
                                                        {cheque.status === "deposited" && (
                                                            <Button variant="ghost" size="sm" onClick={() => handleClear(cheque)}>Clear</Button>
                                                        )}
                                                        {(cheque.status === "open" || cheque.status === "deposited") && (
                                                            <>
                                                                <Button variant="ghost" size="sm" onClick={() => handleBounce(cheque)}>Bounce</Button>
                                                                <Button variant="ghost" size="sm" onClick={() => handleCancel(cheque)}>Cancel</Button>
                                                            </>
                                                        )}
                                                        <Button variant="ghost" size="sm" onClick={() => handleDelete(cheque)}>
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
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
