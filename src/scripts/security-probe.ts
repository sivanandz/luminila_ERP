/**
 * Adversarial data-plane probe (2026-11-20).
 *
 * Acts as a hostile low-privilege tenant member (Viewer role) and attacks the
 * boundaries directly against PocketBase — bypassing every route-level
 * capability check on purpose — plus the sidecar's auth/traversal surface and
 * the unauthenticated ERP API surface. Run against the DEV stack only:
 * PocketBase on :8090, sidecar on :21465, Next on :3000.
 *
 * Assertions that must ALWAYS hold exit non-zero when broken. The
 * `gateway_secrets` write (P2) is reported, not asserted: it succeeds before
 * migration 1795000000 has been applied to this PB instance and must be
 * refused after the next PocketBase restart — run this script before and
 * after to see the flip.
 *
 * Run: npx tsx src/scripts/security-probe.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import PocketBase from 'pocketbase';

// Load the same env the dev server runs with.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const SIDECAR_URL = 'http://127.0.0.1:21465';
const APP_URL = 'http://127.0.0.1:3000';
const TENANT = 'admin@luminila.local';
const RUN = Date.now().toString(36);
const PROBE_PASSWORD = `Pr!${RUN}z9K`;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
    if (ok) {
        passed++;
        console.log(`  PASS ${name}`);
    } else {
        failed++;
        console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
    }
}
function report(name: string, detail: string) {
    console.log(`  INFO ${name} — ${detail}`);
}
const refused = (e: unknown): boolean => {
    const status = (e as { status?: number })?.status;
    return status === 400 || status === 403 || status === 404;
};
const errDetail = (e: unknown): string =>
    `${(e as { status?: number })?.status} ${JSON.stringify((e as { response?: { data?: unknown } })?.response?.data ?? {})}`;

async function main() {
    const su = new PocketBase(PB_URL);
    await su.collection('_superusers').authWithPassword(
        process.env.POCKETBASE_SUPERUSER_EMAIL || '',
        process.env.POCKETBASE_SUPERUSER_PASSWORD || ''
    ).catch((e) => { throw new Error(`superuser auth failed: ${errDetail(e)}`); });

    // --- Build the hostile identity: a tenant member whose role name is none
    // of Admin/Manager/Staff, with no write permissions at all.
    const email = `probe.${RUN}@rbac-test.local`;
    const user = await su.collection('users').create({
        email,
        password: PROBE_PASSWORD,
        passwordConfirm: PROBE_PASSWORD,
        name: 'Probe Viewer',
        account_email: TENANT,
        is_active: true,
    });
    const role = await su.collection('roles').create({
        name: 'Viewer',
        permissions: { customers: ['read'] },
        is_system: false,
    });
    await su.collection('user_roles').create({ user: user.id, role: role.id, account_email: TENANT });
    const attacker = new PocketBase(PB_URL);
    await attacker.collection('users').authWithPassword(email, PROBE_PASSWORD);

    const createdForCleanup: { col: string; id: string }[] = [];

    try {
        console.log('== PocketBase data plane (as Viewer, no route checks in the path) ==');

        // P1: overwrite the canonical store_config row
        const canonical = await su.collection('store_settings').getFirstListItem<{ id: string; value?: unknown }>(
            `category="store_config" && account_email="${TENANT}"`, { requestKey: null }
        ).catch(() => null);
        if (canonical) {
            try {
                await attacker.collection('store_settings').update(canonical.id, { value: { pwned: true } });
                check('P1 Viewer cannot PATCH store_config', false, 'write was accepted');
            } catch (e) {
                check('P1 Viewer cannot PATCH store_config', refused(e), `unexpected status ${errDetail(e)}`);
            }
            try {
                await attacker.collection('store_settings').delete(canonical.id);
                check('P4 Viewer cannot DELETE store_config', false, 'delete was accepted');
            } catch (e) {
                check('P4 Viewer cannot DELETE store_config', refused(e), `unexpected status ${errDetail(e)}`);
            }
        } else {
            report('P1/P4 store_config row', 'absent in this DB — skipped');
        }

        // P2: the gateway_secrets row — THE gap 1795000000 closes.
        try {
            const row = await attacker.collection('store_settings').create({
                account_email: TENANT,
                key: 'gateway_secrets',
                category: 'gateway_secrets',
                value: JSON.stringify({ pwned: true }),
            });
            createdForCleanup.push({ col: 'store_settings', id: row.id });
            report('P2 Viewer CREATE gateway_secrets row', 'ACCEPTED — migration 1795000000 not applied yet (gap live)');
        } catch (e) {
            check('P2 Viewer cannot CREATE gateway_secrets row', refused(e), `unexpected status ${errDetail(e)}`);
        }

        // P3: write a customer directly (bypassing the /customers UI gate)
        try {
            const c = await attacker.collection('customers').create({
                name: 'Probe Customer',
                phone: '98000000003',
                account_email: TENANT,
            });
            createdForCleanup.push({ col: 'customers', id: c.id });
            check('P3 Viewer cannot CREATE customers', false, 'write was accepted');
        } catch (e) {
            check('P3 Viewer cannot CREATE customers', refused(e), `unexpected status ${errDetail(e)}`);
        }

        // P5 (control): a benign KV row stays writable — proves the gate is
        // selective, not an outage.
        try {
            const row = await attacker.collection('store_settings').create({
                account_email: TENANT,
                key: `probe-benign-${RUN}`,
                category: 'probe_scratch',
                value: '{}',
            });
            createdForCleanup.push({ col: 'store_settings', id: row.id });
            check('P5 benign store_settings row stays writable (control)', true);
        } catch (e) {
            check('P5 benign store_settings row stays writable (control)', false, `rejected: ${errDetail(e)}`);
        }

        console.log('== WPPConnect sidecar ==');
        const sidecarToken = fs.readFileSync(path.resolve(process.cwd(), '.dev-wpp-secret'), 'utf8').trim();

        const noToken = await fetch(`${SIDECAR_URL}/api/luminila/status`, { method: 'GET' });
        check('S1 sidecar refuses without bearer token', noToken.status === 401, `status ${noToken.status}`);

        const traversal = await fetch(`${SIDECAR_URL}/api/..%2F..%2Fetc/status`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${sidecarToken}` },
        });
        check('S2 sidecar refuses traversal session name', traversal.status !== 200, `status ${traversal.status}`);

        const dots = await fetch(`${SIDECAR_URL}/api/../status`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${sidecarToken}` },
        });
        check('S2b sidecar refuses ".." session name', dots.status !== 200, `status ${dots.status}`);

        const control = await fetch(`${SIDECAR_URL}/api/luminila/status`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${sidecarToken}` },
        });
        report('S3 valid session + token status', `HTTP ${control.status}`);

        console.log('== ERP API surface (unauthenticated) ==');
        const secrets = await fetch(`${APP_URL}/api/settings/secrets`, { method: 'GET' });
        check('E1 /api/settings/secrets refuses unauthenticated', secrets.status === 401 || secrets.status === 403, `status ${secrets.status}`);

        const order = await fetch(`${APP_URL}/api/storefront/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [] }),
        });
        check('E3 /api/storefront/order refuses unsigned submit', order.status !== 200, `status ${order.status}`);

        // E2 is informational: single-account mode pins this route to the one
        // database by design; the 403 path only arms in multi-account mode.
        const tenantDb = await fetch(`${APP_URL}/api/system/tenant-db`);
        report('E2 /api/system/tenant-db unauthenticated', `HTTP ${tenantDb.status} (single-account mode: pre-login URL by design)`);
    } finally {
        // --- Cleanup everything the probe created.
        for (const c of createdForCleanup.reverse()) {
            await su.collection(c.col).delete(c.id).catch(() => {});
        }
        const ur = await su.collection('user_roles').getFirstListItem(`user="${user.id}"`).catch(() => null);
        if (ur) await su.collection('user_roles').delete(ur.id).catch(() => {});
        await su.collection('roles').delete(role.id).catch(() => {});
        await su.collection('users').delete(user.id).catch(() => {});
        console.log('probe fixtures cleaned up');
    }

    console.log(`security probe: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main().catch((e) => {
    console.error('PROBE ERROR:', e?.status ?? '', e?.message ?? String(e), JSON.stringify((e as { response?: { data?: unknown } })?.response?.data ?? {}));
    process.exit(1);
});
