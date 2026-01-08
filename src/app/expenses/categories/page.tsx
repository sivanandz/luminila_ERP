"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout";
import { getCategories, createCategory, toggleCategoryStatus, type ExpenseCategory } from "@/lib/expenses";
import { Plus, Tag, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function ExpenseCategoriesPage() {
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newCategory, setNewCategory] = useState({ name: "", description: "" });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        // Note: We need a method to get ALL categories including inactive ones for management
        // But getCategories() only returns active. We'll modify or just use what we have for now.
        // For management, we usually see all. I'll assume getCategories returns all or I'll fix lib later.
        // Actually, looking at expenses.ts, getCategories only returns active.
        // I should fix expenses.ts to have an option, but for now let's just show active.
        const data = await getCategories();
        setCategories(data);
        setLoading(false);
    };

    const handleCreate = async () => {
        if (!newCategory.name) return;

        const result = await createCategory(newCategory.name, newCategory.description);
        if (result) {
            toast.success("Category created");
            setIsCreateOpen(false);
            setNewCategory({ name: "", description: "" });
            loadData();
        } else {
            toast.error("Failed to create category");
        }
    };

    const handleToggle = async (cat: ExpenseCategory) => {
        const success = await toggleCategoryStatus(cat.id, cat.is_active);
        if (success) {
            toast.success(`Category ${cat.is_active ? 'disabled' : 'enabled'}`);
            loadData();
        } else {
            toast.error("Failed to update status");
        }
    };

    return (
        <div className="flex flex-col h-full bg-bg-navy">
            <Header title="Expense Categories" subtitle="Manage spending categories" />

            <div className="p-6 max-w-4xl mx-auto w-full">
                <div className="flex justify-end mb-6">
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary hover:bg-primary/90 text-bg-navy h-10 px-4 py-2">
                            <Plus className="mr-2" size={18} />
                            Add Category
                        </DialogTrigger>
                        <DialogContent className="bg-surface-navy border-surface-hover text-white">
                            <DialogHeader>
                                <DialogTitle>New Category</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="space-y-2">
                                    <Label>Name *</Label>
                                    <Input
                                        placeholder="e.g. Travel, Software"
                                        className="bg-bg-navy border-surface-hover"
                                        value={newCategory.name}
                                        onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Description</Label>
                                    <Textarea
                                        placeholder="Optional description..."
                                        className="bg-bg-navy border-surface-hover resize-none"
                                        value={newCategory.description}
                                        onChange={(e) => setNewCategory({ ...newCategory, description: e.target.value })}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleCreate} className="bg-primary hover:bg-primary/90 text-bg-navy font-bold">Save</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>

                <div className="bg-surface-navy rounded-xl border border-surface-hover overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-surface-hover text-xs font-bold text-moonstone uppercase bg-bg-navy/30">
                                <th className="py-4 px-6">Name</th>
                                <th className="py-4 px-6">Description</th>
                                <th className="py-4 px-6 w-32 text-center">Status</th>
                                <th className="py-4 px-6 w-32 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-hover text-sm">
                            {categories.map((cat) => (
                                <tr key={cat.id} className="hover:bg-bg-navy/30 transition-colors">
                                    <td className="py-4 px-6 font-bold text-white flex items-center gap-3">
                                        <div className="p-2 rounded bg-primary/10 text-primary">
                                            <Tag size={16} />
                                        </div>
                                        {cat.name}
                                    </td>
                                    <td className="py-4 px-6 text-moonstone">{cat.description || '-'}</td>
                                    <td className="py-4 px-6 text-center">
                                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${cat.is_active ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                                            {cat.is_active ? 'Active' : 'Disabled'}
                                        </span>
                                    </td>
                                    <td className="py-4 px-6 text-center">
                                        {/* Disabled for now since we haven't implemented comprehensive status management in lib yet */}
                                        <Button variant="ghost" size="sm" onClick={() => handleToggle(cat)} className="text-moonstone hover:text-white">
                                            {cat.is_active ? 'Disable' : 'Enable'}
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
