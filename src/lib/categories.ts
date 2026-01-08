/**
 * Categories Service
 * CRUD operations for user-defined product categories using PocketBase
 */

import { pb } from './pocketbase';

export interface Category {
    id: string;
    name: string;
    slug?: string;
    description?: string;
    parent?: string; // Relation ID
    sort_order?: number;
    icon?: string;
    color?: string;
    is_active?: boolean;
    created: string;
    updated: string;
    // Virtual fields for UI
    children?: Category[];
    level?: number;
}

// ===========================================
// CRUD OPERATIONS
// ===========================================

export async function getCategories(activeOnly: boolean = false): Promise<Category[]> {
    try {
        const filters = activeOnly ? 'is_active=true' : '';
        const records = await pb.collection('categories').getFullList<Category>({
            filter: filters,
            sort: 'sort_order'
        });
        return records;
    } catch (error) {
        console.error('Error fetching categories:', error);
        return [];
    }
}

export async function getCategoryTree(): Promise<Category[]> {
    const categories = await getCategories(true);
    return buildTree(categories);
}

function buildTree(categories: Category[], parentId: string | undefined = undefined, level: number = 0): Category[] {
    // parent can be empty string or null in PB response sometimes if not set, or undefined in logic clearly
    return categories
        .filter(cat => (!parentId && !cat.parent) || (cat.parent === parentId))
        .map(cat => ({
            ...cat,
            level,
            children: buildTree(categories, cat.id, level + 1),
        }));
}

export async function getCategory(id: string): Promise<Category | null> {
    try {
        const record = await pb.collection('categories').getOne<Category>(id);
        return record;
    } catch (error) {
        console.error('Error fetching category:', error);
        return null;
    }
}

export async function createCategory(category: Omit<Category, 'id' | 'created' | 'updated'>): Promise<Category> {
    const slug = category.slug || category.name.toLowerCase().replace(/\s+/g, '-');

    try {
        const record = await pb.collection('categories').create({
            ...category,
            slug
        });
        return record as unknown as Category;
    } catch (error) {
        console.error('Error creating category:', error);
        throw error;
    }
}

export async function updateCategory(id: string, updates: Partial<Category>): Promise<Category> {
    try {
        const record = await pb.collection('categories').update(id, updates);
        return record as unknown as Category;
    } catch (error) {
        console.error('Error updating category:', error);
        throw error;
    }
}

export async function deleteCategory(id: string): Promise<void> {
    try {
        await pb.collection('categories').delete(id);
    } catch (error) {
        console.error('Error deleting category:', error);
        throw error;
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
            id: cat.id,
            name: prefix + cat.name,
            level: cat.level || 0,
        });
        if (cat.children && cat.children.length > 0) {
            result.push(...flattenCategories(cat.children, prefix + '  '));
        }
    }

    return result;
}
