/**
 * Tenant registry secret handling (S-06).
 *
 * The registry currently stores each tenant's superuser password in plaintext.
 * This module defines the encrypted form and the read path, so values can be
 * migrated without a flag day: plaintext keeps working, and anything prefixed
 * `enc:v1:` is decrypted with TENANT_REGISTRY_KEY.
 *
 * Format: enc:v1:<iv hex>:<auth tag hex>:<ciphertext base64>
 */

import crypto from 'crypto';

export const ENCRYPTED_PREFIX = 'enc:v1:';
const IV_BYTES = 12;

/** Parse TENANT_REGISTRY_KEY: 32 bytes as 64 hex characters. */
export function parseRegistryKey(raw?: string): Buffer | null {
    const value = (raw || '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(value)) return null;
    return Buffer.from(value, 'hex');
}

export function isEncryptedSecret(value?: string | null): boolean {
    return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSecret(plain: string, key: Buffer): string {
    if (key.length !== 32) throw new Error('Registry key must be 32 bytes.');
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('base64')}`;
}

/**
 * Decrypt a registry value. Plaintext passes through unchanged, which is what
 * lets the migration be incremental.
 */
export function decryptSecret(value: string, key: Buffer | null): string {
    if (!isEncryptedSecret(value)) return value;
    if (!key) {
        throw new Error('Registry value is encrypted but TENANT_REGISTRY_KEY is not set.');
    }

    const payload = value.slice(ENCRYPTED_PREFIX.length);
    const [ivHex, tagHex, dataB64] = payload.split(':');
    if (!ivHex || !tagHex || !dataB64) {
        throw new Error('Registry value is encrypted but malformed.');
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64')),
        decipher.final(),
    ]).toString('utf8');
}

/** Convenience for call sites: key from the environment, decrypt if needed. */
export function readRegistrySecret(value: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
    if (!value) return '';
    return decryptSecret(value, parseRegistryKey(env.TENANT_REGISTRY_KEY));
}
