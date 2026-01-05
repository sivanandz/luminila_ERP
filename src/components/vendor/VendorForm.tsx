"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { createVendor, updateVendor, type Vendor } from "@/lib/vendors";

interface VendorFormProps {
    vendor?: Vendor | null;
    onSuccess: () => void;
    onCancel: () => void;
}

export function VendorForm({ vendor, onSuccess, onCancel }: VendorFormProps) {
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: vendor?.name || "",
        contact_name: vendor?.contact_name || "",
        phone: vendor?.phone || "",
        email: vendor?.email || "",
        address: vendor?.address || "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name.trim()) {
            alert("Please enter vendor name");
            return;
        }

        setLoading(true);

        try {
            if (vendor) {
                await updateVendor(vendor.id, formData);
            } else {
                await createVendor(formData);
            }
            onSuccess();
        } catch (error) {
            console.error("Error saving vendor:", error);
            alert("Failed to save vendor. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="name">Vendor Name *</Label>
                <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Company or business name"
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="contact_name">Contact Person</Label>
                <Input
                    id="contact_name"
                    value={formData.contact_name}
                    onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                    placeholder="Primary contact name"
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                        id="phone"
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="+91 98765 43210"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="vendor@example.com"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Textarea
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Full address"
                    rows={2}
                />
            </div>

            <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    disabled={loading}
                    className="bg-primary text-midnight hover:bg-primary/90"
                >
                    {loading ? "Saving..." : vendor ? "Update Vendor" : "Add Vendor"}
                </Button>
            </div>
        </form>
    );
}


