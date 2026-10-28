"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Loader2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Category } from "@/lib/categories";
import { createDraftProduct } from "@/lib/quick-product";
import {
    computeRulePrice,
    loadConfiguredChannels,
    type ChannelPricingRule,
} from "@/lib/channel-pricing";

interface PasteProductsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    categories: Category[];
    existingSkus: string[];
    onImported: () => void;
}

interface ParsedRow {
    name: string;
    category: string;
    cost: number;
    stock: number;
    selling: number;
    description: string;
    imageUrl: string;
    craft: string;
    error?: string;
}

const SAMPLE = `Malar temple jhumkas\tEarrings\t420\t6\t\t\t
Nila heritage bangles\tBangles\t380\t12\t\t\t
Kemp pendant\tNecklaces\t650\t3\t1899\tKemp stones in gold tone\thttps://…`;

function splitRow(line: string): string[] {
    if (line.includes("\t")) return line.split("\t");
    // Minimal CSV support: split on commas outside double quotes.
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (const char of line) {
        if (char === '"') {
            quoted = !quoted;
        } else if (char === "," && !quoted) {
            cells.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells;
}

function parseRows(text: string): ParsedRow[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => !/^name\s*[\t,]/i.test(line))
        .map((line) => {
            const cells = splitRow(line).map((cell) => cell.trim().replace(/^"|"$/g, ""));
            const [name, category, cost, stock, selling, description, imageUrl, craft] = cells;
            const row: ParsedRow = {
                name: name || "",
                category: category || "Uncategorized",
                cost: parseFloat(cost || "0") || 0,
                stock: parseInt(stock || "0", 10) || 0,
                selling: parseFloat(selling || "0") || 0,
                description: description || "",
                imageUrl: imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : "",
                craft: craft || "",
            };
            if (!row.name) row.error = "Name is required";
            else if (row.cost <= 0 && row.selling <= 0) row.error = "Cost or selling price is required";
            return row;
        });
}

export function PasteProductsDialog({
    open,
    onOpenChange,
    categories,
    existingSkus,
    onImported,
}: PasteProductsDialogProps) {
    const [text, setText] = useState("");
    const [saving, setSaving] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [failures, setFailures] = useState(0);
    const [shopRule, setShopRule] = useState<ChannelPricingRule | undefined>();

    useEffect(() => {
        if (!open) return;
        loadConfiguredChannels()
            .then((channels) => {
                const shop = channels.find(
                    (channel) => channel.id === "pos" || channel.id === "shop"
                );
                setShopRule(shop?.pricingRule);
            })
            .catch(console.error);
    }, [open]);

    const rows = useMemo(
        () =>
            parseRows(text).map((row) => {
                if (row.error || row.selling > 0) return row;
                const rulePrice = computeRulePrice(row.cost, shopRule);
                if (rulePrice && rulePrice > 0) {
                    return { ...row, selling: rulePrice };
                }
                return {
                    ...row,
                    error: "Add a selling price or configure a Shop cost rule",
                };
            }),
        [text, shopRule]
    );
    const validRows = rows.filter((row) => !row.error);
    const invalidRows = rows.filter((row) => Boolean(row.error));

    const close = () => {
        if (saving) return;
        setText("");
        setFailures(0);
        setProgress({ done: 0, total: 0 });
        onOpenChange(false);
    };

    const commit = async () => {
        if (validRows.length === 0) return;
        setSaving(true);
        setFailures(0);
        setProgress({ done: 0, total: validRows.length });

        const knownSkus = [...existingSkus];
        const knownCategories = [...categories];
        let failed = 0;

        for (let index = 0; index < validRows.length; index++) {
            const row = validRows[index];
            try {
                const result = await createDraftProduct({
                    name: row.name,
                    categoryName: row.category,
                    categories: knownCategories,
                    costPrice: row.cost,
                    sellingPrice: row.selling,
                    stock: row.stock,
                    description: row.description,
                    imageUrl: row.imageUrl || undefined,
                    craft: row.craft,
                    existingSkus: knownSkus,
                });
                knownSkus.push(result.sku);
                if (result.createdCategory) knownCategories.push(result.createdCategory);
            } catch (error) {
                console.error("Paste import row failed:", row.name, error);
                failed += 1;
            }
            setFailures(failed);
            setProgress({ done: index + 1, total: validRows.length });
        }

        setSaving(false);
        const created = validRows.length - failed;
        if (created > 0) {
            toast.success(`${created} draft${created === 1 ? "" : "s"} added to inventory`);
            onImported();
        }
        if (failed === 0) {
            close();
        } else {
            toast.error(`${failed} row${failed === 1 ? "" : "s"} failed. Check the console for details.`);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && (next ? onOpenChange(true) : close())}>
            <DialogContent className="max-w-2xl bg-surface-navy/98 backdrop-blur-2xl border-surface-hover/80 text-white max-h-[min(92vh,calc(100dvh-1.5rem))] overflow-y-auto p-5 shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base font-bold text-white">
                        <ClipboardPaste size={18} className="text-primary" />
                        Paste a product list
                    </DialogTitle>
                    <p className="text-[11px] text-moonstone leading-relaxed">
                        Copy rows straight from Excel or Sheets. Columns: name, category,
                        cost, stock, selling (optional), description, image URL, craft.
                        Everything is created as a draft.
                    </p>
                </DialogHeader>

                <div className="space-y-3 pt-1">
                    <textarea
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        rows={8}
                        spellCheck={false}
                        placeholder={SAMPLE}
                        className="w-full rounded-lg border border-surface-hover/80 bg-bg-navy p-3 font-mono text-[11px] leading-relaxed text-white placeholder:text-moonstone/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />

                    {rows.length > 0 && (
                        <div className="rounded-lg border border-surface-hover/70 bg-bg-navy/50 overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-surface-hover/50 text-[11px]">
                                <span className="text-moonstone">
                                    {validRows.length} ready
                                    {invalidRows.length > 0 ? ` • ${invalidRows.length} with errors` : ""}
                                </span>
                                {saving && (
                                    <span className="font-mono text-primary">
                                        {progress.done}/{progress.total}
                                    </span>
                                )}
                            </div>
                            <div className="max-h-48 overflow-y-auto divide-y divide-surface-hover/30">
                                {rows.slice(0, 50).map((row, index) => (
                                    <div key={`${row.name}-${index}`} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                                        {row.error ? (
                                            <AlertCircle size={12} className="text-amber-400 shrink-0" />
                                        ) : (
                                            <Check size={12} className="text-emerald-400 shrink-0" />
                                        )}
                                        <span className="flex-1 truncate text-white">{row.name || "—"}</span>
                                        <span className="text-moonstone truncate max-w-[110px]">{row.category}</span>
                                        <span className="font-mono text-moonstone">
                                            {row.cost > 0 ? `₹${row.cost}` : row.selling > 0 ? `₹${row.selling}` : "—"}
                                        </span>
                                        <span className="font-mono text-moonstone w-12 text-right">
                                            {row.stock}
                                        </span>
                                        {row.error && (
                                            <span className="text-amber-300 truncate max-w-[140px]">{row.error}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <p className="text-[10px] text-moonstone">
                            Sizes are generated for bangles and rings; SKUs are assigned
                            automatically.
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={close}
                                disabled={saving}
                                className="h-9 text-xs text-moonstone hover:text-white"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={() => void commit()}
                                disabled={saving || validRows.length === 0}
                                className="h-9 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90"
                            >
                                {saving ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" />
                                        Adding {progress.done}/{progress.total}…
                                    </>
                                ) : (
                                    <>Add {validRows.length || ""} draft{validRows.length === 1 ? "" : "s"}</>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
