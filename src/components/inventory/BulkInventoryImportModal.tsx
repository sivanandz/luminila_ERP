"use client";

import React, { useState, useRef } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Upload,
    Download,
    FileSpreadsheet,
    CheckCircle2,
    AlertCircle,
    X,
    Loader2,
    RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
    parseInventoryImportFile,
    commitBulkInventoryImport,
    ParsedImportResult,
} from "@/lib/excel-import";

interface BulkInventoryImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImportSuccess: () => void;
    defaultPoReference?: string;
}

export function BulkInventoryImportModal({
    isOpen,
    onClose,
    onImportSuccess,
    defaultPoReference,
}: BulkInventoryImportModalProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [parseResult, setParseResult] = useState<ParsedImportResult | null>(null);
    const [isCommitting, setIsCommitting] = useState(false);
    const [activeTab, setActiveTab] = useState<"valid" | "errors">("valid");
    const [poReference, setPoReference] = useState<string>(defaultPoReference || "");

    // Synchronize defaultPoReference when modal opens or prop changes
    React.useEffect(() => {
        if (defaultPoReference) {
            setPoReference(defaultPoReference);
        }
    }, [defaultPoReference, isOpen]);

    const resetState = () => {
        setSelectedFile(null);
        setParseResult(null);
        setIsParsing(false);
        setIsCommitting(false);
        setActiveTab("valid");
        setPoReference(defaultPoReference || "");
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleDialogClose = (open: boolean) => {
        if (!open && !isCommitting) {
            resetState();
            onClose();
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setSelectedFile(file);
        setIsParsing(true);
        setParseResult(null);

        try {
            const buffer = await file.arrayBuffer();
            const result = await parseInventoryImportFile(buffer, file.name);
            setParseResult(result);
            if (result.validRows.length > 0) {
                setActiveTab("valid");
            } else if (result.invalidRows.length > 0) {
                setActiveTab("errors");
            }
        } catch (err: any) {
            console.error("Parse error:", err);
            toast.error(err.message || "Failed to parse the uploaded file.");
            resetState();
        } finally {
            setIsParsing(false);
        }
    };

    const handleCommit = async () => {
        if (!parseResult || parseResult.validRows.length === 0) return;

        setIsCommitting(true);
        try {
            const effectivePoRef = poReference.trim() || undefined;
            const result = await commitBulkInventoryImport(parseResult.validRows, effectivePoRef);
            if (result.successCount > 0) {
                toast.success(
                    `Successfully imported ${result.successCount} product(s) into inventory!`
                );

                // Report PO Reconciliations & Discrepancies
                if (result.reconciledPOs && result.reconciledPOs.length > 0) {
                    for (const rec of result.reconciledPOs) {
                        const inwardStr = rec.inwardGoodsCost ? `₹${rec.inwardGoodsCost.toLocaleString("en-IN")}` : "";
                        const budgetStr = rec.budgetAmount ? `₹${rec.budgetAmount.toLocaleString("en-IN")}` : "";
                        if (rec.discrepancyStatus === "over_budget") {
                            toast.error(
                                `PO ${rec.poNumber} Budget Exceeded! Inward: ${inwardStr} vs Budget: ${budgetStr} (Variance: ₹${rec.discrepancyAmount.toLocaleString("en-IN")}). Discrepancy flagged for manager approval.`,
                                { duration: 9000 }
                            );
                        } else if (rec.discrepancyStatus === "under_budget") {
                            toast.warning(
                                `PO ${rec.poNumber} Under Budget: Inward: ${inwardStr} of ${budgetStr} (Remaining: ₹${rec.discrepancyAmount.toLocaleString("en-IN")}). Pending manager review.`,
                                { duration: 7000 }
                            );
                        } else {
                            toast.success(`PO ${rec.poNumber} reconciled perfectly with inward goods!`);
                        }
                    }
                }

                onImportSuccess();
                handleDialogClose(false);
            }
            if (result.failureCount > 0) {
                toast.error(
                    `${result.failureCount} row(s) failed database insertion. Check console for details.`
                );
            }
        } catch (err: any) {
            console.error("Commit error:", err);
            toast.error("Bulk import failed: " + (err.message || String(err)));
        } finally {
            setIsCommitting(false);
        }
    };

    const handleDownloadTemplate = () => {
        window.open("/api/inventory/template", "_blank");
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleDialogClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-white text-slate-900 shadow-2xl">
                {/* Header */}
                <DialogHeader className="p-5 border-b border-slate-100 bg-slate-50/70">
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-900">
                                <FileSpreadsheet className="text-teal-600" size={22} />
                                Bulk Inventory Upload
                            </DialogTitle>
                            <DialogDescription className="text-xs text-slate-500 mt-1">
                                Upload products via Excel (.xlsx) or CSV format. Download the official template anytime.
                            </DialogDescription>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDownloadTemplate}
                            className="bg-white border-teal-200 text-teal-700 hover:bg-teal-50 flex items-center gap-1.5 shadow-sm text-xs font-semibold"
                        >
                            <Download size={14} />
                            Download Excel Template
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                    {/* Purchase Order Linking Bar */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 shrink-0">
                                📦 Tag to Purchase Order:
                            </span>
                            <input
                                type="text"
                                value={poReference}
                                onChange={(e) => setPoReference(e.target.value.toUpperCase())}
                                placeholder="e.g. PO-SRIM-20261019-180532"
                                className="text-xs font-mono font-semibold px-2.5 py-1 bg-white border border-slate-300 rounded text-teal-800 placeholder:text-slate-400 placeholder:font-sans focus:outline-none focus:ring-1 focus:ring-teal-500 w-60 uppercase"
                            />
                        </div>
                        {poReference.trim() ? (
                            <span className="text-[11px] font-medium text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-md">
                                ⚡ Linked to PO: <strong className="font-mono">{poReference.trim()}</strong> (Landed cost & discrepancy reconciliation active)
                            </span>
                        ) : (
                            <span className="text-[11px] text-slate-400">
                                Optional: Tag all items to a Blanket PO or let sheet rows specify PO numbers
                            </span>
                        )}
                    </div>

                    {/* Upload Box if no file selected */}
                    {!selectedFile && (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-slate-200 hover:border-teal-500 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all bg-slate-50/50 hover:bg-teal-50/30 group"
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                            />
                            <div className="w-12 h-12 rounded-full bg-teal-100/70 text-teal-700 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                <Upload size={24} />
                            </div>
                            <p className="font-semibold text-slate-800 text-sm">
                                Click to browse or drag and drop your spreadsheet
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                                Supports Excel workbooks (.xlsx, .xls) and standard CSV files
                            </p>
                            <div className="mt-4 flex items-center gap-2 text-xs text-teal-600 bg-teal-50 px-3 py-1.5 rounded-full border border-teal-100">
                                <FileSpreadsheet size={14} />
                                <span>Includes Jewelry specs: Gross/Net Weight, Purity, Material, HSN & Locations</span>
                            </div>
                        </div>
                    )}

                    {/* Parsing Indicator */}
                    {isParsing && (
                        <div className="p-8 flex flex-col items-center justify-center text-center">
                            <Loader2 className="animate-spin text-teal-600 mb-2" size={32} />
                            <p className="text-sm font-semibold text-slate-700">Validating spreadsheet rows...</p>
                            <p className="text-xs text-slate-400">Verifying prices, stocks, and jewelry specifications</p>
                        </div>
                    )}

                    {/* Parsed Results Overview */}
                    {parseResult && !isParsing && (
                        <div className="flex flex-col gap-3">
                            {/* File summary bar */}
                            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-3">
                                <div className="flex items-center gap-2">
                                    <FileSpreadsheet className="text-teal-600" size={18} />
                                    <span className="text-xs font-semibold text-slate-800">
                                        {selectedFile?.name}
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                        ({parseResult.totalRows} row{parseResult.totalRows === 1 ? "" : "s"} processed)
                                    </span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={resetState}
                                    disabled={isCommitting}
                                    className="h-7 text-xs text-slate-500 hover:text-red-600"
                                >
                                    <X size={14} className="mr-1" /> Remove File
                                </Button>
                            </div>

                            {/* Summary Chips & Tabs */}
                            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab("valid")}
                                        className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                                            activeTab === "valid"
                                                ? "bg-teal-600 text-white shadow-sm"
                                                : "text-slate-600 hover:bg-slate-100"
                                        }`}
                                    >
                                        <CheckCircle2 size={14} />
                                        Ready to Import ({parseResult.validRows.length})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab("errors")}
                                        className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                                            activeTab === "errors"
                                                ? "bg-rose-600 text-white shadow-sm"
                                                : "text-slate-600 hover:bg-slate-100"
                                        }`}
                                    >
                                        <AlertCircle size={14} />
                                        Validation Issues ({parseResult.invalidRows.length})
                                    </button>
                                </div>
                                <span className="text-[11px] text-slate-400">
                                    {parseResult.validRows.length} valid • {parseResult.invalidRows.length} errors
                                </span>
                            </div>

                            {/* Tab Content: Valid Rows Table */}
                            {activeTab === "valid" && (
                                <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                                    {parseResult.validRows.length === 0 ? (
                                        <div className="p-8 text-center text-xs text-slate-400">
                                            No valid rows found in this sheet. Please check the validation issues tab.
                                        </div>
                                    ) : (
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-slate-600 font-semibold">
                                                <tr>
                                                    <th className="p-2.5">Row</th>
                                                    <th className="p-2.5">Product Name</th>
                                                    <th className="p-2.5">SKU</th>
                                                    <th className="p-2.5">PO Ref</th>
                                                    <th className="p-2.5">Category</th>
                                                    <th className="p-2.5 text-right">Selling Price</th>
                                                    <th className="p-2.5 text-right">Stock</th>
                                                    <th className="p-2.5">Purity / Metal</th>
                                                    <th className="p-2.5 text-right">Net Wt (g)</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 text-slate-700">
                                                {parseResult.validRows.map((row) => (
                                                    <tr key={row.rowNumber} className="hover:bg-slate-50/70">
                                                        <td className="p-2.5 text-slate-400 font-mono text-[11px]">
                                                             #{row.rowNumber}
                                                        </td>
                                                        <td className="p-2.5 font-medium text-slate-900">
                                                            {row.name}
                                                        </td>
                                                        <td className="p-2.5 font-mono text-[11px] text-slate-500">
                                                            {row.sku || <span className="text-slate-400 italic">Auto-SKU</span>}
                                                        </td>
                                                        <td className="p-2.5 font-mono text-[11px] text-teal-700 font-semibold">
                                                            {row.po_reference || (poReference.trim() ? poReference.trim() : "—")}
                                                        </td>
                                                        <td className="p-2.5">
                                                            <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px]">
                                                                {row.category}
                                                            </span>
                                                        </td>
                                                        <td className="p-2.5 text-right font-medium text-slate-900">
                                                            ₹{row.base_price.toLocaleString("en-IN")}
                                                        </td>
                                                        <td className="p-2.5 text-right font-semibold text-teal-700">
                                                            {row.stock}
                                                        </td>
                                                        <td className="p-2.5 text-slate-600 text-[11px]">
                                                            {row.purity || row.material || "—"}
                                                        </td>
                                                        <td className="p-2.5 text-right text-slate-600 text-[11px]">
                                                            {row.net_weight ? `${row.net_weight}g` : "—"}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            )}

                            {/* Tab Content: Errors Table */}
                            {activeTab === "errors" && (
                                <div className="border border-rose-100 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                                    {parseResult.invalidRows.length === 0 ? (
                                        <div className="p-8 text-center text-xs text-emerald-600 flex items-center justify-center gap-2">
                                            <CheckCircle2 size={16} /> All rows passed validation perfectly!
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-rose-50">
                                            {parseResult.invalidRows.map((errRow) => (
                                                <div
                                                    key={errRow.rowNumber}
                                                    className="p-3 bg-rose-50/30 hover:bg-rose-50/60 flex flex-col gap-1 text-xs"
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <span className="bg-rose-100 text-rose-800 font-mono text-[10px] px-1.5 py-0.5 rounded font-bold">
                                                                Row #{errRow.rowNumber}
                                                            </span>
                                                            <span className="font-semibold text-slate-800">
                                                                {errRow.name || "Missing Name"}
                                                            </span>
                                                            {errRow.sku && (
                                                                <span className="font-mono text-slate-400 text-[10px]">
                                                                    ({errRow.sku})
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[11px] font-semibold text-rose-600">
                                                            {errRow.errors.length} issue(s)
                                                        </span>
                                                    </div>
                                                    <ul className="list-disc list-inside text-rose-700 text-[11px] space-y-0.5 pl-1">
                                                        {errRow.errors.map((e, idx) => (
                                                            <li key={idx}>{e}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                    <div className="text-[11px] text-slate-500">
                        {parseResult?.validRows.length ? (
                            <span>
                                Ready to add <strong>{parseResult.validRows.length}</strong> items to catalog & inventory.
                            </span>
                        ) : (
                            <span>Download template, fill in items, and upload to bulk add.</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            onClick={() => handleDialogClose(false)}
                            disabled={isCommitting}
                            className="text-xs"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCommit}
                            disabled={!parseResult || parseResult.validRows.length === 0 || isCommitting}
                            className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold flex items-center gap-1.5"
                        >
                            {isCommitting ? (
                                <>
                                    <Loader2 className="animate-spin" size={14} />
                                    Importing Inventory...
                                </>
                            ) : (
                                <>
                                    <Upload size={14} />
                                    Import {parseResult?.validRows.length || 0} Valid Products
                                </>
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
