/**
 * WhatsApp Admin Account Binding & Approval Service
 * Secures WhatsApp connection to a designated Admin account and requires
 * explicit Admin approval for unbinding, session resets, or disconnection.
 */

import PocketBase, { type RecordModel } from 'pocketbase';
import { pb, getPocketBaseUrl, ensureAuth, getCurrentTenantEmail, getTenantStorageKey } from './pocketbase';

export interface WhatsAppBinding {
    isBound: boolean;
    boundAdminId: string;
    boundAdminEmail: string;
    boundAdminName: string;
    boundPhone?: string;
    boundAt: string;
    boundBy: string;
    requiresAdminApproval: boolean;
    status: 'active' | 'unbound';
}

export interface AdminUserOption {
    id: string;
    email: string;
    name: string;
    roleName: string;
}

export const DEFAULT_UNBOUND_BINDING: WhatsAppBinding = {
    isBound: false,
    boundAdminId: '',
    boundAdminEmail: '',
    boundAdminName: '',
    boundPhone: '',
    boundAt: '',
    boundBy: '',
    requiresAdminApproval: false,
    status: 'unbound',
};

const BINDING_SETTING_KEY = 'whatsapp_binding';
const getBindingStorageKey = () => getTenantStorageKey('luminila_whatsapp_binding_v1');

/**
 * Retrieve the current WhatsApp account binding status.
 * Reads from PocketBase `store_settings`, falling back to localStorage cache.
 */
export async function getWhatsAppBinding(): Promise<WhatsAppBinding> {
    ensureAuth();
    const userEmail = getCurrentTenantEmail();
    const filter = userEmail ? `key="${BINDING_SETTING_KEY}" && account_email="${userEmail}"` : `key="${BINDING_SETTING_KEY}"`;

    try {
        const record = await pb.collection('store_settings').getFirstListItem(filter);
        if (record && record.value) {
            const parsed = typeof record.value === 'string' ? JSON.parse(record.value) : record.value;
            const binding: WhatsAppBinding = {
                ...DEFAULT_UNBOUND_BINDING,
                ...parsed,
            };

            if (typeof window !== 'undefined') {
                localStorage.setItem(getBindingStorageKey(), JSON.stringify(binding));
            }
            return binding;
        }
    } catch {
        // Fall back to localStorage if offline or record does not exist
    }

    if (typeof window !== 'undefined') {
        const cached = localStorage.getItem(getBindingStorageKey());
        if (cached) {
            try {
                return { ...DEFAULT_UNBOUND_BINDING, ...JSON.parse(cached) };
            } catch {
                // Ignore parse errors
            }
        }
    }

    return DEFAULT_UNBOUND_BINDING;
}

/**
 * Bind the active WhatsApp instance to a designated Admin account.
 */
export async function bindWhatsAppAccount(
    admin: { id: string; email: string; name: string },
    boundByEmail: string,
    phone?: string
): Promise<WhatsAppBinding> {
    const bindingData: WhatsAppBinding = {
        isBound: true,
        boundAdminId: admin.id,
        boundAdminEmail: admin.email,
        boundAdminName: admin.name || admin.email.split('@')[0],
        boundPhone: phone || '',
        boundAt: new Date().toISOString(),
        boundBy: boundByEmail,
        requiresAdminApproval: true,
        status: 'active',
    };

    if (typeof window !== 'undefined') {
        localStorage.setItem(getBindingStorageKey(), JSON.stringify(bindingData));
    }

    try {
        ensureAuth();
        const userEmail = getCurrentTenantEmail();
        const filter = userEmail ? `key="${BINDING_SETTING_KEY}" && account_email="${userEmail}"` : `key="${BINDING_SETTING_KEY}"`;

        let existingId: string | null = null;
        try {
            const existing = await pb.collection('store_settings').getFirstListItem(filter);
            existingId = existing.id;
        } catch {
            existingId = null;
        }

        if (existingId) {
            await pb.collection('store_settings').update(existingId, {
                value: bindingData,
                category: 'whatsapp',
                account_email: userEmail,
            });
        } else {
            await pb.collection('store_settings').create({
                key: BINDING_SETTING_KEY,
                value: bindingData,
                category: 'whatsapp',
                account_email: userEmail,
            });
        }
    } catch (err) {
        console.error('[WhatsApp Binding] Failed to persist binding to PocketBase:', err);
    }

    return bindingData;
}

/**
 * Unbind WhatsApp instance after Admin approval has been verified.
 */
export async function unbindWhatsAppAccount(approverEmail: string): Promise<WhatsAppBinding> {
    const unboundData: WhatsAppBinding = {
        isBound: false,
        boundAdminId: '',
        boundAdminEmail: '',
        boundAdminName: '',
        boundPhone: '',
        boundAt: '',
        boundBy: approverEmail,
        requiresAdminApproval: false,
        status: 'unbound',
    };

    if (typeof window !== 'undefined') {
        localStorage.setItem(getBindingStorageKey(), JSON.stringify(unboundData));
    }

    try {
        ensureAuth();
        const userEmail = getCurrentTenantEmail();
        const filter = userEmail ? `key="${BINDING_SETTING_KEY}" && account_email="${userEmail}"` : `key="${BINDING_SETTING_KEY}"`;

        const existing = await pb.collection('store_settings').getFirstListItem(filter);
        if (existing) {
            await pb.collection('store_settings').update(existing.id, {
                value: unboundData,
                category: 'whatsapp',
                account_email: userEmail,
            });
        }
    } catch (err) {
        console.error('[WhatsApp Binding] Failed to update unbind in PocketBase:', err);
    }

    return unboundData;
}

