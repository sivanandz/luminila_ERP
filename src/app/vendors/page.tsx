"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Users,
    Plus,
    Search,
    Phone,
    Mail,
    MapPin,
    Package,
    MoreVertical,
    Edit,
    Trash2,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { VendorForm } from "@/components/vendor/VendorForm";
import { getVendors, deleteVendor, type Vendor } from "@/lib/vendors";

export default function VendorsPage() {
    const router = useRouter();
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [showForm, setShowForm] = useState(false);
    const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
    const [deletingVendor, setDeletingVendor] = useState<Vendor | null>(null);

    const fetchVendors = async () => {
        setLoading(true);
        const data = await getVendors();
        setVendors(data);
        setLoading(false);
    };

    useEffect(() => {
        fetchVendors();
    }, []);

    const filteredVendors = vendors.filter((v) => {
        const query = searchQuery.toLowerCase();
        return (
            v.name.toLowerCase().includes(query) ||
            v.contact_name?.toLowerCase().includes(query) ||
            v.phone?.includes(query)
        );
    });

    const handleDelete = async () => {
        if (!deletingVendor) return;
        try {
            await deleteVendor(deletingVendor.id);
            setVendors(vendors.filter((v) => v.id !== deletingVendor.id));
        } catch (error) {
            console.error("Error deleting vendor:", error);
        } finally {
            setDeletingVendor(null);
        }
    };

    const handleFormSuccess = () => {
        setShowForm(false);
        setEditingVendor(null);
        fetchVendors();
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header
                title="Vendors"
                subtitle={`${vendors.length} suppliers`}
                action={
                    <Button
                        onClick={() => setShowForm(true)}
                        className=""
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Vendor
                    </Button>
                }
            />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Actions Bar */}
                <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="relative w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search vendors..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 bg-card border-border"
                        />
                    </div>
                </div>

                {/* Vendor Grid */}
                {loading ? (
                    <div className="text-center py-12 text-muted-foreground">
                        Loading vendors...
                    </div>
                ) : filteredVendors.length === 0 ? (
                    <div className="text-center py-12">
                        <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">
                            {searchQuery ? "No vendors found" : "No vendors yet"}
                        </p>
                        <Button
                            variant="link"
                            className="text-primary mt-2"
                            onClick={() => setShowForm(true)}
                        >
                            Add your first vendor
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredVendors.map((vendor) => (
                            <Card
                                key={vendor.id}
                                className="bg-card border-border hover:bg-card/70 transition-colors cursor-pointer"
                                onClick={() => router.push(`/vendors/detail?id=${vendor.id}`)}
                            >
                                <CardContent className="pt-6">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                                                <span className="text-primary font-semibold">
                                                    {vendor.name.charAt(0).toUpperCase()}
                                                </span>
                                            </div>
                                            <div>
                                                <h3 className="font-semibold">{vendor.name}</h3>
                                                {vendor.contact_name && (
                                                    <p className="text-sm text-muted-foreground">
                                                        {vendor.contact_name}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <DropdownMenu>
                                            <DropdownMenuTrigger onClick={(e) => e.stopPropagation()}>
                                                <div className="h-9 w-9 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
                                                    <MoreVertical className="w-4 h-4" />
                                                </div>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingVendor(vendor);
                                                        setShowForm(true);
                                                    }}
                                                >
                                                    <Edit className="w-4 h-4 mr-2" />
                                                    Edit
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    className="text-red-400"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeletingVendor(vendor);
                                                    }}
                                                >
                                                    <Trash2 className="w-4 h-4 mr-2" />
                                                    Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>

                                    <div className="mt-4 space-y-2 text-sm">
                                        {vendor.phone && (
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <Phone className="w-4 h-4" />
                                                <span>{vendor.phone}</span>
                                            </div>
                                        )}
                                        {vendor.email && (
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <Mail className="w-4 h-4" />
                                                <span className="truncate">{vendor.email}</span>
                                            </div>
                                        )}
                                        {vendor.address && (
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <MapPin className="w-4 h-4 flex-shrink-0" />
                                                <span className="truncate">{vendor.address}</span>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Add/Edit Vendor Dialog */}
            <Dialog open={showForm} onOpenChange={(open) => {
                setShowForm(open);
                if (!open) setEditingVendor(null);
            }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {editingVendor ? "Edit Vendor" : "Add New Vendor"}
                        </DialogTitle>
                    </DialogHeader>
                    <VendorForm
                        vendor={editingVendor}
                        onSuccess={handleFormSuccess}
                        onCancel={() => {
                            setShowForm(false);
                            setEditingVendor(null);
                        }}
                    />
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!deletingVendor} onOpenChange={(open) => !open && setDeletingVendor(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Vendor?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete "{deletingVendor?.name}"? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}


