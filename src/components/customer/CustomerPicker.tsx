"use client";

import { useState, useEffect, useRef } from "react";
import { Search, User, Plus, X, Crown, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchCustomers, type Customer, type CustomerType } from "@/lib/customers";

interface CustomerPickerProps {
    selectedCustomer: Customer | null;
    onSelect: (customer: Customer | null) => void;
    onCreateNew?: () => void;
    className?: string;
}

const typeIcons: Record<CustomerType, any> = {
    retail: User,
    wholesale: Building2,
    vip: Crown,
};

export function CustomerPicker({
    selectedCustomer,
    onSelect,
    onCreateNew,
    className,
}: CustomerPickerProps) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Customer[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleSearch = async () => {
            if (query.length < 2) {
                setResults([]);
                return;
            }

            setLoading(true);
            const data = await searchCustomers(query, 8);
            setResults(data);
            setLoading(false);
        };

        const debounce = setTimeout(handleSearch, 300);
        return () => clearTimeout(debounce);
    }, [query]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelect = (customer: Customer) => {
        onSelect(customer);
        setQuery("");
        setResults([]);
        setIsOpen(false);
    };

    const handleClear = () => {
        onSelect(null);
    };

    if (selectedCustomer) {
        const TypeIcon = typeIcons[selectedCustomer.customer_type];
        return (
            <div className={`flex items-center gap-3 p-3 bg-card border border-border rounded-lg ${className}`}>
                <div className="p-2 bg-primary/10 rounded-lg">
                    <TypeIcon className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{selectedCustomer.name}</p>
                    <p className="text-xs text-muted-foreground">
                        {selectedCustomer.phone || selectedCustomer.email || selectedCustomer.customer_type}
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleClear}
                >
                    <X className="w-4 h-4" />
                </Button>
            </div>
        );
    }

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    placeholder="Search customer by name or phone..."
                    className="pl-10 bg-card border-border"
                />
            </div>

            {isOpen && (query.length >= 2 || results.length > 0) && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                    {loading ? (
                        <div className="p-4 text-center text-muted-foreground text-sm">
                            Searching...
                        </div>
                    ) : results.length === 0 ? (
                        <div className="p-4">
                            <p className="text-sm text-muted-foreground text-center mb-3">
                                No customers found
                            </p>
                            {onCreateNew && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full"
                                    onClick={() => {
                                        setIsOpen(false);
                                        onCreateNew();
                                    }}
                                >
                                    <Plus className="w-3 h-3 mr-2" />
                                    Add New Customer
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="max-h-64 overflow-y-auto">
                            {results.map((customer) => {
                                const TypeIcon = typeIcons[customer.customer_type];
                                return (
                                    <button
                                        key={customer.id}
                                        onClick={() => handleSelect(customer)}
                                        className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
                                    >
                                        <div className="p-2 bg-muted/30 rounded-lg">
                                            <TypeIcon className="w-4 h-4 text-muted-foreground" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium truncate">{customer.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {customer.phone || customer.email}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                            {onCreateNew && (
                                <button
                                    onClick={() => {
                                        setIsOpen(false);
                                        onCreateNew();
                                    }}
                                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left border-t border-border"
                                >
                                    <div className="p-2 bg-primary/10 rounded-lg">
                                        <Plus className="w-4 h-4 text-primary" />
                                    </div>
                                    <span className="text-sm text-primary">Add New Customer</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}


