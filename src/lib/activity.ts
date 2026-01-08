/**
 * Activity Logging Service
 * Audit trail for all system operations using PocketBase
 */

import { pb } from './pocketbase';

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
    try {
        const filterParts: string[] = [];

        if (filters?.action) {
            filterParts.push(`action="${filters.action}"`);
        }
        if (filters?.entity_type) {
            filterParts.push(`entity_type="${filters.entity_type}"`);
        }
        if (filters?.entity_id) {
            filterParts.push(`entity_id="${filters.entity_id}"`);
        }
        if (filters?.startDate) {
            filterParts.push(`created>="${filters.startDate}"`);
        }
        if (filters?.endDate) {
            filterParts.push(`created<="${filters.endDate}"`);
        }

        const page = Math.floor(offset / limit) + 1;
        const result = await pb.collection('activity_logs').getList(page, limit, {
            filter: filterParts.join(' && ') || '',
            sort: '-created',
        });

        let logs = result.items.map((log: any) => ({
            id: log.id,
            action: log.action,
            entity_type: log.entity_type,
            entity_id: log.entity_id,
            description: log.description,
            old_values: log.old_values,
            new_values: log.new_values,
            user_id: log.user_id,
            user_name: log.user_name,
            created_at: log.created,
        }));

        // Client-side search
        if (filters?.search) {
            const search = filters.search.toLowerCase();
            logs = logs.filter((log: ActivityLog) =>
                log.description?.toLowerCase().includes(search) ||
                log.entity_type?.toLowerCase().includes(search) ||
                log.action?.toLowerCase().includes(search)
            );
        }

        return { logs, total: result.totalItems };
    } catch (error) {
        console.error('Error fetching activity logs:', error);
        return { logs: [], total: 0 };
    }
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
    try {
        await pb.collection('activity_logs').create({
            action,
            entity_type: entityType,
            entity_id: options?.entityId || '',
            description,
            old_values: options?.oldValues,
            new_values: options?.newValues,
            user_name: options?.userName || '',
        });
    } catch (error) {
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
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const todayLogs = await pb.collection('activity_logs').getList(1, 1, {
            filter: `created>="${today.toISOString()}"`,
        });

        const weekLogs = await pb.collection('activity_logs').getFullList({
            filter: `created>="${weekAgo.toISOString()}"`,
        });

        const byAction: Record<string, number> = {};
        weekLogs.forEach((log: any) => {
            byAction[log.action] = (byAction[log.action] || 0) + 1;
        });

        return {
            todayCount: todayLogs.totalItems,
            weekCount: weekLogs.length,
            byAction: byAction as Record<ActivityAction, number>,
        };
    } catch (error) {
        console.error('Error fetching activity stats:', error);
        return {
            todayCount: 0,
            weekCount: 0,
            byAction: {} as Record<ActivityAction, number>,
        };
    }
}