/**
 * Authenticate and verify admin credentials for an approval action.
 * Uses an isolated client to preserve the user's active session.
 */
export async function verifyAdminApproval(
    email: string,
    password: string,
    requiredAdminId?: string
): Promise<{
    success: boolean;
    error?: string;
    adminUser?: { id: string; email: string; name: string; isSuperuser?: boolean };
}> {
    if (!email || !password) {
        return { success: false, error: 'Email and password are required.' };
    }

    const tempPb = new PocketBase(getPocketBaseUrl());
    tempPb.autoCancellation(false);

    let authRecord: RecordModel | null = null;
    let isSuperuser = false;

    // 1. Try standard users collection
    try {
        const res = await tempPb.collection('users').authWithPassword(email.trim(), password);
        authRecord = res.record;
    } catch (userErr) {
        // 2. Try _superusers collection fallback
        try {
            const superRes = await tempPb.collection('_superusers').authWithPassword(email.trim(), password);
            authRecord = superRes.record;
            isSuperuser = true;
        } catch {
            return {
                success: false,
                error: (userErr instanceof Error ? userErr.message : String(userErr)) || 'Invalid credentials or user not found.',
            };
        }
    }

    if (!authRecord) {
        return { success: false, error: 'Authentication failed.' };
    }

    // 3. Superuser is automatically authorized with top-level privilege
    if (isSuperuser) {
        return {
            success: true,
            adminUser: {
                id: authRecord.id,
                email: authRecord.email,
                name: authRecord.name || 'Super Admin',
                isSuperuser: true,
            },
        };
    }

    // 4. Verify user status
    if (authRecord.is_active === false) {
        return { success: false, error: 'This admin account is currently inactive.' };
    }

    // 5. Verify Admin Role in RBAC
    try {
        const userRoles = await tempPb.collection('user_roles').getFullList({
            filter: `user="${authRecord.id}"`,
            expand: 'role',
        });

        const isUserAdmin = userRoles.some(
            (ur) =>
                ur.expand?.role?.name === 'Admin' ||
                ur.expand?.role?.name === 'Super Admin'
        );

        if (!isUserAdmin) {
            return { success: false, error: 'The provided account does not have Administrator privileges.' };
        }

        // If a specific admin binding is targeted, check if this is the bound admin or super admin
        if (requiredAdminId && authRecord.id !== requiredAdminId) {
            const isSuperAdmin = userRoles.some((ur) => ur.expand?.role?.name === 'Super Admin');
            if (!isSuperAdmin) {
                return {
                    success: false,
                    error: 'Action requires approval from the bound Administrator or a Super Admin.',
                };
            }
        }

        return {
            success: true,
            adminUser: {
                id: authRecord.id,
                email: authRecord.email,
                name: authRecord.name || authRecord.email.split('@')[0],
                isSuperuser: false,
            },
        };
    } catch (roleErr) {
        console.error('[WhatsApp Binding] Role verification failed:', roleErr);
        return { success: false, error: 'Could not verify admin role permissions.' };
    }
}

/**
 * Fetch list of admin users eligible for binding.
 */
export async function getAdminUsers(): Promise<AdminUserOption[]> {
    try {
        const users = await pb.collection('users').getFullList({
            filter: 'is_active!=false',
            sort: 'name',
        });

        const allUserRoles = await pb.collection('user_roles').getFullList({
            expand: 'role',
        });

        const adminOptions: AdminUserOption[] = [];

        for (const u of users) {
            const roles = allUserRoles.filter((ur) => ur.user === u.id);
            const adminRole = roles.find(
                (ur) =>
                    ur.expand?.role?.name === 'Admin' ||
                    ur.expand?.role?.name === 'Super Admin'
            );

            if (adminRole) {
                adminOptions.push({
                    id: u.id,
                    email: u.email,
                    name: u.name || u.email.split('@')[0],
                    roleName: adminRole.expand?.role?.name || 'Admin',
                });
            }
        }

        // Fallback default if no explicit admin roles returned
        if (adminOptions.length === 0) {
            adminOptions.push({
                id: 'e9zgt73u78651d4',
                email: 'admin@luminila.local',
                name: 'System Admin',
                roleName: 'Admin',
            });
        }

        return adminOptions;
    } catch (err) {
        console.warn('[WhatsApp Binding] Error fetching admin users, using fallback:', err);
        return [
            {
                id: 'e9zgt73u78651d4',
                email: 'admin@luminila.local',
                name: 'System Admin',
                roleName: 'Admin',
            },
        ];
    }
}
