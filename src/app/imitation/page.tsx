"use client";

import { useMemo, useState } from "react";
import { Copy, Gem, Tag } from "lucide-react";
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
    BASE_METAL_DEFINITIONS,
    CRAFT_DEFINITIONS,
    DEFAULT_WHOLESALE_TIERS,
    OCCASION_DEFINITIONS,
    PLATING_DEFINITIONS,
    calculateWholesalePrice,
    formatImitationSpec,
    generateDumbbellTagPayload,
} from "@/lib/imitation-jewelry-engine";

export default function ImitationStudioPage() {
    const [craft, setCraft] = useState("kundan");
    const [plating, setPlating] = useState("micro_gold_1gm");
    const [occasion, setOccasion] = useState("bridal");
    const [baseMetal, setBaseMetal] = useState("brass");
    const [stoneType, setStoneType] = useState("");
    const [sku, setSku] = useState("");
    const [name, setName] = useState("");
    const [mrp, setMrp] = useState("");
    const [quantity, setQuantity] = useState("10");

    const spec = useMemo(() => ({
        craft,
        plating,
        occasion,
        baseMetal,
        stoneType,
        sku,
        name,
        mrpPrice: Number(mrp) || 0,
    }), [craft, plating, occasion, baseMetal, stoneType, sku, name, mrp]);

    const specLine = useMemo(() => formatImitationSpec(spec), [spec]);
    const tag = useMemo(() => generateDumbbellTagPayload(spec), [spec]);

    const durability = PLATING_DEFINITIONS[plating]?.durabilityMonths ?? 0;
    const wholesale = useMemo(
        () => calculateWholesalePrice(Number(mrp) || 0, Number(quantity) || 1),
        [mrp, quantity]
    );

    const copy = async (value: string, what: string) => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(`${what} copied`);
        } catch {
            toast.error("Clipboard is not available");
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="Fashion Jewellery Studio" subtitle="Craft taxonomy, tag payload and wholesale tiers" />

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <Card className="xl:col-span-2 bg-card">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Gem className="w-4 h-4" /> Piece specification
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                    <Label>Craft</Label>
                                    <Select value={craft} onValueChange={(value) => setCraft(value ?? "kundan")}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(CRAFT_DEFINITIONS).map(([key, definition]) => (
                                                <SelectItem key={key} value={key}>{definition.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Plating</Label>
                                    <Select value={plating} onValueChange={(value) => setPlating(value ?? "micro_gold_1gm")}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(PLATING_DEFINITIONS).map(([key, definition]) => (
                                                <SelectItem key={key} value={key}>{definition.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Occasion</Label>
                                    <Select value={occasion} onValueChange={(value) => setOccasion(value ?? "bridal")}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(OCCASION_DEFINITIONS).map(([key, label]) => (
                                                <SelectItem key={key} value={key}>{label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Base metal</Label>
                                    <Select value={baseMetal} onValueChange={(value) => setBaseMetal(value ?? "brass")}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(BASE_METAL_DEFINITIONS).map(([key, label]) => (
                                                <SelectItem key={key} value={key}>{label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                    <Label>SKU</Label>
                                    <Input value={sku} onChange={(event) => setSku(event.target.value)} className="font-mono" placeholder="IM-001" />
                                </div>
                                <div className="space-y-1 col-span-2">
                                    <Label>Piece name</Label>
                                    <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bridal Choker Set" />
                                </div>
                                <div className="space-y-1">
                                    <Label>MRP</Label>
                                    <Input type="number" step="0.01" value={mrp} onChange={(event) => setMrp(event.target.value)} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1 col-span-2">
                                    <Label>Stones</Label>
                                    <Input value={stoneType} onChange={(event) => setStoneType(event.target.value)} placeholder="Kundan stones, CZ, none" />
                                </div>
                                <div className="space-y-1">
                                    <Label>Wholesale quantity</Label>
                                    <Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                                </div>
                                <div className="flex items-end">
                                    <Badge variant="outline" className="mb-2">
                                        plating lasts ~{durability} months
                                    </Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-card h-fit">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Tag className="w-4 h-4" /> Label and tag
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm">
                            <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Specification line</p>
                                <p className="rounded-lg border p-2 text-xs leading-relaxed">{specLine}</p>
                                <Button variant="outline" size="sm" onClick={() => copy(specLine, "Specification")}>
                                    <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy spec
                                </Button>
                            </div>

                            <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Dumbbell tag</p>
                                <div className="rounded-lg border p-2 space-y-1">
                                    <p className="font-mono text-[11px]">A: {tag.wingA.sku} · {tag.wingA.mrp || "MRP -"}</p>
                                    <p className="font-mono text-[11px]">B: {tag.wingB.badge} · {tag.wingB.category || "-"}</p>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => copy(tag.printableBadge, "Tag payload")}>
                                    <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy tag
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card className="bg-card">
                    <CardHeader>
                        <CardTitle className="text-base">Wholesale pricing</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                                <p className="text-xs text-muted-foreground">Unit price</p>
                                <p className="font-mono text-lg">{formatINR(wholesale.unitPrice)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Line total</p>
                                <p className="font-mono text-lg">{formatINR(wholesale.totalAmount)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Tier discount</p>
                                <p className="font-mono text-lg">{wholesale.discountPercentApplied}%</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Customer saves</p>
                                <p className="font-mono text-lg text-emerald-500">{formatINR(wholesale.totalSavings)}</p>
                            </div>
                        </div>

                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Quantity</TableHead>
                                    <TableHead className="text-right">Discount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {DEFAULT_WHOLESALE_TIERS.map((tier) => (
                                    <TableRow key={tier.minQuantity}>
                                        <TableCell className="font-mono text-xs">
                                            {tier.maxQuantity
                                                ? `${tier.minQuantity} to ${tier.maxQuantity}`
                                                : `${tier.minQuantity}+`}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs">{tier.discountPercent}%</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        <p className="text-[11px] text-muted-foreground">
                            The taxonomy classifies and prices a piece; it is not yet stored on the product record,
                            because the products table has no craft or plating columns.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
