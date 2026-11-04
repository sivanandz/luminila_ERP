"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { PackageOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { escapeHtml } from "@/lib/utils";
import { loadPackingLinesForOrder, type PackingLine } from "@/lib/packing";

export interface PackingSlipData {
    orderId?: string;
    orderNumber: string;
    customerName: string;
    customerPhone?: string;
    shippingAddress?: string;
    paymentLabel?: string;
    total?: number;
    lines: PackingLine[];
}

/**
 * Code128 of the exact order number — the station's queue screen resolves a
 * scan of this payload straight back to the order (same bwip-js endpoint the
 * 4x6 shipping label uses).
 */
function slipBarcodeUrl(orderNumber: string): string {
    return `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(orderNumber)}&scale=2&height=10&includetext=true`;
}

function slipHtml(data: PackingSlipData): string {
    const rows = data.lines
        .map(
            (line, index) => `
            <tr>
                <td class="cb">${index + 1}</td>
                <td class="mono">${escapeHtml(line.sku)}</td>
                <td>
                    ${escapeHtml(line.description)}
                    ${line.location ? `<div class="loc">📍 ${escapeHtml(line.location)}</div>` : ""}
                </td>
                <td class="cb">${line.variant_size ? escapeHtml(line.variant_size) : "—"}</td>
                <td class="cb">${line.variant_color ? escapeHtml(line.variant_color) : "—"}</td>
                <td class="cb"><strong>${line.quantity}</strong></td>
                <td class="cb check"></td>
            </tr>`
        )
        .join("");

    return `
        <div class="slip">
            <div class="head">
                <div>
                    <div class="brand">PACKING SLIP</div>
                    <div class="sub">Scan-verified parcel · verify every piece before sealing</div>
                </div>
                <div class="cod">${escapeHtml(data.paymentLabel || "")}</div>
            </div>
            <div class="meta">
                <div>
                    <div class="k">Order</div>
                    <div class="v mono big">${escapeHtml(data.orderNumber)}</div>
                    <div class="k">Consignee</div>
                    <div class="v">${escapeHtml(data.customerName)}${data.customerPhone ? ` · ${escapeHtml(data.customerPhone)}` : ""}</div>
                    ${data.shippingAddress ? `<div class="v small">${escapeHtml(data.shippingAddress).replace(/\n/g, "<br/>")}</div>` : ""}
                </div>
                <div class="barcode">
                    <img src="${slipBarcodeUrl(data.orderNumber)}" alt="${escapeHtml(data.orderNumber)}" />
                </div>
            </div>
            <table>
                <thead>
                    <tr><th>#</th><th>SKU</th><th>Item / Tray</th><th>Size</th><th>Colour</th><th>Qty</th><th>✓</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            ${data.total ? `<div class="total">Order total: ₹${data.total.toLocaleString("en-IN")}</div>` : ""}
        </div>`;
}

/**
 * Opens a print window with the slip.
 */
export function printPackingSlip(data: PackingSlipData): boolean {
    const win = window.open("", "_blank", "width=520,height=700");
    if (!win) return false;
    win.document.write(`<!doctype html><html><head><title>Packing slip ${escapeHtml(data.orderNumber)}</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 16px; }
            .slip { border: 2px solid #000; padding: 14px; max-width: 440px; margin: 0 auto; page-break-after: always; }
            .head { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 6px; }
            .brand { font-size: 16px; font-weight: 900; letter-spacing: 1px; }
            .sub { font-size: 9px; color: #444; margin-top: 2px; }
            .cod { font-size: 10px; font-weight: 900; border: 2px solid #000; padding: 3px 8px; height: fit-content; }
            .meta { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dashed #666; }
            .k { font-size: 8px; text-transform: uppercase; color: #555; font-weight: 700; }
            .v { font-size: 12px; font-weight: 700; }
            .v.big { font-size: 14px; letter-spacing: 0.5px; }
            .v.small { font-size: 10px; font-weight: 400; margin-top: 2px; }
            .mono { font-family: "Courier New", monospace; }
            .loc { font-size: 8.5px; color: #555; font-weight: 600; margin-top: 1px; }
            .barcode img { max-width: 170px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
            th { text-align: left; font-size: 8px; text-transform: uppercase; border-bottom: 1px solid #000; padding: 4px; }
            td { border-bottom: 1px dashed #bbb; padding: 5px 4px; vertical-align: top; }
            td.cb, th.cb { text-align: center; }
            .check { width: 22px; height: 16px; border: 1px solid #000; }
            .total { text-align: right; font-size: 11px; font-weight: 700; margin-top: 6px; }
            @media print { @page { size: A5; margin: 8mm; } .slip { border: 2px solid #000; max-width: none; } }
        </style></head><body>
        ${slipHtml(data)}
        <script>
            window.onload = function () {
                var img = document.querySelector("img");
                var go = function () { window.print(); setTimeout(function () { window.close(); }, 400); };
                if (img && !img.complete) { img.onload = go; setTimeout(go, 4000); } else { go(); }
            };
        </script></body></html>`);
    win.document.close();
    return true;
}

