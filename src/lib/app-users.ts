/**
 * Application user creation (D-23).
 */

import { pb } from './pocketbase';

export interface NewAppUser {
    email: string;
    password: string;
    name: string;
}

export async function createAppUser(input: NewAppUser): Promise<{ id: string }> {
    // Staff accounts belong to the tenant that creates them. The users
    // collection is tenant-scoped by account_email; a record without it is
    // invisible to every rule and effectively orphaned.
    const accountEmail = String((pb.authStore.model as { email?: string } | null)?.email || '').trim().toLowerCase();
    if (!accountEmail) {
        throw new Error('Cannot create a staff account without a signed-in tenant owner.');
    }
    const user = await pb.collection('users').create({
        email: input.email,
        password: input.password,
        passwordConfirm: input.password,
        name: input.name,
        emailVisibility: true,
        verified: true,
        account_email: accountEmail,
    });
    return { id: user.id };
}
