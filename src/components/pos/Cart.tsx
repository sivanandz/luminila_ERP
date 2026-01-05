"use client";

import { CartItem } from "@/types/database";
import { formatPrice } from "@/lib/utils";
import { Plus, Minus, Trash2, Receipt } from "lucide-react";

interface CartProps {
    items: CartItem[];
    onUpdateQuantity: (variantId: string, delta: number) => void;
    onRemoveItem: (variantId: string) => void;
    onClear: () => void;
}

export function Cart({ items, onUpdateQuantity, onRemoveItem, onClear }: CartProps) {
    const subtotal = items.reduce(
        (sum, item) => sum + item.unit_price * item.quantity,
        0
    );

    if (items.length === 0) {
        return (
            <div className="text-center py-8">
                <Receipt size={48} className="mx-auto text-silver-dark mb-3" />
                <p className="text-foreground-muted">Cart is empty</p>
                <p className="text-sm text-foreground-muted">
                    Scan or search to add items
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-foreground-muted">
                    {items.length} item{items.length !== 1 ? "s" : ""}
                </span>
                <button
                    onClick={onClear}
                    className="text-sm text-error hover:text-error/80 transition-colors"
                >
                    Clear All
                </button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {items.map((item) => (
                    <div
                        key={item.variant.id}
                        className="p-3 bg-silver-light rounded-lg flex items-center gap-3"
                    >
                        <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                                {item.variant.product.name}
                            </p>
                            <p className="text-xs text-foreground-muted truncate">
                                {item.variant.variant_name} • {formatPrice(item.unit_price)}
                            </p>
                        </div>

                        {/* Quantity Controls */}
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => onUpdateQuantity(item.variant.id, -1)}
                                className="w-7 h-7 rounded bg-white flex items-center justify-center hover:bg-navy hover:text-white transition-colors"
                            >
                                <Minus size={14} />
                            </button>
                            <span className="w-8 text-center font-bold text-sm">
                                {item.quantity}
                            </span>
                            <button
                                onClick={() => onUpdateQuantity(item.variant.id, 1)}
                                className="w-7 h-7 rounded bg-white flex items-center justify-center hover:bg-navy hover:text-white transition-colors"
                            >
                                <Plus size={14} />
                            </button>
                        </div>

                        {/* Remove Button */}
                        <button
                            onClick={() => onRemoveItem(item.variant.id)}
                            className="p-1.5 text-error hover:bg-error/10 rounded transition-colors"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>

            {/* Line Items Total */}
            <div className="mt-3 pt-3 border-t border-border">
                <div className="flex justify-between text-sm">
                    <span className="text-foreground-muted">Subtotal</span>
                    <span className="font-semibold">{formatPrice(subtotal)}</span>
                </div>
            </div>
        </div>
    );
}