/** Print multiple packing slips in one print dialogue */
export function printBatchPackingSlips(slips: PackingSlipData[]): boolean {
    if (slips.length === 0) return false;
    const win = window.open("", "_blank", "width=520,height=700");
    if (!win) return false;

    const bodyHtml = slips.map((s) => slipHtml(s)).join("<div style='height: 20px;' class='print:hidden'></div>");

    win.document.write(`<!doctype html><html><head><title>Batch Packing Slips (${slips.length})</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 16px; }
            .slip { border: 2px solid #000; padding: 14px; max-width: 440px; margin: 0 auto; page-break-after: always; }
            .head { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 6px; }
            .brand { font-size: 16px; font-weight: 900; letter-spacing: 1px; }
            .sub { font-size: 9px; color: #444; margin-top: 2px; }
            .cod { font-size: 10px; font-weight: 900; border: 2px solid #000; padding: 3px 8px; height: fit-content; }
            .meta { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dashed #666; }
            .k { font-size: 8px; text-transform: uppercase; color: #555; font-weight: 700; }
            .v { font-size: 12px; font-weight: 700; }
            .v.big { font-size: 14px; letter-spacing: 0.5px; }
            .v.small { font-size: 10px; font-weight: 400; margin-top: 2px; }
            .mono { font-family: "Courier New", monospace; }
            .loc { font-size: 8.5px; color: #555; font-weight: 600; margin-top: 1px; }
            .barcode img { max-width: 170px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
            th { text-align: left; font-size: 8px; text-transform: uppercase; border-bottom: 1px solid #000; padding: 4px; }
            td { border-bottom: 1px dashed #bbb; padding: 5px 4px; vertical-align: top; }
            td.cb, th.cb { text-align: center; }
            .check { width: 22px; height: 16px; border: 1px solid #000; }
            .total { text-align: right; font-size: 11px; font-weight: 700; margin-top: 6px; }
            @media print { @page { size: A5; margin: 8mm; } .slip { border: 2px solid #000; max-width: none; } }
        </style></head><body>
        ${bodyHtml}
        <script>
            window.onload = function () {
                window.print();
                setTimeout(function () { window.close(); }, 500);
            };
        </script></body></html>`);
    win.document.close();
    return true;
}

interface PackingSlipButtonProps {
    data: PackingSlipData | null;
    label?: string;
    variant?: "outline" | "ghost" | "default";
    className?: string;
}

/** Small trigger button so the queue rows and the station pane share one slip. */
export function PackingSlipButton({
    data,
    label = "Print slip",
    variant = "outline",
    className,
}: PackingSlipButtonProps) {
    const [fetching, setFetching] = useState(false);
    if (!data) return null;

    const handleClick = async () => {
        let finalData = data;
        if ((!data.lines || data.lines.length === 0) && data.orderId) {
            setFetching(true);
            try {
                const loadedLines = await loadPackingLinesForOrder(data.orderId);
                finalData = { ...data, lines: loadedLines };
            } catch (err) {
                console.error("Failed to load lines for packing slip:", err);
            } finally {
                setFetching(false);
            }
        }

        if (!printPackingSlip(finalData)) {
            toast.error("Allow pop-ups for this site to print the packing slip.");
        }
    };

    return (
        <Button
            type="button"
            variant={variant}
            size="sm"
            disabled={fetching}
            className={className}
            onClick={() => void handleClick()}
            title="Print the scannable packing slip (Code128 of the order number)"
        >
            {fetching ? <Loader2 size={12} className="animate-spin mr-1" /> : <PackageOpen size={13} className="mr-1" />}
            {label}
        </Button>
    );
}
