/**
 * Expense Management Service
 * Handles business expenses, categories, and statistics using PocketBase
 */

import { pb } from './pocketbase';
import { toast } from 'sonner';

// ==========================================
// TYPES
// ==========================================

export type ExpensePaymentMode = 'cash' | 'card' | 'upi' | 'bank_transfer' | 'cheque' | 'other';

export interface ExpenseCategory {
    id: string;
    name: string;
    description?: string;
    is_active: boolean;
    created_at?: string;
}

export interface Expense {
    id?: string;
    expense_number?: string;
    date: string;
    category_id: string;
    category?: ExpenseCategory;
    amount: number;
    payment_mode: ExpensePaymentMode;
    payee?: string;
    description?: string;
    receipt_url?: string;
    reference_number?: string;
    created_by?: string;
    created_at?: string;
    updated_at?: string;
}

export interface ExpenseStats {
    totalAmount: number;
    totalCount: number;
    byCategory: { name: string; amount: number; percentage: number }[];
    recentExpenses: Expense[];
}

// ==========================================
// NUMBER GENERATION
// ==========================================
async function generateExpenseNumber(): Promise<string> {
    const seqName = 'expense';

    try {
        let seq = await pb.collection('number_sequences').getFirstListItem(`name="${seqName}"`).catch(() => null);

        let nextValue: number;
        if (seq) {
            nextValue = (seq.current_value || 0) + 1;
            await pb.collection('number_sequences').update(seq.id, { current_value: nextValue });
        } else {
            nextValue = 1;
            await pb.collection('number_sequences').create({
                name: seqName,
                prefix: 'EXP',
                current_value: nextValue,
                padding: 5,
            });
        }

        return `EXP-${nextValue.toString().padStart(5, '0')}`;
    } catch (error) {
        console.error('Error generating expense number:', error);
        return `EXP-${Date.now()}`;
    }
}

// ==========================================
// EXPENSE CRUD
// ==========================================

export async function getExpenses(filters?: {
    startDate?: string;
    endDate?: string;
    categoryId?: string;
    search?: string;
}): Promise<Expense[]> {
    try {
        const filterParts: string[] = [];

        if (filters?.startDate) {
            filterParts.push(`date>="${filters.startDate}"`);
        }
        if (filters?.endDate) {
            filterParts.push(`date<="${filters.endDate}"`);
        }
        if (filters?.categoryId && filters.categoryId !== 'all') {
            filterParts.push(`category="${filters.categoryId}"`);
        }
        if (filters?.search) {
            const isAmount = !isNaN(Number(filters.search));
            if (isAmount) {
                filterParts.push(`amount=${Number(filters.search)}`);
            } else {
                filterParts.push(`(payee~"${filters.search}" || description~"${filters.search}")`);
            }
        }

        const records = await pb.collection('expenses').getFullList({
            filter: filterParts.join(' && ') || '',
            sort: '-date,-created',
            expand: 'category',
        });

        return records.map((e: any) => ({
            id: e.id,
            expense_number: e.expense_number,
            date: e.date,
            category_id: e.category,
            category: e.expand?.category ? {
                id: e.expand.category.id,
                name: e.expand.category.name,
                description: e.expand.category.description,
                is_active: e.expand.category.is_active,
            } : undefined,
            amount: e.amount,
            payment_mode: e.payment_mode,
            payee: e.payee,
            description: e.description,
            receipt_url: e.receipt_url,
            reference_number: e.reference_number,
            created_at: e.created,
            updated_at: e.updated,
        }));
    } catch (error) {
        console.error('Error fetching expenses:', error);
        return [];
    }
}

export async function getExpense(id: string): Promise<Expense | null> {
    try {
        const e = await pb.collection('expenses').getOne(id, {
            expand: 'category',
        });

        return {
            id: e.id,
            expense_number: e.expense_number,
            date: e.date,
            category_id: e.category,
            category: e.expand?.category ? {
                id: e.expand.category.id,
                name: e.expand.category.name,
                description: e.expand.category.description,
                is_active: e.expand.category.is_active,
            } : undefined,
            amount: e.amount,
            payment_mode: e.payment_mode,
            payee: e.payee,
            description: e.description,
            receipt_url: e.receipt_url,
            reference_number: e.reference_number,
            created_at: e.created,
            updated_at: e.updated,
        };
    } catch (error) {
        console.error('Error fetching expense:', error);
        return null;
    }
}

