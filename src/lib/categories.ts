/**
 * Categories Service
 * CRUD operations for user-defined product categories
 * Falls back to localStorage if database table doesn't exist
 */

import { supabase } from './supabase';

export interface Category {
    id?: string;
    name: string;
    slug?: string;
    description?: string;
    parent_id?: string | null;
    sort_order?: number;
    icon?: string;
    color?: string;
    is_active?: boolean;
    created_at?: string;
    updated_at?: string;
    // Virtual fields for UI
    children?: Category[];
    level?: number;
}

const STORAGE_KEY = 'luminila_categories';

// ===========================================
// LOCAL STORAGE HELPERS
// ===========================================

function getLocalCategories(): Category[] {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

function setLocalCategories(categories: Category[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
}

function generateId(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ===========================================
// CRUD OPERATIONS (with localStorage fallback)
// ===========================================

export async function getCategories(activeOnly: boolean = false): Promise<Category[]> {
    try {
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .order('sort_order', { ascending: true });

        if (error) {
            console.warn('Categories table not available, using localStorage:', error.message);
            const local = getLocalCategories();
            return activeOnly ? local.filter(c => c.is_active !== false) : local;
        }
        return data || [];
    } catch (err) {
        console.warn('Using localStorage for categories');
        const local = getLocalCategories();
        return activeOnly ? local.filter(c => c.is_active !== false) : local;
    }
}

export async function getCategoryTree(): Promise<Category[]> {
    const categories = await getCategories(true);
    return buildTree(categories);
}

function buildTree(categories: Category[], parentId: string | null = null, level: number = 0): Category[] {
    return categories
        .filter(cat => cat.parent_id === parentId)
        .map(cat => ({
            ...cat,
            level,
            children: buildTree(categories, cat.id!, level + 1),
        }));
}

export async function getCategory(id: string): Promise<Category | null> {
    try {
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            const local = getLocalCategories();
            return local.find(c => c.id === id) || null;
        }
        return data;
    } catch {
        const local = getLocalCategories();
        return local.find(c => c.id === id) || null;
    }
}

export async function createCategory(category: Omit<Category, 'id' | 'created_at' | 'updated_at'>): Promise<Category> {
    const slug = category.slug || category.name.toLowerCase().replace(/\s+/g, '-');

    try {
        const { data, error } = await supabase
            .from('categories')
            .insert({ ...category, slug })
            .select()
            .single();

        if (error) {
            console.warn('Using localStorage for category creation:', error.message);
            const newCategory: Category = {
                ...category,
                id: generateId(),
                slug,
                is_active: true,
                sort_order: category.sort_order || 0,
                created_at: new Date().toISOString(),
            };
            const local = getLocalCategories();
            local.push(newCategory);
            setLocalCategories(local);
            return newCategory;
        }
        return data;
    } catch (err) {
        const newCategory: Category = {
            ...category,
            id: generateId(),
            slug,
            is_active: true,
            sort_order: category.sort_order || 0,
            created_at: new Date().toISOString(),
        };
        const local = getLocalCategories();
        local.push(newCategory);
        setLocalCategories(local);
        return newCategory;
    }
}

export async function updateCategory(id: string, updates: Partial<Category>): Promise<Category> {
    try {
        const { data, error } = await supabase
            .from('categories')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            const local = getLocalCategories();
            const idx = local.findIndex(c => c.id === id);
            if (idx >= 0) {
                local[idx] = { ...local[idx], ...updates, updated_at: new Date().toISOString() };
                setLocalCategories(local);
                return local[idx];
            }
            throw new Error('Category not found');
        }
        return data;
    } catch (err: any) {
        if (err.message === 'Category not found') throw err;
        const local = getLocalCategories();
        const idx = local.findIndex(c => c.id === id);
        if (idx >= 0) {
            local[idx] = { ...local[idx], ...updates, updated_at: new Date().toISOString() };
            setLocalCategories(local);
            return local[idx];
        }
        throw err;
    }
}

export async function deleteCategory(id: string): Promise<void> {
    try {
        const { error } = await supabase
            .from('categories')
            .delete()
            .eq('id', id);

        if (error) {
            console.warn('Using localStorage for category deletion');
            const local = getLocalCategories();
            const filtered = local.filter(c => c.id !== id);
            setLocalCategories(filtered);
            return;
        }
    } catch {
        const local = getLocalCategories();
        const filtered = local.filter(c => c.id !== id);
        setLocalCategories(filtered);
    }
}

export async function toggleCategoryActive(id: string, isActive: boolean): Promise<void> {
    await updateCategory(id, { is_active: isActive });
}

// ===========================================
// UTILITY
// ===========================================

export function flattenCategories(tree: Category[], prefix: string = ''): { id: string; name: string; level: number }[] {
    const result: { id: string; name: string; level: number }[] = [];

    for (const cat of tree) {
        result.push({
            id: cat.id!,
            name: prefix + cat.name,
            level: cat.level || 0,
        });
        if (cat.children && cat.children.length > 0) {
            result.push(...flattenCategories(cat.children, prefix + '  '));
        }
    }

    return result;
}
