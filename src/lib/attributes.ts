/**
 * Product Attributes Service
 * CRUD for user-defined custom product fields using PocketBase
 */

import { accountScopeEmail, pb, sanitizeFilter } from './pocketbase';

/** `&& account_email = "…"` for tenant-scoped reads under a superuser client. */
function tenantClause(): string {
    const tenant = accountScopeEmail();
    return tenant ? ` && account_email = "${sanitizeFilter(tenant)}"` : '';
}

export type AttributeType = 'text' | 'select' | 'number' | 'boolean' | 'date';

export interface ProductAttribute {
    id: string;
    name: string;
    slug?: string;
    attribute_type: AttributeType;
    options?: string[]; // For select type. Stored as JSON in PB.
    default_value?: string;
    is_required?: boolean;
    is_filterable?: boolean;
    is_visible_on_product?: boolean;
    sort_order?: number;
    created: string;
    updated: string;
}

export interface ProductAttributeValue {
    id: string;
    product: string; // Relation
    attribute: string; // Relation
    value: string;
    created: string;
    updated: string;
}

// ===========================================
// ATTRIBUTE CRUD
// ===========================================

export async function getAttributes(): Promise<ProductAttribute[]> {
    try {
        const records = await pb.collection('product_attributes').getFullList<ProductAttribute>({
            filter: `id != ""${tenantClause()}`,
            sort: 'sort_order'
        });

        // PB automatically parses JSON fields if valid JSON
        return records;
    } catch (error) {
        console.error('Error fetching attributes:', error);
        return [];
    }
}

export async function getAttribute(id: string): Promise<ProductAttribute | null> {
    try {
        const record = await pb.collection('product_attributes').getOne<ProductAttribute>(id);
        const tenant = accountScopeEmail();
        if (tenant && (record as { account_email?: string }).account_email
            && (record as { account_email?: string }).account_email !== tenant) return null;
        return record;
    } catch {
        return null;
    }
}

export async function createAttribute(attribute: Omit<ProductAttribute, 'id' | 'created' | 'updated'>): Promise<ProductAttribute> {
    const slug = attribute.slug || attribute.name.toLowerCase().replace(/\s+/g, '-');

    try {
        // Ensure options are passed correctly (array or null)
        const record = await pb.collection('product_attributes').create({
            ...attribute,
            slug,
            account_email: accountScopeEmail(),
        });
        return record as unknown as ProductAttribute;
    } catch (error) {
        console.error('Error creating attribute:', error);
        throw error;
    }
}

export async function updateAttribute(id: string, updates: Partial<ProductAttribute>): Promise<ProductAttribute> {
    try {
        const record = await pb.collection('product_attributes').update(id, updates);
        return record as unknown as ProductAttribute;
    } catch (error) {
        console.error('Error updating attribute:', error);
        throw error;
    }
}

export async function deleteAttribute(id: string): Promise<void> {
    try {
        await pb.collection('product_attributes').delete(id);
    } catch (error) {
        console.error('Error deleting attribute:', error);
        throw error;
    }
}

// ===========================================
// ATTRIBUTE VALUES
// ===========================================

export async function getProductAttributeValues(productId: string): Promise<Record<string, string>> {
    try {
        const records = await pb.collection('product_attribute_values').getFullList<ProductAttributeValue>({
            filter: `product="${sanitizeFilter(productId)}"${tenantClause()}`
        });

        const values: Record<string, string> = {};
        records.forEach(v => {
            values[v.attribute] = v.value;
        });
        return values;
    } catch (error) {
        console.error('Error fetching attribute values:', error);
        return {};
    }
}

export async function setProductAttributeValue(
    productId: string,
    attributeId: string,
    value: string
): Promise<void> {
    try {
        // Check if exists
        const records = await pb.collection('product_attribute_values').getList(1, 1, {
            filter: `product="${sanitizeFilter(productId)}" && attribute="${sanitizeFilter(attributeId)}"${tenantClause()}`
        });

        if (records.items.length > 0) {
            // Update
            await pb.collection('product_attribute_values').update(records.items[0].id, {
                value
            });
        } else {
            // Create
            await pb.collection('product_attribute_values').create({
                account_email: accountScopeEmail(),
                product: productId,
                attribute: attributeId,
                value
            });
        }
    } catch (error) {
        console.error('Error setting attribute value:', error);
        throw error;
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
        const records = await pb.collection('product_attribute_values').getFullList({
            filter: `product="${productId}"`
        });

        await Promise.all(records.map(r => pb.collection('product_attribute_values').delete(r.id)));
    } catch (error) {
        console.error('Error deleting attribute values:', error);
    }
}
