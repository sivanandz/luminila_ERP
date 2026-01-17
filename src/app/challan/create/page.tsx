"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
    ChevronLeft,
    Save,
    Search,
    Plus,
    Trash2,
    Truck,
    User,
    Package
} from "lucide-react";
import { formatPrice } from "@/lib/utils";
import {
    createChallan,
    type ChallanType,
    type ChallanItem,
    CHALLAN_TYPE_LABELS
} from "@/lib/challan";
import { getStoreSettings, type StoreSettings } from "@/lib/invoice";
import { searchCustomers, type Customer } from "@/lib/customers";
import { pb } from "@/lib/pocketbase";
import { toast } from "sonner";

export default function CreateChallanPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);

    // Challan Header State
    const [challanType, setChallanType] = useState<ChallanType>('other');
    const [challanDate, setChallanDate] = useState(new Date().toISOString().split('T')[0]);
    const [reason, setReason] = useState("");

    // Consignee State
    const [consigneeSearch, setConsigneeSearch] = useState("");
    const [consigneeResults, setConsigneeResults] = useState<Customer[]>([]);
    const [selectedConsignee, setSelectedConsignee] = useState<Customer | null>(null);
    const [showConsigneeResults, setShowConsigneeResults] = useState(false);
    const [manualConsignee, setManualConsignee] = useState({
        name: "",
        gstin: "",
        address: "",
        state_code: ""
    });

    // Transport State
    const [vehicleNumber, setVehicleNumber] = useState("");
    const [transporterName, setTransporterName] = useState("");
    const [driverName, setDriverName] = useState("");
    const [driverPhone, setDriverPhone] = useState("");
    const [ewayBillNumber, setEwayBillNumber] = useState("");

    // Items State
    const [items, setItems] = useState<Omit<ChallanItem, 'id' | 'challan_id'>[]>([]);
    const [productSearch, setProductSearch] = useState("");
    const [productResults, setProductResults] = useState<any[]>([]);
    const [showProductResults, setShowProductResults] = useState(false);

    // Load store settings
    useEffect(() => {
        getStoreSettings().then(setStoreSettings);
    }, []);

    // Search customers
    useEffect(() => {
        const timeout = setTimeout(async () => {
            if (consigneeSearch.length > 2) {
                const results = await searchCustomers(consigneeSearch);
                setConsigneeResults(results);
                setShowConsigneeResults(true);
            } else {
                setConsigneeResults([]);
                setShowConsigneeResults(false);
            }
        }, 500);
        return () => clearTimeout(timeout);
    }, [consigneeSearch]);

    // Search products
    useEffect(() => {
        const timeout = setTimeout(async () => {
            if (productSearch.length > 2) {
                try {
                    const products = await pb.collection('products').getFullList({
                        filter: `name~"${productSearch}"`,
                        expand: 'variants',
                    });
                    const data = products.map((p: any) => ({
                        id: p.id,
                        name: p.name,
                        base_price: p.base_price,
                        hsn_code: p.hsn_code,
                        variants: p.expand?.variants || [],
                    }));
                    setProductResults(data);
                } catch (e) {
                    // Fallback: fetch products and variants separately
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
                        hsn_code: p.hsn_code,
                        variants: variants.filter((v: any) => v.product === p.id).map((v: any) => ({
                            id: v.id,
                            sku_suffix: v.sku_suffix,
                            size: v.size,
                            color: v.color,
                            price_adjustment: v.price_adjustment || 0,
                        })),
                    }));
                    setProductResults(data);
                }
                setShowProductResults(true);
            } else {
                setProductResults([]);
                setShowProductResults(false);
            }
        }, 500);
        return () => clearTimeout(timeout);
    }, [productSearch]);

    const handleSelectConsignee = (customer: Customer) => {
        setSelectedConsignee(customer);
        setConsigneeSearch("");
        setShowConsigneeResults(false);
    };

    const handleAddItem = (product: any, variant: any) => {
        const price = product.base_price + (variant.price_adjustment || 0);
        const taxRate = 3; // Default GST for jewelry
        const taxableValue = price;
        const cgstAmount = (taxableValue * (taxRate / 2)) / 100;
        const sgstAmount = (taxableValue * (taxRate / 2)) / 100;

        const newItem: Omit<ChallanItem, 'id' | 'challan_id'> = {
            sr_no: items.length + 1,
            product_id: product.id,
            variant_id: variant.id,
            description: `${product.name} - ${variant.size || ''} ${variant.color || ''}`.trim(),
            hsn_code: product.hsn_code || '7113',
            quantity: 1,
            unit: 'PCS',
            unit_price: price,
            taxable_value: taxableValue,
            gst_rate: taxRate,
            cgst_rate: taxRate / 2,
            cgst_amount: cgstAmount,
            sgst_rate: taxRate / 2,
            sgst_amount: sgstAmount,
            igst_rate: 0,
            igst_amount: 0,
            total: taxableValue + cgstAmount + sgstAmount
        };

        setItems([...items, newItem]);
        setProductSearch("");
        setShowProductResults(false);
    };

    const updateItem = (index: number, field: keyof ChallanItem, value: any) => {
        const newItems = [...items];
        const item = { ...newItems[index], [field]: value };

        // Recalculate totals
        if (field === 'quantity' || field === 'unit_price') {
            item.taxable_value = item.quantity * item.unit_price;
            item.cgst_amount = (item.taxable_value * item.cgst_rate) / 100;
            item.sgst_amount = (item.taxable_value * item.sgst_rate) / 100;
            item.total = item.taxable_value + item.cgst_amount + item.sgst_amount;
        }

        newItems[index] = item;
        setItems(newItems);
    };

    const removeItem = (index: number) => {
        const newItems = items.filter((_, i) => i !== index);
        // Re-number items
        newItems.forEach((item, i) => item.sr_no = i + 1);
        setItems(newItems);
    };

    // Calculate totals
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const taxableValue = items.reduce((sum, item) => sum + item.taxable_value, 0);
    const cgstAmount = items.reduce((sum, item) => sum + item.cgst_amount, 0);
    const sgstAmount = items.reduce((sum, item) => sum + item.sgst_amount, 0);
    const totalValue = items.reduce((sum, item) => sum + item.total, 0);

    const handleSave = async () => {
        const consigneeName = selectedConsignee?.name || manualConsignee.name;
        if (!consigneeName) {
            toast.error("Please select or enter consignee details");
            return;
        }

        if (items.length === 0) {
            toast.error("Please add at least one item");
            return;
        }

        setLoading(true);

        const challanData = {
            challan_date: challanDate,
            challan_type: challanType,
            status: 'draft' as const,
            consignor_name: storeSettings?.store_name || 'Store',
            consignor_gstin: storeSettings?.store_gstin,
            consignor_address: storeSettings ? `${storeSettings.store_address}, ${storeSettings.store_city}, ${storeSettings.store_state} - ${storeSettings.store_pincode}` : '',
            consignor_state_code: storeSettings?.store_state_code,
            consignee_id: selectedConsignee?.id,
            consignee_name: consigneeName,
            consignee_gstin: selectedConsignee?.gstin || manualConsignee.gstin,
            consignee_address: selectedConsignee?.address || manualConsignee.address,
            consignee_state_code: manualConsignee.state_code,
            vehicle_number: vehicleNumber,
            transporter_name: transporterName,
            driver_name: driverName,
            driver_phone: driverPhone,
            eway_bill_number: ewayBillNumber,
            total_quantity: totalQuantity,
            taxable_value: taxableValue,
            cgst_amount: cgstAmount,
            sgst_amount: sgstAmount,
            igst_amount: 0,
            total_value: totalValue,
            reason: reason
        };

        const result = await createChallan(challanData, items);

        setLoading(false);

        if (result.success) {
            router.push('/challan');
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-bg-navy">
            <Header
                title="New Delivery Challan"
                subtitle="Create material outward document"
                action={
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            onClick={() => router.back()}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={loading}
                        >
                            {loading ? (
                                <span className="animate-pulse">Saving...</span>
                            ) : (
                                <>
                                    <Save size={18} className="mr-2" />
                                    Save
                                </>
                            )}
                        </Button>
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 max-w-7xl mx-auto">

                    {/* Left Column */}
                    <div className="xl:col-span-1 space-y-6">

                        {/* Challan Type */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <h3 className="text-white font-bold mb-4">Challan Type</h3>
                            <select
                                value={challanType}
                                onChange={(e) => setChallanType(e.target.value as ChallanType)}
                                className="w-full h-11 px-4 bg-bg-navy border border-surface-hover rounded-lg text-white focus:outline-none focus:border-primary"
                            >
                                {Object.entries(CHALLAN_TYPE_LABELS).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>

                            <div className="mt-4">
                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">Date</label>
                                <input
                                    type="date"
                                    value={challanDate}
                                    onChange={(e) => setChallanDate(e.target.value)}
                                    className="w-full h-11 px-4 bg-bg-navy border border-surface-hover rounded-lg text-white"
                                />
                            </div>

                            <div className="mt-4">
                                <label className="block text-xs font-bold text-moonstone uppercase mb-2">Reason/Purpose</label>
                                <textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Purpose of material movement..."
                                    className="w-full h-20 px-4 py-2 bg-bg-navy border border-surface-hover rounded-lg text-white resize-none"
                                />
                            </div>
                        </div>

                        {/* Consignee */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                                <User size={18} className="text-primary" />
                                Consignee (Receiver)
                            </h3>

                            {!selectedConsignee ? (
                                <div className="space-y-4">
                                    <div className="relative">
                                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-moonstone" />
                                        <input
                                            type="text"
                                            placeholder="Search customer..."
                                            value={consigneeSearch}
                                            onChange={(e) => setConsigneeSearch(e.target.value)}
                                            className="w-full h-11 pl-10 pr-4 bg-bg-navy border border-surface-hover rounded-lg text-white"
                                        />
                                        {showConsigneeResults && consigneeResults.length > 0 && (
                                            <div className="absolute top-full left-0 right-0 mt-2 bg-surface-navy border border-surface-hover rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto">
                                                {consigneeResults.map(customer => (
                                                    <div
                                                        key={customer.id}
                                                        onClick={() => handleSelectConsignee(customer)}
                                                        className="p-3 hover:bg-bg-navy cursor-pointer border-b border-surface-hover last:border-0"
                                                    >
                                                        <p className="text-white font-bold text-sm">{customer.name}</p>
                                                        <p className="text-xs text-moonstone">{customer.phone}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="text-center text-moonstone text-xs">OR enter manually</div>

                                    <input
                                        type="text"
                                        placeholder="Name"
                                        value={manualConsignee.name}
                                        onChange={(e) => setManualConsignee({ ...manualConsignee, name: e.target.value })}
                                        className="w-full h-10 px-4 bg-bg-navy border border-surface-hover rounded-lg text-white text-sm"
                                    />
                                    <input
                                        type="text"
                                        placeholder="GSTIN"
                                        value={manualConsignee.gstin}
                                        onChange={(e) => setManualConsignee({ ...manualConsignee, gstin: e.target.value })}
                                        className="w-full h-10 px-4 bg-bg-navy border border-surface-hover rounded-lg text-white text-sm font-mono"
                                    />
                                    <textarea
                                        placeholder="Address"
                                        value={manualConsignee.address}
                                        onChange={(e) => setManualConsignee({ ...manualConsignee, address: e.target.value })}
                                        className="w-full h-16 px-4 py-2 bg-bg-navy border border-surface-hover rounded-lg text-white text-sm resize-none"
                                    />
                                </div>
                            ) : (
                                <div className="bg-bg-navy/50 p-4 rounded-lg border border-surface-hover relative group">
                                    <button
                                        onClick={() => setSelectedConsignee(null)}
                                        className="absolute top-2 right-2 p-1 text-moonstone hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                    <p className="text-white font-bold">{selectedConsignee.name}</p>
                                    <p className="text-moonstone text-sm mt-1">{selectedConsignee.phone}</p>
                                    {selectedConsignee.gstin && (
                                        <p className="text-moonstone text-xs mt-1 font-mono">GSTIN: {selectedConsignee.gstin}</p>
                                    )}
                                    {selectedConsignee.address && (
                                        <p className="text-moonstone text-xs mt-2">{selectedConsignee.address}</p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Transport */}
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                                <Truck size={18} className="text-primary" />
                                Transport Details
                            </h3>
                            <div className="space-y-3">
                                <input
                                    type="text"
                                    placeholder="Vehicle Number"
                                    value={vehicleNumber}
                                    onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                                    className="w-full h-10 px-4 bg-bg-navy border border-surface-hover rounded-lg text-white text-sm font-mono"
                                />
                                <input
                                    type="text"
                                    placeholder="Transporter Name"
                                    value={transporterName}
                                    onChange={(e) => setTransporterName(e.target.value)}
                                    className="w-full h-10 px-4 bg-bg-navy border border-surface-hover rounded-lg text-white text-sm"
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        type="text"
                                        placeholder="Driver Name"
                                        value={driverName}
                                        onChange={(e) => setDriverName(e.target.value)}
                                        className="w-full h-10 px-4 bg-bg-navy border border-surface-hover rounded-lg text-white text-sm"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Driver Phone"
                                        value={driverPhone}
                                        onChange={(e) => setDriverPhone(e.target.value)}
                                        className="w-full h-10 px-4 bg-bg-navy border border-surface-hover rounded-lg text-white text-sm"
                                    />
                                </div>
                                <input
                                    type="text"
                                    placeholder="E-Way Bill Number"
                                    value={ewayBillNumber}
                                    onChange={(e) => setEwayBillNumber(e.target.value)}
                                    className="w-full h-10 px-4 bg-bg-navy border border-surface-hover rounded-lg text-white text-sm font-mono"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Right Column - Items */}
                    <div className="xl:col-span-2">
                        <div className="bg-surface-navy p-6 rounded-xl border border-surface-hover">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                                    <Package size={20} className="text-primary" />
                                    Items
                                </h3>
                                <div className="relative w-64">
                                    <Plus size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-moonstone" />
                                    <input
                                        type="text"
                                        placeholder="Add item..."
                                        value={productSearch}
                                        onChange={(e) => setProductSearch(e.target.value)}
                                        className="w-full h-10 pl-9 pr-4 bg-bg-navy border border-surface-hover rounded-lg text-white text-sm"
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
                                                                    <p className="text-xs text-moonstone">{v.size} {v.color}</p>
                                                                </div>
                                                                <p className="font-mono text-primary text-sm">
                                                                    {formatPrice(product.base_price + v.price_adjustment)}
                                                                </p>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="p-3 text-moonstone text-xs text-center">
                                                            No variants found
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
                                    <p>Search and add products</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-surface-hover text-xs font-bold text-moonstone uppercase">
                                                <th className="py-3 px-2">Sr</th>
                                                <th className="py-3 px-2">Description</th>
                                                <th className="py-3 px-2">HSN</th>
                                                <th className="py-3 px-2 w-20 text-center">Qty</th>
                                                <th className="py-3 px-2 w-28 text-right">Rate</th>
                                                <th className="py-3 px-2 w-28 text-right">Total</th>
                                                <th className="py-3 px-2 w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-surface-hover">
                                            {items.map((item, index) => (
                                                <tr key={index} className="hover:bg-bg-navy/30">
                                                    <td className="py-3 px-2 text-moonstone">{item.sr_no}</td>
                                                    <td className="py-3 px-2 text-white text-sm">{item.description}</td>
                                                    <td className="py-3 px-2 text-moonstone font-mono text-sm">{item.hsn_code}</td>
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
                                                    <td className="py-3 px-2 text-right font-bold text-white text-sm">
                                                        {formatPrice(item.total)}
                                                    </td>
                                                    <td className="py-3 px-2 text-center">
                                                        <button
                                                            onClick={() => removeItem(index)}
                                                            className="text-red-400 hover:text-red-300 p-1"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot className="border-t border-surface-hover bg-bg-navy/30">
                                            <tr>
                                                <td colSpan={3}></td>
                                                <td className="py-4 px-2 text-center font-bold text-white">{totalQuantity}</td>
                                                <td className="py-4 px-2 text-right text-moonstone">Taxable:</td>
                                                <td className="py-4 px-2 text-right font-bold text-white">{formatPrice(taxableValue)}</td>
                                                <td></td>
                                            </tr>
                                            <tr>
                                                <td colSpan={5} className="py-2 px-2 text-right text-moonstone text-sm">CGST:</td>
                                                <td className="py-2 px-2 text-right text-green-400 text-sm">{formatPrice(cgstAmount)}</td>
                                                <td></td>
                                            </tr>
                                            <tr>
                                                <td colSpan={5} className="py-2 px-2 text-right text-moonstone text-sm">SGST:</td>
                                                <td className="py-2 px-2 text-right text-green-400 text-sm">{formatPrice(sgstAmount)}</td>
                                                <td></td>
                                            </tr>
                                            <tr className="border-t border-primary/30">
                                                <td colSpan={5} className="py-4 px-2 text-right text-primary font-bold text-xl">Total:</td>
                                                <td className="py-4 px-2 text-right text-primary font-bold text-xl">{formatPrice(totalValue)}</td>
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
