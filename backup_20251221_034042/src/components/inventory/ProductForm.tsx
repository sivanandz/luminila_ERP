"use client";

import { useState } from "react";
import { X, Plus, Trash2, Upload } from "lucide-react";
import { formatPrice } from "@/lib/utils";

interface ProductVariant {
    id: string;
    name: string;
    material?: string;
    size?: string;
    color?: string;
    priceAdjustment: number;
    stock: number;
}

interface ProductFormData {
    sku: string;
    name: string;
    description: string;
    category: string;
    basePrice: number;
    costPrice: number;
    variants: ProductVariant[];
}

interface ProductFormProps {
    initialData?: Partial<ProductFormData>;
    onSubmit: (data: ProductFormData) => void;
    onCancel: () => void;
    isLoading?: boolean;
}

const categories = ["Earrings", "Necklaces", "Bracelets", "Rings", "Anklets", "Sets", "Other"];
const materials = ["Gold-Plated", "Sterling Silver", "Rose Gold", "Pearl", "Crystal", "Mixed"];
const sizes = ["XS", "S", "M", "L", "XL", "Free Size"];

export function ProductForm({ initialData, onSubmit, onCancel, isLoading }: ProductFormProps) {
    const [formData, setFormData] = useState<ProductFormData>({
        sku: initialData?.sku || "",
        name: initialData?.name || "",
        description: initialData?.description || "",
        category: initialData?.category || "Earrings",
        basePrice: initialData?.basePrice || 0,
        costPrice: initialData?.costPrice || 0,
        variants: initialData?.variants || [
            { id: "1", name: "Default", priceAdjustment: 0, stock: 0 },
        ],
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    const updateField = <K extends keyof ProductFormData>(
        field: K,
        value: ProductFormData[K]
    ) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors((prev) => ({ ...prev, [field]: "" }));
        }
    };

    const addVariant = () => {
        setFormData((prev) => ({
            ...prev,
            variants: [
                ...prev.variants,
                {
                    id: Date.now().toString(),
                    name: `Variant ${prev.variants.length + 1}`,
                    priceAdjustment: 0,
                    stock: 0,
                },
            ],
        }));
    };

    const updateVariant = (index: number, updates: Partial<ProductVariant>) => {
        setFormData((prev) => ({
            ...prev,
            variants: prev.variants.map((v, i) =>
                i === index ? { ...v, ...updates } : v
            ),
        }));
    };

    const removeVariant = (index: number) => {
        if (formData.variants.length <= 1) return;
        setFormData((prev) => ({
            ...prev,
            variants: prev.variants.filter((_, i) => i !== index),
        }));
    };

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!formData.sku.trim()) newErrors.sku = "SKU is required";
        if (!formData.name.trim()) newErrors.name = "Name is required";
        if (formData.basePrice <= 0) newErrors.basePrice = "Price must be greater than 0";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (validate()) {
            onSubmit(formData);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-navy">
                    {initialData?.sku ? "Edit Product" : "New Product"}
                </h2>
                <button type="button" onClick={onCancel} className="p-2 hover:bg-silver-light rounded-lg">
                    <X size={20} />
                </button>
            </div>

            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium mb-1.5">
                        SKU <span className="text-error">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.sku}
                        onChange={(e) => updateField("sku", e.target.value.toUpperCase())}
                        placeholder="LUM-EAR-001"
                        className={`input ${errors.sku ? "border-error" : ""}`}
                    />
                    {errors.sku && <p className="text-xs text-error mt-1">{errors.sku}</p>}
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1.5">Category</label>
                    <select
                        value={formData.category}
                        onChange={(e) => updateField("category", e.target.value)}
                        className="input"
                    >
                        {categories.map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                </div>

                <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-1.5">
                        Product Name <span className="text-error">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => updateField("name", e.target.value)}
                        placeholder="Pearl Drop Earrings"
                        className={`input ${errors.name ? "border-error" : ""}`}
                    />
                    {errors.name && <p className="text-xs text-error mt-1">{errors.name}</p>}
                </div>

                <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-1.5">Description</label>
                    <textarea
                        value={formData.description}
                        onChange={(e) => updateField("description", e.target.value)}
                        placeholder="Elegant pearl drop earrings with gold-plated hooks..."
                        rows={3}
                        className="input"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1.5">
                        Base Price (₹) <span className="text-error">*</span>
                    </label>
                    <input
                        type="number"
                        value={formData.basePrice || ""}
                        onChange={(e) => updateField("basePrice", Number(e.target.value))}
                        placeholder="1290"
                        min="0"
                        className={`input ${errors.basePrice ? "border-error" : ""}`}
                    />
                    {errors.basePrice && <p className="text-xs text-error mt-1">{errors.basePrice}</p>}
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1.5">Cost Price (₹)</label>
                    <input
                        type="number"
                        value={formData.costPrice || ""}
                        onChange={(e) => updateField("costPrice", Number(e.target.value))}
                        placeholder="650"
                        min="0"
                        className="input"
                    />
                    <p className="text-xs text-foreground-muted mt-1">
                        {formData.costPrice && formData.basePrice > 0
                            ? `Margin: ${Math.round(((formData.basePrice - formData.costPrice) / formData.basePrice) * 100)}%`
                            : "For profit calculation"}
                    </p>
                </div>
            </div>

            {/* Image Upload */}
            <div>
                <label className="block text-sm font-medium mb-1.5">Product Images</label>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-navy transition-colors cursor-pointer">
                    <Upload size={32} className="mx-auto text-silver-dark mb-2" />
                    <p className="text-sm font-medium">Click to upload images</p>
                    <p className="text-xs text-foreground-muted">PNG, JPG up to 5MB</p>
                </div>
            </div>

            {/* Variants */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium">Variants</label>
                    <button
                        type="button"
                        onClick={addVariant}
                        className="btn btn-outline py-1.5 px-3 text-sm"
                    >
                        <Plus size={16} />
                        Add Variant
                    </button>
                </div>

                <div className="space-y-3">
                    {formData.variants.map((variant, index) => (
                        <div
                            key={variant.id}
                            className="p-4 bg-silver-light rounded-lg grid grid-cols-2 md:grid-cols-5 gap-3"
                        >
                            <div>
                                <label className="block text-xs text-foreground-muted mb-1">Name</label>
                                <input
                                    type="text"
                                    value={variant.name}
                                    onChange={(e) => updateVariant(index, { name: e.target.value })}
                                    className="input py-1.5 text-sm"
                                    placeholder="Small"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-foreground-muted mb-1">Material</label>
                                <select
                                    value={variant.material || ""}
                                    onChange={(e) => updateVariant(index, { material: e.target.value })}
                                    className="input py-1.5 text-sm"
                                >
                                    <option value="">Select</option>
                                    {materials.map((m) => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-foreground-muted mb-1">Size</label>
                                <select
                                    value={variant.size || ""}
                                    onChange={(e) => updateVariant(index, { size: e.target.value })}
                                    className="input py-1.5 text-sm"
                                >
                                    <option value="">Select</option>
                                    {sizes.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-foreground-muted mb-1">Price Adj.</label>
                                <input
                                    type="number"
                                    value={variant.priceAdjustment || ""}
                                    onChange={(e) => updateVariant(index, { priceAdjustment: Number(e.target.value) })}
                                    className="input py-1.5 text-sm"
                                    placeholder="+200"
                                />
                            </div>
                            <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <label className="block text-xs text-foreground-muted mb-1">Stock</label>
                                    <input
                                        type="number"
                                        value={variant.stock || ""}
                                        onChange={(e) => updateVariant(index, { stock: Number(e.target.value) })}
                                        className="input py-1.5 text-sm"
                                        placeholder="10"
                                        min="0"
                                    />
                                </div>
                                {formData.variants.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removeVariant(index)}
                                        className="p-2 text-error hover:bg-error/10 rounded-lg"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Variant Price Preview */}
                {formData.variants.length > 1 && formData.basePrice > 0 && (
                    <div className="mt-3 p-3 bg-gold-light rounded-lg">
                        <p className="text-sm font-medium mb-2">Price Preview</p>
                        <div className="flex flex-wrap gap-2">
                            {formData.variants.map((v) => (
                                <span key={v.id} className="badge badge-gold">
                                    {v.name}: {formatPrice(formData.basePrice + v.priceAdjustment)}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <button type="button" onClick={onCancel} className="btn btn-outline">
                    Cancel
                </button>
                <button type="submit" disabled={isLoading} className="btn btn-primary">
                    {isLoading ? "Saving..." : initialData?.sku ? "Update Product" : "Create Product"}
                </button>
            </div>
        </form>
    );
}
