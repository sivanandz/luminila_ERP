/**
 * Activity Logging Service
 * Audit trail for all system operations
 */

import { supabase } from './supabase';
import { format } from 'date-fns';

// ===========================================
// TYPES
// ===========================================

export type ActivityAction =
    | 'create'
    | 'update'
    | 'delete'
    | 'login'
    | 'logout'
    | 'export'
    | 'print'
    | 'status_change'
    | 'payment'
    | 'sync';

export type EntityType =
    | 'product'
    | 'invoice'
    | 'sale'
    | 'order'
    | 'customer'
    | 'vendor'
    | 'purchase_order'
    | 'grn'
    | 'user'
    | 'settings';

export interface ActivityLog {
    id: string;
    action: ActivityAction;
    entity_type: EntityType;
    entity_id?: string;
    description: string;
    old_values?: Record<string, any>;
    new_values?: Record<string, any>;
    user_id?: string;
    user_name?: string;
    created_at: string;
}

export interface ActivityFilter {
    action?: ActivityAction;
    entity_type?: EntityType;
    entity_id?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
}

// ===========================================
// FETCH ACTIVITY LOGS
// ===========================================

export async function getActivityLogs(
    filters?: ActivityFilter,
    limit: number = 50,
    offset: number = 0
): Promise<{ logs: ActivityLog[]; total: number }> {
    let query = supabase
        .from('activity_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (filters?.action) {
        query = query.eq('action', filters.action);
    }

    if (filters?.entity_type) {
        query = query.eq('entity_type', filters.entity_type);
    }

    if (filters?.entity_id) {
        query = query.eq('entity_id', filters.entity_id);
    }

    if (filters?.startDate) {
        query = query.gte('created_at', filters.startDate);
    }

    if (filters?.endDate) {
        query = query.lte('created_at', filters.endDate);
    }

    const { data, count, error } = await query;

    if (error) {
        console.error('Error fetching activity logs:', error);
        return { logs: [], total: 0 };
    }

    let logs = data || [];

    // Client-side search
    if (filters?.search) {
        const search = filters.search.toLowerCase();
        logs = logs.filter((log: any) =>
            log.description?.toLowerCase().includes(search) ||
            log.entity_type?.toLowerCase().includes(search) ||
            log.action?.toLowerCase().includes(search)
        );
    }

    return { logs, total: count || 0 };
}

// ===========================================
// LOG ACTIVITY (Manual)
// ===========================================

export async function logActivity(
    action: ActivityAction,
    entityType: EntityType,
    description: string,
    options?: {
        entityId?: string;
        oldValues?: Record<string, any>;
        newValues?: Record<string, any>;
        userName?: string;
    }
): Promise<void> {
    const { error } = await supabase.from('activity_logs').insert({
        action,
        entity_type: entityType,
        entity_id: options?.entityId,
        description,
        old_values: options?.oldValues,
        new_values: options?.newValues,
        user_name: options?.userName,
    });

    if (error) {
        console.error('Error logging activity:', error);
    }
}

// ===========================================
// ENTITY-SPECIFIC HELPERS
// ===========================================

export async function logProductCreated(productId: string, productName: string): Promise<void> {
    await logActivity('create', 'product', `Product created: ${productName}`, {
        entityId: productId,
        newValues: { name: productName },
    });
}

export async function logInvoiceCreated(invoiceId: string, invoiceNumber: string, total: number): Promise<void> {
    await logActivity('create', 'invoice', `Invoice ${invoiceNumber} created`, {
        entityId: invoiceId,
        newValues: { invoice_number: invoiceNumber, total },
    });
}

export async function logSaleCompleted(saleId: string, total: number, paymentMethod: string): Promise<void> {
    await logActivity('create', 'sale', `Sale completed: ₹${total.toLocaleString()}`, {
        entityId: saleId,
        newValues: { total, payment_method: paymentMethod },
    });
}

export async function logExport(entityType: EntityType, description: string): Promise<void> {
    await logActivity('export', entityType, description);
}

export async function logPrint(entityType: EntityType, entityId: string, description: string): Promise<void> {
    await logActivity('print', entityType, description, { entityId });
}

// ===========================================
// STATS
// ===========================================

export async function getActivityStats(): Promise<{
    todayCount: number;
    weekCount: number;
    byAction: Record<ActivityAction, number>;
}> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { count: todayCount } = await supabase
        .from('activity_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());

    const { count: weekCount } = await supabase
        .from('activity_logs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekAgo.toISOString());

    const { data: actionData } = await supabase
        .from('activity_logs')
        .select('action')
        .gte('created_at', weekAgo.toISOString());

    const byAction: Record<string, number> = {};
    actionData?.forEach((log: any) => {
        byAction[log.action] = (byAction[log.action] || 0) + 1;
    });

    return {
        todayCount: todayCount || 0,
        weekCount: weekCount || 0,
        byAction: byAction as Record<ActivityAction, number>,
    };
}
