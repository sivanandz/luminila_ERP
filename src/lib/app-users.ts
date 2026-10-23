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
    const user = await pb.collection('users').create({
        email: input.email,
        password: input.password,
        passwordConfirm: input.password,
        name: input.name,
        emailVisibility: true,
        verified: true,
    });
    return { id: user.id };
}
