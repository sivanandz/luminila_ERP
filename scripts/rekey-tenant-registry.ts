/**
 * Re-key tenant registry secrets (S-06).
 *
 * The registry stores each tenant's superuser password in plaintext today.
 * This script encrypts those values in place with AES-256-GCM using
 * TENANT_REGISTRY_KEY. It is dry-run by default and never modifies the file
 * unless --apply is passed; --apply also writes a timestamped backup first.
 *
 * Usage:
 *   npx tsx scripts/rekey-tenant-registry.ts             # plan only
 *   npx tsx scripts/rekey-tenant-registry.ts --verify    # check all values
 *   TENANT_REGISTRY_KEY=<64 hex> npx tsx scripts/rekey-tenant-registry.ts --apply
 */

import fs from 'node:fs';
import path from 'node:path';
import { encryptSecret, isEncryptedSecret, parseRegistryKey } from '../src/lib/tenant-secrets';

interface TenantRecord {
    email?: string;
    adminPassword?: string;
    [key: string]: unknown;
}

interface Registry {
    activeTenantEmail?: string;
    tenants?: Record<string, TenantRecord>;
}

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
const registryPath = path.join(process.cwd(), 'pocketbase', 'pb_tenants', 'registry.json');

if (!fs.existsSync(registryPath)) {
    console.log(`No registry at ${registryPath}. Nothing to re-key yet.`);
    process.exit(0);
}

const raw = fs.readFileSync(registryPath, 'utf-8');
const registry = JSON.parse(raw) as Registry;
const tenants = registry.tenants || {};
const key = parseRegistryKey(process.env.TENANT_REGISTRY_KEY);

const toEncrypt: string[] = [];
const alreadyEncrypted: string[] = [];
const missing: string[] = [];

for (const [email, record] of Object.entries(tenants)) {
    const password = record.adminPassword;
    if (!password) {
        missing.push(email);
    } else if (isEncryptedSecret(password)) {
        alreadyEncrypted.push(email);
    } else {
        toEncrypt.push(email);
    }
}

console.log(`Registry: ${registryPath}`);
console.log(`Tenants: ${Object.keys(tenants).length}`);
console.log(`  already encrypted: ${alreadyEncrypted.length}`);
console.log(`  to encrypt:        ${toEncrypt.length}`);
console.log(`  without password:  ${missing.length}`);

if (verify) {
    const ok = toEncrypt.length === 0;
    console.log(ok ? 'VERIFY PASS: every stored password is encrypted.' : 'VERIFY FAIL: plaintext passwords remain.');
    process.exit(ok ? 0 : 1);
}

if (!apply) {
    if (toEncrypt.length > 0) {
        console.log('\nDry run. Passwords that would be encrypted (values not shown):');
        for (const email of toEncrypt) console.log(`  - ${email}`);
        console.log('\nRun with --apply and TENANT_REGISTRY_KEY set to perform the migration.');
    } else {
        console.log('\nNothing to do: no plaintext passwords found.');
    }
    process.exit(0);
}

if (!key) {
    console.error('TENANT_REGISTRY_KEY must be set to 64 hex characters when using --apply.');
    process.exit(1);
}
if (toEncrypt.length === 0) {
    console.log('Nothing to encrypt.');
    process.exit(0);
}

for (const email of toEncrypt) {
    const record = tenants[email];
    record.adminPassword = encryptSecret(String(record.adminPassword), key);
}

const backupPath = `${registryPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(registryPath, backupPath);

const tempPath = `${registryPath}.tmp`;
fs.writeFileSync(tempPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
fs.renameSync(tempPath, registryPath);

console.log(`\nEncrypted ${toEncrypt.length} password(s).`);
console.log(`Backup: ${backupPath}`);
console.log('Restart PocketBase so the app reads the new values.');
