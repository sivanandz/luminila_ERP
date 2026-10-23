# Tenant registry re-key plan (S-06)

**Status: prepared, not applied.** `pocketbase/pb_tenants/registry.json` has not been modified. On this machine the file does not exist yet (no tenants provisioned), so the plan describes what happens when it does.

## The problem

`TenantDbRecord.adminPassword` is stored in plaintext in `pocketbase/pb_tenants/registry.json`. Anyone who can read that file — a backup, a support bundle, the exFAT volume mounted on another machine — holds every tenant's PocketBase superuser password. Those passwords also unlock each tenant's physical database file.

## The design

| Part | Decision |
|---|---|
| Cipher | AES-256-GCM, 12-byte random IV per value, auth tag stored with the ciphertext |
| Format | `enc:v1:<iv hex>:<tag hex>:<ciphertext base64>` |
| Key | `TENANT_REGISTRY_KEY`, 32 bytes as 64 hex characters, supplied by the environment |
| Compatibility | Values without the `enc:v1:` prefix are treated as plaintext, so the migration is incremental and rollback is a file restore |
| Failure mode | An encrypted value with no key set throws a clear error; the app never silently falls back to plaintext |

The read path is implemented in `src/lib/tenant-secrets.ts` and wired into `createTenantClient`, `ensureServerAuth` and `tenant-db-manager`'s credential resolution. Plaintext keeps working exactly as before, so merging this changes no behaviour until the registry is re-keyed.

## Migration

1. Generate a key and store it where the app can read it at launch:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   Put it in `.env.local` as `TENANT_REGISTRY_KEY`. Do not commit it, and keep an offline copy: losing it means every stored password must be reset, not recovered.
2. Dry run: `npx tsx scripts/rekey-tenant-registry.ts` — lists the tenants whose passwords would be encrypted, never printing values.
3. Apply: `TENANT_REGISTRY_KEY=… npx tsx scripts/rekey-tenant-registry.ts --apply` — writes a timestamped `registry.json.bak-*` first, then replaces the file atomically.
4. Restart PocketBase and the app so the new values are read.
5. Verify: `npx tsx scripts/rekey-tenant-registry.ts --verify` — exits non-zero if any plaintext password remains.

## Rollback

Restore the backup file and unset `TENANT_REGISTRY_KEY`. Because the read path treats unprefixed values as plaintext, the old file works immediately. No database contents are touched by this migration.

## Risks and limits

- **Key custody is the whole security.** If `TENANT_REGISTRY_KEY` sits in the same directory as the registry, encryption adds little against a filesystem attacker.
- The registry remains a single point of failure for tenant discovery; encryption protects the passwords, not availability.
- Rotating the key means decrypting with the old key and re-encrypting with the new one; this script does not do that yet.
- Tests cover the crypto and the read path (`src/scripts/test-tenant-secrets.ts`), not a real registry migration, because none exists on this machine.
