/**
 * Fresh-deployment bootstrap for the single-account model.
 *
 * A single-account deployment has no setup wizard (`/setup` redirects to
 * `/login`), so the first admin, the RBAC catalog and the store settings must
 * exist before anyone can sign in. This hook creates them once, while the
 * `users` collection is still empty, and is a no-op on every later boot.
 *
 * Every failure is logged and returned as `skipped` with a reason: a boot hook
 * must never take the server down, and PocketBase is often not listening yet
 * when Next starts.
 */

import PocketBase from 'pocketbase';
import { DEFAULT_SETUP_ROLES } from './setup';
import {
    isSingleAccountMode,
    SINGLE_ACCOUNT_EMAIL,
    SINGLE_ACCOUNT_STORE_NAME,
} from './deployment-mode';
import { getPocketBaseUrl, sanitizeFilter } from './pocketbase';
import { resolvePrimaryPocketBasePort } from './tenant-db-manager';

export interface SingleAccountBootstrapResult {
    skipped: boolean;
    created: boolean;
    reason?: string;
}

const CONNECT_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve the primary instance's URL.
 *
 * An explicitly configured URL wins. Otherwise probe the primary port instead
 * of assuming `getPocketBaseUrl()`'s 8090 default: `resolvePrimaryPocketBasePort`
 * prefers 8091, so the 8090 default would miss the instance it detects.
 */
async function resolveBootstrapUrl(): Promise<string> {
    const configured = (process.env.PB_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || '').trim();
    if (configured) return getPocketBaseUrl();
    return `http://127.0.0.1:${await resolvePrimaryPocketBasePort()}`;
}

/**
 * Retry a read-only attempt (connect/authenticate/list) while PocketBase is
 * starting. Writes are never retried: a lost response must not create a second
 * admin or a duplicate role link.
 */
async function withRetry<T>(action: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
        try {
            return await action();
        } catch (error) {
            lastError = error;
            if (attempt < CONNECT_ATTEMPTS) {
                await delay(RETRY_BASE_DELAY_MS * attempt);
            }
        }
    }
    throw lastError;
}

/** Return the role id, creating the role when the fresh database lacks it. */
async function ensureRole(
    client: PocketBase,
    role: (typeof DEFAULT_SETUP_ROLES)[number]
): Promise<string> {
    try {
        const existing = await client
            .collection('roles')
            .getFirstListItem(`name="${sanitizeFilter(role.name)}"`);
        return existing.id;
    } catch (error) {
        if ((error as { status?: number })?.status !== 404) throw error;
        const created = await client.collection('roles').create(role);
        return created.id;
    }
}

/** Write the store name once, scoped to the single account. */
async function seedStoreSettings(client: PocketBase): Promise<void> {
    const filter = `key="store_name" && account_email="${sanitizeFilter(SINGLE_ACCOUNT_EMAIL)}"`;
    try {
        await client.collection('store_settings').getFirstListItem(filter);
        return;
    } catch (error) {
        if ((error as { status?: number })?.status !== 404) throw error;
    }

    await client.collection('store_settings').create({
        key: 'store_name',
        value: SINGLE_ACCOUNT_STORE_NAME,
        category: 'general',
        account_email: SINGLE_ACCOUNT_EMAIL,
    });
}

