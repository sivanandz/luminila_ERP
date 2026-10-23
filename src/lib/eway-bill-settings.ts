/**
 * E-way bill credentials, stored per tenant in `store_settings` under the
 * single row `key="eway_bill"`. The settings component used to build that
 * filter and upsert inline (D-23).
 */

import { pb, getCurrentTenantEmail, sanitizeFilter } from './pocketbase';

export interface EwayBillConfig {
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    isProduction: boolean;
}

interface EwayBillRecord {
    id: string;
    eway_client_id?: string;
    eway_client_secret?: string;
    eway_username?: string;
    eway_password?: string;
    eway_is_production?: boolean;
}

function tenantFilter(userEmail: string): string {
    return userEmail
        ? `key="eway_bill" && account_email="${sanitizeFilter(userEmail)}"`
        : 'key="eway_bill"';
}

export async function getEwayBillConfig(): Promise<EwayBillConfig | null> {
    const userEmail = getCurrentTenantEmail();
    const filter = tenantFilter(userEmail);

    const record = await pb.collection('store_settings')
        .getFirstListItem<EwayBillRecord>(filter)
        .catch(() => null);
    if (!record) return null;

    return {
        clientId: record.eway_client_id || '',
        clientSecret: record.eway_client_secret || '',
        username: record.eway_username || '',
        password: record.eway_password || '',
        isProduction: record.eway_is_production || false,
    };
}

export async function saveEwayBillConfig(config: EwayBillConfig): Promise<void> {
    const userEmail = getCurrentTenantEmail();
    const filter = tenantFilter(userEmail);

    const data = {
        key: 'eway_bill',
        eway_client_id: config.clientId,
        eway_client_secret: config.clientSecret,
        eway_username: config.username,
        eway_password: config.password,
        eway_is_production: config.isProduction,
        account_email: userEmail || '',
    };

    const existing = await pb.collection('store_settings')
        .getFirstListItem<{ id: string }>(filter)
        .catch(() => null);

    if (existing) {
        await pb.collection('store_settings').update(existing.id, data);
    } else {
        await pb.collection('store_settings').create(data);
    }
}
