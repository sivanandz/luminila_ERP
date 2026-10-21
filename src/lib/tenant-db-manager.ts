/**
 * PocketBase Per-Account Physical Database Isolation Manager
 *
 * Provisions and manages dedicated PocketBase SQLite database directories
 * (`pocketbase/pb_tenants/<tenant_slug>/`) and background server processes
 * per merchant account, guaranteeing 100% physical database isolation.
 */

import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';

export interface TenantDbRecord {
    email: string;
    tenantSlug: string;
    port: number;
    dataDir: string;
    storeName?: string;
    adminPassword?: string;
    createdAt: string;
    updatedAt: string;
}

export interface TenantRegistryData {
    activeTenantEmail?: string;
    tenants: Record<string, TenantDbRecord>;
}

const ROOT_DIR = process.cwd();
const PB_ROOT_DIR = path.join(ROOT_DIR, 'pocketbase');
const PB_EXE_PATH = path.join(
    PB_ROOT_DIR,
    process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase'
);
const PB_MIGRATIONS_DIR = path.join(PB_ROOT_DIR, 'pb_migrations');
const PB_DEFAULT_DATA_DIR = path.join(PB_ROOT_DIR, 'pb_data');
const PB_TENANTS_BASE_DIR = path.join(PB_ROOT_DIR, 'pb_tenants');
const REGISTRY_FILE_PATH = path.join(PB_TENANTS_BASE_DIR, 'registry.json');

const BASE_TENANT_PORT = 8092;
const MAX_TENANT_PORT = 8199;

const LEGACY_PRIMARY_EMAILS = new Set([
    'admin@luminila.local',
    'admin@luminila.com',
]);

/**
 * Normalize email into a filesystem-safe tenant slug
 */
export function getTenantDbSlug(email: string): string {
    const clean = email.trim().toLowerCase();
    if (!clean || LEGACY_PRIMARY_EMAILS.has(clean)) {
        return 'primary';
    }
    return clean.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 64);
}

/**
 * Ensure `pocketbase/pb_tenants/` directory exists
 */
function ensureTenantsBaseDir(): void {
    if (!fs.existsSync(PB_TENANTS_BASE_DIR)) {
        fs.mkdirSync(PB_TENANTS_BASE_DIR, { recursive: true });
    }
}

/**
 * Read tenant registry from disk
 */
export function readTenantRegistry(): TenantRegistryData {
    try {
        if (fs.existsSync(REGISTRY_FILE_PATH)) {
            const raw = fs.readFileSync(REGISTRY_FILE_PATH, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.tenants) {
                return parsed as TenantRegistryData;
            }
        }
    } catch (err) {
        console.warn('[TenantDB] Failed to read registry.json:', err);
    }
    return { tenants: {} };
}

/**
 * Save tenant registry to disk
 */
export function writeTenantRegistry(registry: TenantRegistryData): void {
    try {
        ensureTenantsBaseDir();
        fs.writeFileSync(REGISTRY_FILE_PATH, JSON.stringify(registry, null, 2), 'utf-8');
    } catch (err) {
        console.error('[TenantDB] Failed to write registry.json:', err);
    }
}

/**
 * Check if a PocketBase instance is responding with 200 OK on `/api/health`
 */
export function isPocketBasePortHealthy(port: number, timeoutMs = 1500): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: timeoutMs }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

/**
 * Check if ANY TCP listener is bound to a port on localhost
 */
