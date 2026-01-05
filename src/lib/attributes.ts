/**
 * Product Attributes Service
 * CRUD for user-defined custom product fields
 * Falls back to localStorage if database table doesn't exist
 */

import { supabase } from './supabase';

export type AttributeType = 'text' | 'select' | 'number' | 'boolean' | 'date';

export interface ProductAttribute {
    id?: string;
    name: string;
    slug?: string;
    attribute_type: AttributeType;
    options?: string[]; // For select type
    default_value?: string;
    is_required?: boolean;
    is_filterable?: boolean;
    is_visible_on_product?: boolean;
    sort_order?: number;
    created_at?: string;
}

export interface ProductAttributeValue {
    id?: string;
    product_id: string;
    attribute_id: string;
    value: string;
}

const STORAGE_KEY = 'luminila_attributes';
const VALUES_STORAGE_KEY = 'luminila_attribute_values';

// ===========================================
// LOCAL STORAGE HELPERS
// ===========================================

function getLocalAttributes(): ProductAttribute[] {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

function setLocalAttributes(attributes: ProductAttribute[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attributes));
}

function getLocalAttributeValues(): ProductAttributeValue[] {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(VALUES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

function setLocalAttributeValues(values: ProductAttributeValue[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(VALUES_STORAGE_KEY, JSON.stringify(values));
}

function generateId(): string {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ===========================================
// ATTRIBUTE CRUD (with localStorage fallback)
// ===========================================

export async function getAttributes(): Promise<ProductAttribute[]> {
    try {
        const { data, error } = await supabase
            .from('product_attributes')
            .select('*')
            .order('sort_order', { ascending: true });

        if (error) {
            console.warn('Attributes table not available, using localStorage:', error.message);
            return getLocalAttributes();
        }

        // Parse JSONB options
        return (data || []).map((attr: any) => ({
            ...attr,
            options: attr.options ? (typeof attr.options === 'string' ? JSON.parse(attr.options) : attr.options) : [],
        }));
    } catch (err) {
        console.warn('Using localStorage for attributes');
        return getLocalAttributes();
    }
}

export async function getAttribute(id: string): Promise<ProductAttribute | null> {
    try {
        const { data, error } = await supabase
            .from('product_attributes')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            const local = getLocalAttributes();
            return local.find(a => a.id === id) || null;
        }
        return {
            ...data,
            options: data.options ? (typeof data.options === 'string' ? JSON.parse(data.options) : data.options) : [],
        };
    } catch {
        const local = getLocalAttributes();
        return local.find(a => a.id === id) || null;
    }
}

export async function createAttribute(attribute: Omit<ProductAttribute, 'id' | 'created_at'>): Promise<ProductAttribute> {
    const slug = attribute.slug || attribute.name.toLowerCase().replace(/\s+/g, '-');

    try {
        const { data, error } = await supabase
            .from('product_attributes')
            .insert({
                ...attribute,
                slug,
                options: attribute.options ? JSON.stringify(attribute.options) : null,
            })
            .select()
            .single();

        if (error) {
            console.warn('Using localStorage for attribute creation:', error.message);
            const newAttr: ProductAttribute = {
                ...attribute,
                id: generateId(),
                slug,
                sort_order: attribute.sort_order || 0,
                created_at: new Date().toISOString(),
            };
            const local = getLocalAttributes();
            local.push(newAttr);
            setLocalAttributes(local);
            return newAttr;
        }
        return data;
    } catch (err) {
        const newAttr: ProductAttribute = {
            ...attribute,
            id: generateId(),
            slug,
            sort_order: attribute.sort_order || 0,
            created_at: new Date().toISOString(),
        };
        const local = getLocalAttributes();
        local.push(newAttr);
        setLocalAttributes(local);
        return newAttr;
    }
}

export async function updateAttribute(id: string, updates: Partial<ProductAttribute>): Promise<ProductAttribute> {
    try {
        const updateData: any = { ...updates };
        if (updates.options) {
            updateData.options = JSON.stringify(updates.options);
        }

        const { data, error } = await supabase
            .from('product_attributes')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            const local = getLocalAttributes();
            const idx = local.findIndex(a => a.id === id);
            if (idx >= 0) {
                local[idx] = { ...local[idx], ...updates };
                setLocalAttributes(local);
                return local[idx];
            }
            throw new Error('Attribute not found');
        }
        return data;
    } catch (err: any) {
        if (err.message === 'Attribute not found') throw err;
        const local = getLocalAttributes();
        const idx = local.findIndex(a => a.id === id);
        if (idx >= 0) {
            local[idx] = { ...local[idx], ...updates };
            setLocalAttributes(local);
            return local[idx];
        }
        throw err;
    }
}

export async function deleteAttribute(id: string): Promise<void> {
    try {
        const { error } = await supabase
            .from('product_attributes')
            .delete()
            .eq('id', id);

        if (error) {
            console.warn('Using localStorage for attribute deletion');
            const local = getLocalAttributes();
            const filtered = local.filter(a => a.id !== id);
            setLocalAttributes(filtered);
            return;
        }
    } catch {
        const local = getLocalAttributes();
        const filtered = local.filter(a => a.id !== id);
        setLocalAttributes(filtered);
    }
}

// ===========================================
// ATTRIBUTE VALUES (with localStorage fallback)
// ===========================================

export async function getProductAttributeValues(productId: string): Promise<Record<string, string>> {
    try {
        const { data, error } = await supabase
            .from('product_attribute_values')
            .select('attribute_id, value')
            .eq('product_id', productId);

        if (error) {
            const local = getLocalAttributeValues();
            const values: Record<string, string> = {};
            local.filter(v => v.product_id === productId).forEach(v => {
                values[v.attribute_id] = v.value;
            });
            return values;
        }

        const values: Record<string, string> = {};
        (data || []).forEach((v: any) => {
            values[v.attribute_id] = v.value;
        });
        return values;
    } catch {
        const local = getLocalAttributeValues();
        const values: Record<string, string> = {};
        local.filter(v => v.product_id === productId).forEach(v => {
            values[v.attribute_id] = v.value;
        });
        return values;
    }
}

export async function setProductAttributeValue(
    productId: string,
    attributeId: string,
    value: string
): Promise<void> {
    try {
        const { error } = await supabase
            .from('product_attribute_values')
            .upsert({
                product_id: productId,
                attribute_id: attributeId,
                value,
            }, {
                onConflict: 'product_id,attribute_id',
            });

        if (error) {
            const local = getLocalAttributeValues();
            const idx = local.findIndex(v => v.product_id === productId && v.attribute_id === attributeId);
            if (idx >= 0) {
                local[idx].value = value;
            } else {
                local.push({ id: generateId(), product_id: productId, attribute_id: attributeId, value });
            }
            setLocalAttributeValues(local);
        }
    } catch {
        const local = getLocalAttributeValues();
        const idx = local.findIndex(v => v.product_id === productId && v.attribute_id === attributeId);
        if (idx >= 0) {
            local[idx].value = value;
        } else {
            local.push({ id: generateId(), product_id: productId, attribute_id: attributeId, value });
        }
        setLocalAttributeValues(local);
    }
}

export async function setProductAttributeValues(
    productId: string,
    values: Record<string, string>
): Promise<void> {
    for (const [attributeId, value] of Object.entries(values)) {
        await setProductAttributeValue(productId, attributeId, value);
    }
}

export async function deleteProductAttributeValues(productId: string): Promise<void> {
    try {
        const { error } = await supabase
            .from('product_attribute_values')
            .delete()
            .eq('product_id', productId);

        if (error) {
            const local = getLocalAttributeValues();
            const filtered = local.filter(v => v.product_id !== productId);
            setLocalAttributeValues(filtered);
        }
    } catch {
        const local = getLocalAttributeValues();
        const filtered = local.filter(v => v.product_id !== productId);
        setLocalAttributeValues(filtered);
    }
}
