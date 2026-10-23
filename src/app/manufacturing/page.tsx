"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Hammer, Plus, Trash2 } from "lucide-react";
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
    computeKarigarJobCost,
    deleteKarigarJob,
    listKarigarJobs,
    saveKarigarJob,
    setKarigarJobStatus,
    type KarigarJobInput,
    type KarigarJobRecord,
} from "@/lib/manufacturing-jobs";

const PURITIES = ["24K", "22K", "18K", "916", "750"];

function toNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export default function ManufacturingPage() {
    const [jobs, setJobs] = useState<KarigarJobRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [karigarName, setKarigarName] = useState("");
    const [productName, setProductName] = useState("");
    const [metalGrams, setMetalGrams] = useState("");
    const [purityKarat, setPurityKarat] = useState("22K");
    const [ratePerGram, setRatePerGram] = useState("");
    const [finishedNetGrams, setFinishedNetGrams] = useState("");
    const [scrapGrams, setScrapGrams] = useState("");
    const [labour, setLabour] = useState("");
    const [hallmarking, setHallmarking] = useState("");
    const [finishing, setFinishing] = useState("");
    const [logistics, setLogistics] = useState("");
    const [certification, setCertification] = useState("");
    const [tolerancePercent, setTolerancePercent] = useState("1");
    const [notes, setNotes] = useState("");

    const input: KarigarJobInput = useMemo(() => ({
        karigarName,
        productName,
        metalGrams: toNumber(metalGrams),
        purityKarat,
        ratePerGram: toNumber(ratePerGram),
        finishedNetGrams: toNumber(finishedNetGrams),
        scrapGrams: toNumber(scrapGrams),
        labour: toNumber(labour),
        hallmarking: toNumber(hallmarking),
        finishing: toNumber(finishing),
        logistics: toNumber(logistics),
        certification: toNumber(certification),
        tolerancePercent: toNumber(tolerancePercent) || 1,
        notes,
    }), [
        karigarName, productName, metalGrams, purityKarat, ratePerGram,
        finishedNetGrams, scrapGrams, labour, hallmarking, finishing,
        logistics, certification, tolerancePercent, notes,
    ]);

    const cost = useMemo(() => computeKarigarJobCost(input), [input]);
    const canSave = karigarName.trim().length > 0 && productName.trim().length > 0 && input.metalGrams > 0;

    const load = async () => {
        try {
            setLoading(true);
            setJobs(await listKarigarJobs());
        } catch (error) {
            console.error(error);
            toast.error("Could not load karigar jobs");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const resetForm = () => {
        setKarigarName("");
        setProductName("");
        setMetalGrams("");
        setRatePerGram("");
        setFinishedNetGrams("");
        setScrapGrams("");
        setLabour("");
        setHallmarking("");
        setFinishing("");
        setLogistics("");
        setCertification("");
        setNotes("");
    };

    const handleSave = async () => {
        if (!canSave) {
            toast.error("Karigar, piece and metal issued are required");
            return;
        }
        try {
            setSaving(true);
            setJobs(await saveKarigarJob(input));
            toast.success("Job card saved");
            resetForm();
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Could not save the job");
        } finally {
            setSaving(false);
        }
    };

    const handleStatus = async (job: KarigarJobRecord) => {
        try {
            const next = job.status === "completed" ? "in_progress" : "completed";
            setJobs(await setKarigarJobStatus(job.id, next));
        } catch (error) {
            console.error(error);
            toast.error("Could not update the job");
        }
    };

    const handleDelete = async (job: KarigarJobRecord) => {
        if (!confirm(`Delete job ${job.jobNumber}?`)) return;
        try {
            setJobs(await deleteKarigarJob(job.id));
            toast.success("Job deleted");
        } catch (error) {
            console.error(error);
            toast.error("Could not delete the job");
        }
    };

    const reconciliation = cost.reconciliation;

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Karigar Jobs" subtitle="Metal issued, making charges and loss reconciliation" />

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <Card className="xl:col-span-2 bg-card">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Plus className="w-4 h-4" /> New job card
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <Label>Karigar / Artisan</Label>
                                    <Input value={karigarName} onChange={(e) => setKarigarName(e.target.value)} placeholder="Ramesh Soni" />
                                </div>
                                <div className="space-y-1">
                                    <Label>Piece description</Label>
                                    <Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Gold ring, 2 stone" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                    <Label>Metal issued (g)</Label>
                                    <Input type="number" step="0.001" value={metalGrams} onChange={(e) => setMetalGrams(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Purity</Label>
                                    <Select value={purityKarat} onValueChange={(value) => setPurityKarat(value ?? "22K")}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {PURITIES.map((purity) => (
                                                <SelectItem key={purity} value={purity}>{purity}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Rate per gram</Label>
                                    <Input type="number" step="0.01" value={ratePerGram} onChange={(e) => setRatePerGram(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Finished net (g)</Label>
                                    <Input type="number" step="0.001" value={finishedNetGrams} onChange={(e) => setFinishedNetGrams(e.target.value)} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                    <Label>Scrap recovered (g)</Label>
                                    <Input type="number" step="0.001" value={scrapGrams} onChange={(e) => setScrapGrams(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Labour (ac1)</Label>
                                    <Input type="number" step="0.01" value={labour} onChange={(e) => setLabour(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Hallmarking (ac2)</Label>
                                    <Input type="number" step="0.01" value={hallmarking} onChange={(e) => setHallmarking(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Finishing (ac3)</Label>
                                    <Input type="number" step="0.01" value={finishing} onChange={(e) => setFinishing(e.target.value)} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                    <Label>Logistics (ac4)</Label>
                                    <Input type="number" step="0.01" value={logistics} onChange={(e) => setLogistics(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Certification (ac5)</Label>
                                    <Input type="number" step="0.01" value={certification} onChange={(e) => setCertification(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Loss tolerance %</Label>
                                    <Input type="number" step="0.1" value={tolerancePercent} onChange={(e) => setTolerancePercent(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label>Notes</Label>
                                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <Button variant="outline" onClick={resetForm}>Clear</Button>
                                <Button onClick={handleSave} disabled={!canSave || saving}>
                                    <Hammer className="w-4 h-4 mr-2" />
                                    {saving ? "Saving..." : "Save job card"}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card h-fit">
                        <CardHeader>
                            <CardTitle className="text-base">Costing</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Metal cost</span>
                                <span className="font-mono">{formatINR(cost.rawMaterialCost)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Making &amp; other charges</span>
                                <span className="font-mono">{formatINR(cost.additionalCosts)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Scrap credit</span>
                                <span className="font-mono text-emerald-500">-{formatINR(cost.scrapCredit)}</span>
                            </div>
                            <div className="flex justify-between border-t pt-3 text-base font-semibold">
                                <span>Net cost</span>
                                <span className="font-mono">{formatINR(cost.netProductionCost)}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Per finished gram</span>
                                <span className="font-mono">{formatINR(cost.perGramCost)}</span>
                            </div>

                            <div className="rounded-lg border p-3 mt-2 space-y-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Melting loss</span>
                                    <span className="font-mono text-xs">{reconciliation.meltingLossPercent}%</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Allowed</span>
                                    <span className="font-mono text-xs">{reconciliation.allowedLossGrams.toFixed(3)}g</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Actual</span>
                                    <span className="font-mono text-xs">{reconciliation.unrecoveredMeltingLossGrams.toFixed(3)}g</span>
                                </div>
                                {reconciliation.isWithinTolerance ? (
                                    <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/40">
                                        <CheckCircle className="w-3 h-3 mr-1" /> Within tolerance
                                    </Badge>
                                ) : (
                                    <Badge className="bg-red-600/20 text-red-400 border-red-600/40">
                                        <AlertTriangle className="w-3 h-3 mr-1" /> Excess {reconciliation.varianceGrams.toFixed(3)}g
                                    </Badge>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card className="bg-card">
                    <CardHeader>
                        <CardTitle className="text-base">Job cards</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <p className="text-sm text-muted-foreground">Loading...</p>
                        ) : jobs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No job cards yet.</p>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Job</TableHead>
                                        <TableHead>Karigar</TableHead>
                                        <TableHead>Piece</TableHead>
                                        <TableHead className="text-right">Metal (g)</TableHead>
                                        <TableHead className="text-right">Net cost</TableHead>
                                        <TableHead className="text-right">Loss %</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {jobs.map((job) => (
                                        <TableRow key={job.id}>
                                            <TableCell className="font-mono text-xs">{job.jobNumber}</TableCell>
                                            <TableCell>{job.karigarName}</TableCell>
                                            <TableCell>{job.productName}</TableCell>
                                            <TableCell className="text-right font-mono">{job.metalGrams}</TableCell>
                                            <TableCell className="text-right font-mono">{formatINR(job.cost.netProductionCost)}</TableCell>
                                            <TableCell className="text-right font-mono">{job.cost.reconciliation.meltingLossPercent}</TableCell>
                                            <TableCell>
                                                <Badge variant={job.status === "completed" ? "default" : "secondary"}>
                                                    {job.status === "completed" ? "Completed" : "In progress"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="ghost" size="sm" onClick={() => handleStatus(job)}>
                                                        {job.status === "completed" ? "Reopen" : "Complete"}
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(job)}>
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