function isPortOccupied(port: number, timeoutMs = 800): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/`, { timeout: timeoutMs }, (res) => {
            res.resume();
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

/**
 * Discover which port the primary PocketBase instance is running on (8090 or 8091)
 */
export async function resolvePrimaryPocketBasePort(): Promise<number> {
    if (await isPocketBasePortHealthy(8091)) return 8091;
    if (await isPocketBasePortHealthy(8090)) return 8090;
    const envUrl = process.env.PB_URL || process.env.NEXT_PUBLIC_POCKETBASE_URL || '';
    const match = envUrl.match(/:(\d+)/);
    return match ? parseInt(match[1], 10) : 8091;
}

/**
 * Allocate a deterministic free port for a tenant
 */
async function allocateTenantPort(registry: TenantRegistryData, existingPort?: number): Promise<number> {
    const usedPorts = new Set<number>(
        Object.values(registry.tenants).map((t) => t.port).filter(Boolean)
    );

    if (existingPort && existingPort >= BASE_TENANT_PORT) {
        return existingPort;
    }

    for (let port = BASE_TENANT_PORT; port <= MAX_TENANT_PORT; port++) {
        if (usedPorts.has(port)) continue;
        const occupied = await isPortOccupied(port);
        if (!occupied) {
            return port;
        }
    }

    throw new Error('No available ports in tenant range 8092-8199');
}

/**
 * Run PocketBase CLI `migrate up` and `superuser upsert` on the target data directory
 */
function bootstrapTenantDataDir(dataDir: string, email: string, password: string): void {
    if (!fs.existsSync(PB_EXE_PATH)) {
        throw new Error(`PocketBase binary not found at ${PB_EXE_PATH}`);
    }

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // 1. Apply all schema migrations to this isolated SQLite database
    try {
        execFileSync(
            PB_EXE_PATH,
            [
                'migrate',
                'up',
                `--dir=${dataDir}`,
                `--migrationsDir=${PB_MIGRATIONS_DIR}`,
            ],
            { stdio: 'pipe', timeout: 20000 }
        );
    } catch (migErr) {
        console.warn('[TenantDB] migrate up notice:', (migErr as Error)?.message);
    }

    // 2. Upsert the PocketBase superuser with the exact setup email & password
    execFileSync(
        PB_EXE_PATH,
        [
            'superuser',
            'upsert',
            email.trim(),
            password,
            `--dir=${dataDir}`,
            `--migrationsDir=${PB_MIGRATIONS_DIR}`,
        ],
        { stdio: 'pipe', timeout: 15000 }
    );
}

/**
 * Ensure a PocketBase server process is actively serving `dataDir` on `port`
 */
export async function ensureTenantPocketBaseRunning(port: number, dataDir: string): Promise<boolean> {
    if (await isPocketBasePortHealthy(port)) {
        return true;
    }

    if (!fs.existsSync(PB_EXE_PATH)) {
        throw new Error(`PocketBase binary not found at ${PB_EXE_PATH}`);
    }

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const child = spawn(
        PB_EXE_PATH,
        [
            'serve',
            `--http=0.0.0.0:${port}`,
            `--dir=${dataDir}`,
            `--migrationsDir=${PB_MIGRATIONS_DIR}`,
        ],
        {
            cwd: PB_ROOT_DIR,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        }
    );
    child.unref();

    // Poll `/api/health` for up to 8 seconds
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        if (await isPocketBasePortHealthy(port, 800)) {
            return true;
        }
        await new Promise((r) => setTimeout(r, 250));
    }

    return isPocketBasePortHealthy(port, 1000);
}

/**
 * Provision (or update) a dedicated, isolated PocketBase instance for an account during `/setup`
 */
export async function provisionTenantDatabase(params: {
    email: string;
    password: string;
    storeName?: string;
}): Promise<{
    success: boolean;
    pbUrl: string;
    port: number;
    tenantSlug: string;
    dataDir: string;
    isolated: boolean;
}> {
    const cleanEmail = params.email.trim().toLowerCase();
    const tenantSlug = getTenantDbSlug(cleanEmail);
    const registry = readTenantRegistry();
    const now = new Date().toISOString();

    // Legacy primary admin uses primary pb_data on 8090/8091
    if (tenantSlug === 'primary') {
        const primaryPort = await resolvePrimaryPocketBasePort();
        bootstrapTenantDataDir(PB_DEFAULT_DATA_DIR, cleanEmail, params.password);
        await ensureTenantPocketBaseRunning(primaryPort, PB_DEFAULT_DATA_DIR);

        registry.activeTenantEmail = cleanEmail;
        registry.tenants[cleanEmail] = {
            email: cleanEmail,
            tenantSlug: 'primary',
            port: primaryPort,
            dataDir: PB_DEFAULT_DATA_DIR,
            storeName: params.storeName,
            adminPassword: params.password,
            createdAt: registry.tenants[cleanEmail]?.createdAt || now,
            updatedAt: now,
        };
        writeTenantRegistry(registry);

        return {
            success: true,
            pbUrl: `http://127.0.0.1:${primaryPort}`,
            port: primaryPort,
            tenantSlug: 'primary',
            dataDir: PB_DEFAULT_DATA_DIR,
            isolated: false,
        };
    }

    // Dedicated physical SQLite directory for this tenant account
    const existingRecord = registry.tenants[cleanEmail];
    const dataDir = path.join(PB_TENANTS_BASE_DIR, tenantSlug);
    const port = await allocateTenantPort(registry, existingRecord?.port);

    // Run migrations and create/update superuser with the exact setup email & password
    bootstrapTenantDataDir(dataDir, cleanEmail, params.password);

    // Start dedicated PocketBase server process for this tenant
    const healthy = await ensureTenantPocketBaseRunning(port, dataDir);
    if (!healthy) {
        throw new Error(`Failed to start isolated PocketBase instance on port ${port}`);
    }

    registry.activeTenantEmail = cleanEmail;
    registry.tenants[cleanEmail] = {
        email: cleanEmail,
        tenantSlug,
        port,
        dataDir,
        storeName: params.storeName || existingRecord?.storeName,
        adminPassword: params.password,
        createdAt: existingRecord?.createdAt || now,
        updatedAt: now,
    };
    writeTenantRegistry(registry);

    return {
        success: true,
        pbUrl: `http://127.0.0.1:${port}`,
        port,
        tenantSlug,
        dataDir,
        isolated: true,
    };
}

