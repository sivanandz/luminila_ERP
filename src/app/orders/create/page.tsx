"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout";
import {
    Calendar as CalendarIcon,
    Search,
    Plus,
    Trash2,
    Save,
    User,
    ChevronLeft,
    CheckCircle,
    FileText
} from "lucide-react";
import { toast } from "sonner";
import { formatPrice } from "@/lib/utils";
import { createOrder, OrderType, OrderStatus, OrderItemInput } from "@/lib/orders";
import { searchCustomers, Customer } from "@/lib/customers";
import { pb } from "@/lib/pocketbase";

export default function CreateOrderPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    // Order Header State
    const [orderType, setOrderType] = useState<OrderType>('estimate');
    const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
    const [validUntil, setValidUntil] = useState<string>('');
    const [status, setStatus] = useState<OrderStatus>('draft');

    // Customer State
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Customer[]>([]);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [showResults, setShowResults] = useState(false);

    // Items State
    const [items, setItems] = useState<OrderItemInput[]>([]);
    const [productSearch, setProductSearch] = useState("");
    const [productResults, setProductResults] = useState<any[]>([]);
    const [showProductResults, setShowProductResults] = useState(false);

    // Financials
    const [subtotal, setSubtotal] = useState(0);
    const [taxTotal, setTaxTotal] = useState(0);
    const [discountTotal, setDiscountTotal] = useState(0);
    const [total, setTotal] = useState(0);

    // Notes
    const [notes, setNotes] = useState("");

    // Calculate totals whenever items change
    useEffect(() => {
        let sub = 0;
        let tax = 0;
        let disc = 0;

        items.forEach(item => {
            sub += item.quantity * item.unit_price;
            tax += (item.quantity * item.unit_price) * ((item.tax_rate || 0) / 100);
            disc += item.discount_amount || 0;
        });

        setSubtotal(sub);
        setTaxTotal(tax);
        setDiscountTotal(disc);
        setTotal(sub + tax - disc);
    }, [items]);

    // Search Customers
    useEffect(() => {
        const timeoutId = setTimeout(async () => {
            if (searchQuery.length > 2) {
                const results = await searchCustomers(searchQuery);
                setSearchResults(results);
                setShowResults(true);
            } else {
                setSearchResults([]);
                setShowResults(false);
            }
        }, 500);

        return () => clearTimeout(timeoutId);
    }, [searchQuery]);

    // Search Products
    useEffect(() => {
        const timeoutId = setTimeout(async () => {
            if (productSearch.length > 2) {
                try {
                    const products = await pb.collection('products').getFullList({
                        filter: `name~"${productSearch}"`,
                    });
                    const productIds = products.map((p: any) => p.id);
                    let variants: any[] = [];
                    if (productIds.length > 0) {
                        const variantFilter = productIds.map(id => `product="${id}"`).join(' || ');
                        variants = await pb.collection('product_variants').getFullList({ filter: variantFilter });
                    }
                    const data = products.map((p: any) => ({
                        id: p.id,
                        name: p.name,
                        base_price: p.base_price,
                        variants: variants.filter((v: any) => v.product === p.id).map((v: any) => ({
                            id: v.id,
                            sku_suffix: v.sku_suffix,
                            size: v.size,
                            color: v.color,
                            price_adjustment: v.price_adjustment || 0,
                        })),
                    }));
                    setProductResults(data);
                } catch (e) {
                    console.error('Failed to search products:', e);
                    setProductResults([]);
                }
                setShowProductResults(true);
            } else {
                setProductResults([]);
                setShowProductResults(false);
            }
        }, 500);

        return () => clearTimeout(timeoutId);
    }, [productSearch]);

    const handleSelectCustomer = (customer: Customer) => {
        setSelectedCustomer(customer);
        setSearchQuery("");
        setShowResults(false);
    };

    const handleAddItem = (product: any, variant: any) => {
        const price = product.base_price + (variant.price_adjustment || 0);
        const newItem: OrderItemInput = {
            product_id: product.id,
            variant_id: variant.id,
            description: `${product.name} - ${variant.size || ''} ${variant.color || ''}`,
            quantity: 1,
            unit_price: price,
            tax_rate: 3, // Default gold tax 3%
            discount_amount: 0,
            total: price + (price * 0.03)
        };

        setItems([...items, newItem]);
        setProductSearch("");
        setShowProductResults(false);
    };

    const updateItem = (index: number, field: keyof OrderItemInput, value: any) => {
        const newItems = [...items];
        const item = { ...newItems[index], [field]: value };

        // Recalculate item total
        const baseTotal = item.quantity * item.unit_price;
        const taxVal = baseTotal * ((item.tax_rate || 0) / 100);
        item.total = baseTotal + taxVal - (item.discount_amount || 0);

        newItems[index] = item;
        setItems(newItems);
    };

    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        if (!selectedCustomer) {
            toast.error("Please select a customer");
            return;
        }

        if (items.length === 0) {
            toast.error("Please add at least one item");
            return;
        }

        setLoading(true);

        const orderData = {
            order_type: orderType,
            customer_id: selectedCustomer.id,
            customer_name: selectedCustomer.name,
            customer_phone: selectedCustomer.phone,
            customer_email: selectedCustomer.email,
            billing_address: selectedCustomer.address,
            shipping_address: selectedCustomer.address, // Default to same
            order_date: new Date(orderDate).toISOString(),
            valid_until: validUntil ? new Date(validUntil).toISOString() : undefined,
            status: status,
            notes: notes,
            items: items,
            subtotal,
            tax_total: taxTotal,
            discount_total: discountTotal,
            shipping_charges: 0,
            total
        };

        const result = await createOrder(orderData);

        setLoading(false);

        if (result.success) {
            toast.success(`${orderType === 'estimate' ? 'Estimate' : 'Order'} created successfully`);
            router.push('/orders');
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-bg-navy">
            <Header
                title={orderType === 'estimate' ? 'New Estimate' : 'New Sales Order'}
                subtitle="Create a quotation or sales order"
                action={
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => router.back()}
                            className="h-11 px-4 text-moonstone hover:text-white font-bold text-sm transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={loading}
                            className="h-11 px-6 bg-primary hover:bg-primary/90 text-bg-navy rounded-lg font-bold text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
                        >
                            {loading ? (
                                <span className="animate-pulse">Saving...</span>
                            ) : (
                                <>
                                    <Save size={18} />
                                    Save
                                </>
                            )}
                        </button>
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

                    {/* LEFT COLUMN: Customer & Order Details */}
                    <div className="xl:col-span-1 space-y-6">

                        {/* Order Type Toggle */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <h3 className="text-white font-bold mb-4">Order Type</h3>
                            <div className="grid grid-cols-2 gap-2 bg-bg-navy p-1 rounded-lg">
                                <button
                                    onClick={() => setOrderType('estimate')}
                                    className={`py-2 px-4 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 ${orderType === 'estimate'
                                        ? 'bg-orange-500 text-white shadow-lg'
                                        : 'text-moonstone hover:text-white'
                                        }`}
                                >
                                    <FileText size={16} />
                                    Estimate
                                </button>
                                <button
                                    onClick={() => setOrderType('sales_order')}
                                    className={`py-2 px-4 rounded-md text-sm font-bold transition-all flex items-center justify-center gap-2 ${orderType === 'sales_order'
                                        ? 'bg-blue-600 text-white shadow-lg'
                                        : 'text-moonstone hover:text-white'
                                        }`}
                                >
                                    <CheckCircle size={16} />
                                    Sales Order
                                </button>
                            </div>

                            <div className="mt-6 grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-moonstone uppercase mb-2">Order Date</label>
                                    <input
                                        type="date"
                                        value={orderDate}
                                        onChange={(e) => setOrderDate(e.target.value)}
                                        className="input bg-bg-navy border-surface-hover w-full text-white"
                                    />
                                </div>
                                {orderType === 'estimate' && (
                                    <div>
                                        <label className="block text-xs font-bold text-moonstone uppercase mb-2">Valid Until</label>
                                        <input
                                            type="date"
                                            value={validUntil}
                                            onChange={(e) => setValidUntil(e.target.value)}
                                            className="input bg-bg-navy border-surface-hover w-full text-white"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Customer Search */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                                <User size={18} className="text-primary" />
                                Customer Details
                            </h3>

                            {!selectedCustomer ? (
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone">
                                        <Search size={18} />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Search customer by name or phone..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="input bg-bg-navy border-surface-hover w-full pl-10 text-white"
                                    />
                                    {showResults && searchResults.length > 0 && (
                                        <div className="absolute top-full left-0 right-0 mt-2 bg-surface-navy border border-surface-hover rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
                                            {searchResults.map(customer => (
                                                <div
                                                    key={customer.id}
                                                    onClick={() => handleSelectCustomer(customer)}
                                                    className="p-3 hover:bg-bg-navy cursor-pointer border-b border-surface-hover last:border-0"
                                                >
                                                    <p className="text-white font-bold text-sm">{customer.name}</p>
                                                    <p className="text-xs text-moonstone">{customer.phone} • {customer.email}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-bg-navy/50 p-4 rounded-lg border border-surface-hover relative group">
                                    <button
                                        onClick={() => setSelectedCustomer(null)}
                                        className="absolute top-2 right-2 p-1 text-moonstone hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                    <p className="text-white font-bold text-lg">{selectedCustomer.name}</p>
                                    <p className="text-moonstone text-sm mt-1">{selectedCustomer.phone}</p>
                                    <p className="text-moonstone text-sm">{selectedCustomer.email}</p>
                                    {selectedCustomer.address && (
                                        <p className="text-moonstone text-xs mt-3 pt-3 border-t border-surface-hover">
                                            {selectedCustomer.address}, {selectedCustomer.city}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Notes */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <h3 className="text-white font-bold mb-4">Notes</h3>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Add notes for this order..."
                                className="input bg-bg-navy border-surface-hover w-full text-white h-24 resize-none"
                            />
                        </div>
                    </div>

                    {/* CENTER/RIGHT COLUMN: Items & Summary */}
                    <div className="xl:col-span-2 flex flex-col gap-6">

                        {/* Order Items */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover flex-1">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-white font-bold text-lg">Order Items</h3>
                                <div className="relative w-64">
                                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-moonstone">
                                        <Plus size={16} />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Add Item..."
                                        value={productSearch}
                                        onChange={(e) => setProductSearch(e.target.value)}
                                        className="input bg-bg-navy border-surface-hover w-full pl-9 h-10 text-sm text-white focus:w-80 transition-all"
                                    />
                                    {showProductResults && productResults.length > 0 && (
                                        <div className="absolute top-full right-0 mt-2 w-96 bg-surface-navy border border-surface-hover rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
                                            {productResults.map(product => (
                                                <div key={product.id}>
                                                    {product.variants.length > 0 ? (
                                                        product.variants.map((v: any) => (
                                                            <div
                                                                key={v.id}
                                                                onClick={() => handleAddItem(product, v)}
                                                                className="p-3 hover:bg-bg-navy cursor-pointer border-b border-surface-hover flex justify-between items-center"
                                                            >
                                                                <div>
                                                                    <p className="text-white font-bold text-sm">{product.name}</p>
                                                                    <p className="text-xs text-moonstone">{v.size} {v.color} {v.material}</p>
                                                                </div>
                                                                <p className="font-mono text-primary text-sm font-bold">
                                                                    {formatPrice(product.base_price + v.price_adjustment)}
                                                                </p>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="p-3 text-moonstone text-xs text-center border-b border-surface-hover">
                                                            No variants found for {product.name}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {items.length === 0 ? (
                                <div className="border-2 border-dashed border-surface-hover rounded-xl p-12 text-center text-moonstone/50">
                                    <Search size={32} className="mx-auto mb-3 opacity-50" />
                                    <p>Search and add products to the order</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-surface-hover text-xs font-bold text-moonstone uppercase">
                                                <th className="py-3 px-4">Item</th>
                                                <th className="py-3 px-2 w-20 text-center">Qty</th>
                                                <th className="py-3 px-2 w-32 text-right">Price</th>
                                                <th className="py-3 px-2 w-24 text-right">Tax %</th>
                                                <th className="py-3 px-2 w-32 text-right">Discount</th>
                                                <th className="py-3 px-4 w-32 text-right">Total</th>
                                                <th className="py-3 px-2 w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-surface-hover">
                                            {items.map((item, index) => (
                                                <tr key={index} className="hover:bg-bg-navy/30">
                                                    <td className="py-3 px-4">
                                                        <p className="text-white text-sm font-medium">{item.description}</p>
                                                    </td>
                                                    <td className="py-3 px-2">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={item.quantity}
                                                            onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                                                            className="w-full bg-bg-navy border border-surface-hover rounded px-2 py-1 text-center text-white text-sm"
                                                        />
                                                    </td>
                                                    <td className="py-3 px-2">
                                                        <input
                                                            type="number"
                                                            value={item.unit_price}
                                                            onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                                                            className="w-full bg-bg-navy border border-surface-hover rounded px-2 py-1 text-right text-white text-sm"
                                                        />
                                                    </td>
                                                    <td className="py-3 px-2">
                                                        <input
                                                            type="number"
                                                            value={item.tax_rate}
                                                            onChange={(e) => updateItem(index, 'tax_rate', parseFloat(e.target.value) || 0)}
                                                            className="w-full bg-bg-navy border border-surface-hover rounded px-2 py-1 text-right text-white text-sm"
                                                        />
                                                    </td>
                                                    <td className="py-3 px-2">
                                                        <input
                                                            type="number"
                                                            value={item.discount_amount}
                                                            onChange={(e) => updateItem(index, 'discount_amount', parseFloat(e.target.value) || 0)}
                                                            className="w-full bg-bg-navy border border-surface-hover rounded px-2 py-1 text-right text-white text-sm"
                                                        />
                                                    </td>
                                                    <td className="py-3 px-4 text-right font-bold text-white text-sm">
                                                        {formatPrice(item.total)}
                                                    </td>
                                                    <td className="py-3 px-2 text-center">
                                                        <button
                                                            onClick={() => removeItem(index)}
                                                            className="text-red-400 hover:text-red-300 p-1 hover:bg-red-500/10 rounded"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="border-t border-surface-hover bg-bg-navy/30">
                                            <tr>
                                                <td colSpan={5} className="py-4 px-4 text-right font-bold text-moonstone">Subtotal</td>
                                                <td className="py-4 px-4 text-right font-bold text-white">{formatPrice(subtotal)}</td>
                                                <td></td>
                                            </tr>
                                            <tr>
                                                <td colSpan={5} className="py-2 px-4 text-right font-medium text-moonstone text-sm">Tax</td>
                                                <td className="py-2 px-4 text-right font-medium text-green-400 text-sm">+{formatPrice(taxTotal)}</td>
                                                <td></td>
                                            </tr>
                                            <tr>
                                                <td colSpan={5} className="py-2 px-4 text-right font-medium text-moonstone text-sm">Discount</td>
                                                <td className="py-2 px-4 text-right font-medium text-red-400 text-sm">-{formatPrice(discountTotal)}</td>
                                                <td></td>
                                            </tr>
                                            <tr className="border-t border-surface-hover bg-primary/5">
                                                <td colSpan={5} className="py-4 px-4 text-right font-bold text-primary text-xl">Total</td>
                                                <td className="py-4 px-4 text-right font-bold text-primary text-xl">{formatPrice(total)}</td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