async function bootstrap(): Promise<SingleAccountBootstrapResult> {
    if (!isSingleAccountMode()) {
        return { skipped: true, created: false, reason: 'multi-account mode' };
    }

    const password = process.env.INITIAL_ADMIN_PASSWORD || process.env.ACCOUNT_PASSWORD || '';
    if (!password) {
        return {
            skipped: true,
            created: false,
            reason: 'INITIAL_ADMIN_PASSWORD (or ACCOUNT_PASSWORD) is not set',
        };
    }

    // Every row is stamped with SINGLE_ACCOUNT_EMAIL, and the business rules
    // require account_email = @request.auth.email for client writes, so the
    // admin's login email must be the account email. A mismatched override is
    // refused instead of creating an account that cannot see its own data.
    const requestedEmail = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
    if (requestedEmail && requestedEmail !== SINGLE_ACCOUNT_EMAIL) {
        const reason =
            `INITIAL_ADMIN_EMAIL '${requestedEmail}' does not match the single-account email ` +
            `'${SINGLE_ACCOUNT_EMAIL}'; use the account email or unset INITIAL_ADMIN_EMAIL`;
        console.warn(`[single-account-bootstrap] ${reason}.`);
        return { skipped: true, created: false, reason };
    }

    const superuserEmail = (
        process.env.POCKETBASE_SUPERUSER_EMAIL ||
        process.env.PB_ADMIN_EMAIL ||
        ''
    ).trim();
    const superuserPassword =
        process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || '';
    if (!superuserEmail || !superuserPassword) {
        return {
            skipped: true,
            created: false,
            reason:
                'POCKETBASE_SUPERUSER_EMAIL/POCKETBASE_SUPERUSER_PASSWORD ' +
                '(or PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD) is not set',
        };
    }

    const url = await resolveBootstrapUrl();
    const client = new PocketBase(url);
    client.autoCancellation(false);

    let userCount: number;
    try {
        userCount = await withRetry(async () => {
            if (!client.authStore.isValid) {
                await client
                    .collection('_superusers')
                    .authWithPassword(superuserEmail, superuserPassword);
            }
            const users = await client.collection('users').getList(1, 1);
            return users.totalItems;
        });
    } catch (error) {
        const reason = `could not reach or authenticate to PocketBase at ${url}: ${errorMessage(error)}`;
        console.error(
            `[single-account-bootstrap] ${reason}. ` +
                'Ensure PocketBase is running and POCKETBASE_SUPERUSER_* (or PB_ADMIN_*) match it; ' +
                'the bootstrap retries on the next boot.'
        );
        return { skipped: true, created: false, reason };
    }

    if (userCount > 0) {
        return { skipped: true, created: false, reason: 'users collection is not empty' };
    }

    let adminRoleId: string | undefined;
    for (const role of DEFAULT_SETUP_ROLES) {
        try {
            const roleId = await ensureRole(client, role);
            if (role.name === 'Admin') adminRoleId = roleId;
        } catch (error) {
            console.error(
                `[single-account-bootstrap] Could not seed the ${role.name} role: ${errorMessage(error)}`
            );
        }
    }
    if (!adminRoleId) {
        return { skipped: true, created: false, reason: 'the Admin role could not be seeded' };
    }

    let adminUserId: string;
    try {
        const admin = await client.collection('users').create({
            email: SINGLE_ACCOUNT_EMAIL,
            password,
            passwordConfirm: password,
            name: 'Store Admin',
            emailVisibility: true,
            verified: true,
            is_active: true,
            account_email: SINGLE_ACCOUNT_EMAIL,
        });
        adminUserId = admin.id;
    } catch (error) {
        const reason = `could not create the admin user: ${errorMessage(error)}`;
        console.error(`[single-account-bootstrap] ${reason}.`);
        return { skipped: true, created: false, reason };
    }

    let roleLinked = false;
    try {
        await client.collection('user_roles').create({
            user: adminUserId,
            role: adminRoleId,
            account_email: SINGLE_ACCOUNT_EMAIL,
        });
        roleLinked = true;
    } catch (error) {
        // The account exists but holds no Admin role; without it the user
        // cannot manage users, so the outcome is reported instead of hidden.
        console.error(
            `[single-account-bootstrap] Created ${SINGLE_ACCOUNT_EMAIL} but could not link the Admin role: ` +
                `${errorMessage(error)}. Link it from the Users screen.`
        );
    }

    try {
        await seedStoreSettings(client);
    } catch (error) {
        console.warn(
            `[single-account-bootstrap] Could not write the store_name setting: ${errorMessage(error)}. ` +
                'The Settings screen can set it.'
        );
    }

    return roleLinked
        ? { skipped: false, created: true }
        : {
              skipped: false,
              created: true,
              reason: 'admin created but the Admin role link failed',
          };
}

/**
 * Create the first admin, default roles and store settings when this is a
 * single-account deployment whose `users` collection is empty.
 *
 * Idempotent: once any user exists the hook does nothing. Never throws; the
 * caller only logs the returned outcome.
 */
export async function ensureSingleAccountAdmin(): Promise<SingleAccountBootstrapResult> {
    try {
        return await bootstrap();
    } catch (error) {
        const reason = `unexpected bootstrap failure: ${errorMessage(error)}`;
        console.error(`[single-account-bootstrap] ${reason}.`);
        return { skipped: true, created: false, reason };
    }
}