/**
 * Resolve and ensure the PocketBase instance for a given account email is running (used on `/login`)
 */
export async function resolveTenantDatabase(email?: string): Promise<{
    success: boolean;
    found: boolean;
    pbUrl: string;
    port: number;
    tenantSlug: string;
    isolated: boolean;
}> {
    const cleanEmail = (email || '').trim().toLowerCase();
    const registry = readTenantRegistry();

    if (cleanEmail && !LEGACY_PRIMARY_EMAILS.has(cleanEmail)) {
        let record = registry.tenants[cleanEmail];
        const candidateSlug = getTenantDbSlug(cleanEmail);
        const candidateDir = path.join(PB_TENANTS_BASE_DIR, candidateSlug);

        // Also detect if tenant directory already exists on disk even if registry was cleared
        if (!record && fs.existsSync(path.join(candidateDir, 'data.db'))) {
            const port = await allocateTenantPort(registry);
            record = {
                email: cleanEmail,
                tenantSlug: candidateSlug,
                port,
                dataDir: candidateDir,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            registry.tenants[cleanEmail] = record;
        }

        if (record && record.tenantSlug !== 'primary') {
            await ensureTenantPocketBaseRunning(record.port, record.dataDir);
            registry.activeTenantEmail = cleanEmail;
            writeTenantRegistry(registry);
            return {
                success: true,
                found: true,
                pbUrl: `http://127.0.0.1:${record.port}`,
                port: record.port,
                tenantSlug: record.tenantSlug,
                isolated: true,
            };
        }
    }

    // Default / primary instance fallback
    const primaryPort = await resolvePrimaryPocketBasePort();
    if (cleanEmail) {
        registry.activeTenantEmail = cleanEmail;
        writeTenantRegistry(registry);
    }
    return {
        success: true,
        found: false,
        pbUrl: `http://127.0.0.1:${primaryPort}`,
        port: primaryPort,
        tenantSlug: 'primary',
        isolated: false,
    };
}

/**
 * Resolve server-side PocketBase connection & superuser credentials for API routes
 */
export async function getServerTenantPocketBaseConfig(preferredEmail?: string): Promise<{
    pbUrl: string;
    adminEmail: string;
    adminPassword: string;
}> {
    const registry = readTenantRegistry();
    const targetEmail = (preferredEmail || registry.activeTenantEmail || '').trim().toLowerCase();

    if (targetEmail && registry.tenants[targetEmail]) {
        const rec = registry.tenants[targetEmail];
        if (rec.tenantSlug !== 'primary') {
            await ensureTenantPocketBaseRunning(rec.port, rec.dataDir);
        }
        return {
            pbUrl: `http://127.0.0.1:${rec.port}`,
            adminEmail: rec.email,
            adminPassword:
                rec.adminPassword ||
                process.env.POCKETBASE_SUPERUSER_PASSWORD ||
                process.env.PB_ADMIN_PASSWORD ||
                'LuminilaInit2026!',
        };
    }

    const primaryPort = await resolvePrimaryPocketBasePort();
    return {
        pbUrl: `http://127.0.0.1:${primaryPort}`,
        adminEmail:
            process.env.POCKETBASE_SUPERUSER_EMAIL ||
            process.env.PB_ADMIN_EMAIL ||
            'admin@luminila.local',
        adminPassword:
            process.env.POCKETBASE_SUPERUSER_PASSWORD ||
            process.env.PB_ADMIN_PASSWORD ||
            'LuminilaInit2026!',
    };
}