export async function createExpense(expense: Omit<Expense, 'id' | 'expense_number' | 'created_at' | 'updated_at'>): Promise<Expense | null> {
    try {
        const expenseNumber = await generateExpenseNumber();

        const e = await pb.collection('expenses').create({
            expense_number: expenseNumber,
            date: expense.date,
            category: expense.category_id,
            amount: expense.amount,
            payment_mode: expense.payment_mode,
            payee: expense.payee || '',
            description: expense.description || '',
            receipt_url: expense.receipt_url || '',
            reference_number: expense.reference_number || '',
        });

        return {
            id: e.id,
            expense_number: expenseNumber,
            date: expense.date,
            category_id: expense.category_id,
            amount: expense.amount,
            payment_mode: expense.payment_mode,
            payee: expense.payee,
            description: expense.description,
            receipt_url: expense.receipt_url,
            reference_number: expense.reference_number,
            created_at: e.created,
            updated_at: e.updated,
        };
    } catch (error) {
        console.error('Error creating expense:', error);
        toast.error('Failed to create expense');
        return null;
    }
}

export async function updateExpense(id: string, updates: Partial<Expense>): Promise<Expense | null> {
    try {
        const { category, expense_number, id: expenseId, created_at, updated_at, ...cleanUpdates } = updates as any;

        // Map category_id to category (PocketBase relation field name)
        if (cleanUpdates.category_id) {
            cleanUpdates.category = cleanUpdates.category_id;
            delete cleanUpdates.category_id;
        }

        const e = await pb.collection('expenses').update(id, cleanUpdates);

        return {
            id: e.id,
            expense_number: e.expense_number,
            date: e.date,
            category_id: e.category,
            amount: e.amount,
            payment_mode: e.payment_mode,
            payee: e.payee,
            description: e.description,
            receipt_url: e.receipt_url,
            reference_number: e.reference_number,
            created_at: e.created,
            updated_at: e.updated,
        };
    } catch (error) {
        console.error('Error updating expense:', error);
        toast.error('Failed to update expense');
        return null;
    }
}

export async function deleteExpense(id: string): Promise<boolean> {
    try {
        await pb.collection('expenses').delete(id);
        toast.success('Expense deleted');
        return true;
    } catch (error) {
        console.error('Error deleting expense:', error);
        toast.error('Failed to delete expense');
        return false;
    }
}

// ==========================================
// CATEGORY CRUD
// ==========================================

export async function getCategories(): Promise<ExpenseCategory[]> {
    try {
        const records = await pb.collection('expense_categories').getFullList({
            filter: 'is_active=true',
            sort: 'name',
        });

        return records.map((c: any) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            is_active: c.is_active,
            created_at: c.created,
        }));
    } catch (error) {
        console.error('Error fetching expense categories:', error);
        return [];
    }
}

export async function createCategory(name: string, description?: string): Promise<ExpenseCategory | null> {
    try {
        const c = await pb.collection('expense_categories').create({
            name,
            description: description || '',
            is_active: true,
        });

        return {
            id: c.id,
            name: c.name,
            description: c.description,
            is_active: c.is_active,
            created_at: c.created,
        };
    } catch (error) {
        console.error('Error creating category:', error);
        return null;
    }
}

export async function toggleCategoryStatus(id: string, currentlyActive: boolean): Promise<boolean> {
    try {
        await pb.collection('expense_categories').update(id, { is_active: !currentlyActive });
        return true;
    } catch (error) {
        console.error('Error updating category:', error);
        return false;
    }
}

// ==========================================
// STATS & ANALYTICS
// ==========================================

export async function getExpenseStats(startDate?: string, endDate?: string): Promise<ExpenseStats> {
    try {
        const filterParts: string[] = [];
        if (startDate) filterParts.push(`date>="${startDate}"`);
        if (endDate) filterParts.push(`date<="${endDate}"`);

        const expenses = await pb.collection('expenses').getFullList({
            filter: filterParts.join(' && ') || '',
            expand: 'category',
        });

        const totalAmount = expenses.reduce((sum: number, e: any) => sum + Number(e.amount), 0);
        const totalCount = expenses.length;

        // Group by category
        const categoryMap = new Map<string, number>();
        expenses.forEach((e: any) => {
            const catName = e.expand?.category?.name || 'Uncategorized';
            const current = categoryMap.get(catName) || 0;
            categoryMap.set(catName, current + Number(e.amount));
        });

        const byCategory = Array.from(categoryMap.entries())
            .map(([name, amount]) => ({
                name,
                amount,
                percentage: totalAmount > 0 ? (amount / totalAmount) * 100 : 0
            }))
            .sort((a, b) => b.amount - a.amount);

        // Get 5 most recent
        const recentExpenses = await getExpenses({ startDate, endDate }).then(list => list.slice(0, 5));

        return {
            totalAmount,
            totalCount,
            byCategory,
            recentExpenses
        };
    } catch (error) {
        console.error('Error calculating expense stats:', error);
        return {
            totalAmount: 0,
            totalCount: 0,
            byCategory: [],
            recentExpenses: []
        };
    }
}
