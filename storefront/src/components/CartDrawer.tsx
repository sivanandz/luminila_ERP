"use client";

import React, { useState } from "react";
import { useCart } from "@/context/CartContext";
import { X, Trash2, Plus, Minus, ShoppingBag, ArrowRight } from "lucide-react";
import Link from "next/link";

export function CartDrawer() {
    const { cart, isCartOpen, setIsCartOpen, removeFromCart, updateQuantity, cartSubtotal, cartCount } = useCart();

    if (!isCartOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end animate-in fade-in duration-200">
            {/* Backdrop */}
            <div
                onClick={() => setIsCartOpen(false)}
                className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-200"
            />

            {/* Slide-over Drawer (Emil Kowalski: iOS drawer curve 300ms) */}
            <div className="relative w-full max-w-md bg-white text-black flex flex-col h-full z-10 shadow-2xl animate-in slide-in-from-right duration-300 ease-emil-drawer">
                {/* Header */}
                <div className="p-5 border-b border-neutral-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ShoppingBag className="w-4 h-4 text-black stroke-[1.75]" />
                        <h2 className="text-xs font-bold uppercase tracking-widest text-black">
                            Bag ({cartCount})
                        </h2>
                    </div>
                    <button
                        onClick={() => setIsCartOpen(false)}
                        className="p-1 text-neutral-400 hover:text-black transition cursor-pointer"
                        aria-label="Close cart"
                    >
                        <X className="w-5 h-5 stroke-[1.5]" />
                    </button>
                </div>

                {/* Cart Items List */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {cart.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center text-neutral-400 space-y-3">
                            <ShoppingBag className="w-10 h-10 text-neutral-300 stroke-[1.25]" />
                            <p className="text-xs uppercase tracking-widest text-neutral-500">Your bag is empty.</p>
                            <button
                                onClick={() => setIsCartOpen(false)}
                                className="px-5 py-2.5 bg-black text-xs font-semibold uppercase tracking-widest text-white transition hover:bg-neutral-800"
                            >
                                Continue Shopping
                            </button>
                        </div>
                    ) : (
                        cart.map((item) => (
                            <div
                                key={item.product.id}
                                className="flex gap-4 border-b border-neutral-100 pb-4 items-center"
                            >
                                <div className="w-16 h-20 bg-neutral-100 rounded-xs overflow-hidden shrink-0">
                                    {item.product.image_url ? (
                                        <img
                                            src={item.product.image_url}
                                            alt={item.product.name}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-neutral-300 text-xs">
                                            No img
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-xs font-medium text-black truncate">
                                        {item.product.name}
                                    </h3>
                                    <div className="text-xs font-bold text-black mt-1">
                                        Rs. {item.product.website_price.toLocaleString("en-IN")}
                                    </div>

                                    {/* Quantity Stepper */}
                                    <div className="flex items-center justify-between mt-3">
                                        <div className="flex items-center border border-neutral-200">
                                            <button
                                                onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                                className="px-2 py-0.5 text-xs text-neutral-500 hover:text-black cursor-pointer"
                                            >
                                                <Minus className="w-3 h-3" />
                                            </button>
                                            <span className="px-2 text-xs font-mono font-medium">
                                                {item.quantity}
                                            </span>
                                            <button
                                                onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                                className="px-2 py-0.5 text-xs text-neutral-500 hover:text-black cursor-pointer"
                                            >
                                                <Plus className="w-3 h-3" />
                                            </button>
                                        </div>

                                        <button
                                            onClick={() => removeFromCart(item.product.id)}
                                            className="text-neutral-400 hover:text-black p-1 transition cursor-pointer"
                                            title="Remove item"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer Checkout Actions */}
                {cart.length > 0 && (
                    <div className="p-5 border-t border-neutral-100 space-y-4 bg-white">
                        <div className="flex justify-between items-center text-xs">
                            <span className="uppercase tracking-widest text-neutral-500">Subtotal</span>
                            <span className="text-base font-bold text-black">
                                Rs. {cartSubtotal.toLocaleString("en-IN")}
                            </span>
                        </div>

                        <div className="space-y-2">
                            <Link
                                href="/checkout"
                                onClick={() => setIsCartOpen(false)}
                                className="w-full bg-black hover:bg-neutral-800 text-white font-medium py-3 px-4 text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-[background-color,transform] duration-140 ease-emil-out active:scale-97 cursor-pointer"
                            >
                                <span>Proceed to Checkout</span>
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        </div>

                        <p className="text-[10px] text-neutral-400 uppercase tracking-widest text-center">
                            Pan India Shipping • Dispatched in 24-48 hrs
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
