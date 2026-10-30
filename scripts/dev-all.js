/**
 * Luminila Unified Development Server
 * Concurrently orchestrates:
 * 1. PocketBase DB (:8090)
 * 2. WPPConnect WhatsApp Sidecar (:21465)
 * 3. Next.js Frontend (:3000)
 */

const { spawn, execFile } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
// Dev-only shared token: the sidecar refuses to start without one, and the dev
// browser has no desktop shell to inject a per-launch value.
const DEV_SIDECAR_SECRET = require('crypto').randomBytes(24).toString('hex');

const ROOT_DIR = path.resolve(__dirname, '..');
const PB_DIR = path.join(ROOT_DIR, 'pocketbase');
const PB_EXE = path.join(PB_DIR, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
const PB_DATA = path.join(PB_DIR, 'pb_data');
const WPP_DIR = path.join(ROOT_DIR, 'wppconnect-sidecar');

// Color helpers
const GREEN = '\x1b[32m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const children = [];

function isServerListening(url, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, () => {
            // Any response code means a server is listening on this port
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

function isPocketBaseHealthy(port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: timeoutMs }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

function pipeOutput(proc, prefix, color) {
    const format = (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.trim()) {
                console.log(`${color}${BOLD}${prefix}${RESET} ${line}`);
            }
        }
    };
    proc.stdout.on('data', format);
    proc.stderr.on('data', format);
}

function killProc(proc) {
    if (!proc || !proc.pid) return;
    if (process.platform === 'win32') {
        try {
            // Argument list, never a shell string: pid comes from our own spawn
            // calls, but keep it non-injectable regardless.
            execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {});
        } catch { /* ignore */ }
    } else {
        try {
            proc.kill('SIGTERM');
        } catch { /* ignore */ }
    }
}

// ---------------------------------------------------------------
// Crash hardening: the WhatsApp sidecar dies on an unhandled
// http2 stream reset when WhatsApp drops a reconnecting session
// (observed twice: ECONNRESET on ClientHttp2Stream right after a
// CONNECTED transition). A piped child error must not kill this
// orchestrator, and a crashed service should come back on its own.
// ---------------------------------------------------------------
let shuttingDown = false;
const restartCounts = new Map();
const MAX_RESTARTS = 5;

process.on('uncaughtException', (err) => {
    console.error(`${RED}[SUPERVISOR]${RESET} uncaught exception suppressed:`, err?.message || err);
});
process.on('unhandledRejection', (err) => {
    console.error(`${RED}[SUPERVISOR]${RESET} unhandled rejection suppressed:`, err?.message || err);
});

/**
 * Restart `name` via `spawnFn` when it exits unexpectedly (backoff, capped).
 * Manual shutdowns are exempt: cleanup() sets `shuttingDown` first.
 */
function supervise(name, spawnFn) {
    const attempt = () => {
        if (shuttingDown) return;
        const count = restartCounts.get(name) || 0;
        if (count >= MAX_RESTARTS) {
            console.error(`${RED}[SUPERVISOR]${RESET} ${name} exceeded its restart budget (${MAX_RESTARTS}); leaving it down.`);
            return;
        }
        const proc = spawnFn();
        proc.on('exit', (code, signal) => {
            if (shuttingDown) return;
            restartCounts.set(name, count + 1);
            const delay = Math.min(30000, 2000 * Math.pow(2, count));
            console.warn(`${YELLOW}[SUPERVISOR]${RESET} ${name} exited (code=${code} signal=${signal}). Restarting in ${delay}ms (attempt ${count + 1}/${MAX_RESTARTS})...`);
            setTimeout(attempt, delay);
        });
        return proc;
    };
    return attempt();
}


// ---------------------------------------------------------------
// Startup warmup: Next dev compiles routes lazily on first visit,
// which made every page pay a multi-second webpack compile the
// first time it was opened. Enumerate every static route under
// src/app (pages and API handlers) and request each one right
// after the dev server boots so all routes are compiled and
// cached before anyone opens the app.
// ---------------------------------------------------------------
const WARMUP_PAGE_FILES = new Set(['page.tsx', 'page.ts', 'page.jsx', 'page.js']);

function enumerateNextRoutes() {
    const pages = [];
    const apis = [];
    const walk = (dir, prefix) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Dynamic segments ([id] etc.) need a real id to compile; none
                // exist today, so skip rather than guess placeholder values.
                if (entry.name.startsWith('[')) continue;
                // Route groups like (dashboard) organise code but are not URL segments.
                if (entry.name.startsWith('(') && entry.name.endsWith(')')) {
                    walk(full, prefix);
                } else {
                    walk(full, `${prefix}/${entry.name}`);
                }
            } else if (WARMUP_PAGE_FILES.has(entry.name)) {
                pages.push(prefix || '/');
            } else if (entry.name === 'route.ts') {
                apis.push(prefix);
            }
        }
    };
    walk(path.join(ROOT_DIR, 'src', 'app'), '');
    return { pages: [...new Set(pages)], apis: [...new Set(apis)] };
}

async function warmupNextRoutes(baseUrl) {
    if (String(process.env.WARMUP_DISABLED || '') === '1') {
        console.log(`${YELLOW}[WARMUP]${RESET} Disabled via WARMUP_DISABLED=1 — routes will compile on first visit.`);
        return;
    }

    // Wait for the dev server to accept connections (it may still be booting).
    for (let i = 0; i < 120; i++) {
        if (await isServerListening(baseUrl)) break;
        await new Promise((r) => setTimeout(r, 1000));
    }

    const { pages, apis } = enumerateNextRoutes();
    const routes = [...pages, ...apis];
    if (routes.length === 0) return;

    console.log(`\n${CYAN}[WARMUP]${RESET} Precompiling ${pages.length} pages + ${apis.length} API routes...`);
    const startedAt = Date.now();
    let done = 0;
    let failed = 0;
    const queue = [...routes];

    // Limited concurrency: enough to keep webpack busy, not enough to thrash
    // the machine (this repo lives on a slow external drive).
    const worker = async () => {
        while (queue.length > 0) {
            const route = queue.shift();
            const t0 = Date.now();
            try {
                // Any HTTP response proves the route module compiled — 405 on a
                // POST-only API route or a 400 from input validation is success.
                await fetch(baseUrl + route, { signal: AbortSignal.timeout(300_000) });
                done++;
                console.log(`${CYAN}[WARMUP]${RESET} ✓ ${route} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
            } catch (err) {
                failed++;
                console.log(`${YELLOW}[WARMUP]${RESET} ✗ ${route} after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err?.name || err?.message || err}`);
            }
        }
    };
    await Promise.all(Array.from({ length: 4 }, worker));

    const total = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`${GREEN}[WARMUP]${RESET} Done: ${done}/${routes.length} routes compiled in ${total}s${failed ? ` (${failed} failed)` : ''} — pages now render immediately.\n`);
}

async function cleanup() {
    shuttingDown = true; // stop the supervisor from resurrecting services
    console.log(`\n${YELLOW}Shutting down Luminila services...${RESET}`);
    for (const proc of children) {
        killProc(proc);
    }
    setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
    for (const proc of children) {
        killProc(proc);
    }
});

// ---------------------------------------------------------------
// Deployment mode. This orchestrator is not Next, so it does not
// inherit Next's env loading: read the two mode keys from
// .env.local itself, or the gate below disagrees with the dev
// server (Next loads that file and runs multi-account while the
// tenant databases never come up). An export in the shell wins
// over the file, the same precedence Next uses. Mirrors
// src/lib/deployment-mode.ts:getDeploymentMode().
// ---------------------------------------------------------------
const DEPLOYMENT_MODE_KEYS = ['TENANT_MODE', 'NEXT_PUBLIC_TENANT_MODE'];

function loadDeploymentModeEnv() {
    let content = '';
    try {
        const envPath = path.join(ROOT_DIR, '.env.local');
        if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
    } catch { /* unreadable .env.local leaves the shell environment in charge */ }

    for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match || !DEPLOYMENT_MODE_KEYS.includes(match[1])) continue;
        // Shell exports take precedence, even when empty (Next does the same).
        if (process.env[match[1]] !== undefined) continue;
        const raw = match[2].trim();
        const quoted = raw.match(/^(['"`])([\s\S]*)\1$/);
        process.env[match[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim();
    }
}

/** Multi-account only when either mode variable is "multi" (trimmed, case-insensitive). */
function isMultiAccountMode() {
    return DEPLOYMENT_MODE_KEYS.some(
        (key) => String(process.env[key] || '').trim().toLowerCase() === 'multi'
    );
}

async function main() {
    console.log(`\n${CYAN}══════════════════════════════════════════════════════${RESET}`);
    console.log(`${CYAN}${BOLD}     Luminila Unified Server Orchestrator     ${RESET}`);
    console.log(`${CYAN}══════════════════════════════════════════════════════${RESET}\n`);

    // 1. PocketBase DB
    let pbPort = process.env.PB_PORT ? parseInt(process.env.PB_PORT, 10) : 8090;
    const pbRunning8090 = await isPocketBaseHealthy(8090);
    const pbRunning8091 = await isPocketBaseHealthy(8091);

    if (pbRunning8090) {
        pbPort = 8090;
        console.log(`${GREEN}[PB]${RESET} PocketBase is already running on http://127.0.0.1:8090`);
    } else if (pbRunning8091) {
        pbPort = 8091;
        console.log(`${GREEN}[PB]${RESET} PocketBase is already running on http://127.0.0.1:8091`);
    } else {
        if (!fs.existsSync(PB_EXE)) {
            console.error(`${RED}[PB] PocketBase executable not found at: ${PB_EXE}${RESET}`);
        } else {
            // Check if 8090 is occupied by a foreign process (e.g. Wondershare or other service)
            const port8090Occupied = await isServerListening('http://127.0.0.1:8090/');
            if (port8090Occupied && !process.env.PB_PORT) {
                console.log(`${YELLOW}[PB] Notice: Port 8090 is occupied by a foreign process. Falling back to port 8091.${RESET}`);
                pbPort = 8091;
            }

            console.log(`${GREEN}[PB]${RESET} Starting PocketBase DB server on port ${pbPort}...`);
            const pbProc = spawn(PB_EXE, ['serve', `--http=0.0.0.0:${pbPort}`, `--dir=${PB_DATA}`], {
                cwd: PB_DIR,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            children.push(pbProc);
            pipeOutput(pbProc, '[PB]', GREEN);

            // Wait for PB to become ready
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 250));
                if (await isPocketBaseHealthy(pbPort)) {
                    console.log(`${GREEN}[PB]${RESET} PocketBase ready! Admin UI: http://127.0.0.1:${pbPort}/_/`);
                    break;
                }
            }

            // Auto-provision bootstrap superuser on cold start if 0 superusers exist
            try {
                const { DatabaseSync } = require('node:sqlite');
                const dbPath = path.join(PB_DATA, 'data.db');
                if (fs.existsSync(dbPath)) {
                    const db = new DatabaseSync(dbPath, { readOnly: true });
                    const row = db.prepare('SELECT count(*) as count FROM _superusers').get();
                    db.close();
                    if (row && row.count === 0) {
                        const crypto = require('crypto');
                        const adminUser = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_ADMIN_EMAIL || 'admin@luminila.local';
                        const adminPass = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
                        const { execFileSync } = require('child_process');
                        execFileSync(PB_EXE, ['superuser', 'upsert', adminUser, adminPass, `--dir=${PB_DATA}`]);
                        console.log(`${GREEN}[PB]${RESET} Bootstrap superuser initialized (${adminUser}).`);
                    }
                }
            } catch { /* ignore if schema is still migrating */ }
        }
    }
    process.env.PB_PORT = String(pbPort);
    process.env.NEXT_PUBLIC_POCKETBASE_URL = `http://127.0.0.1:${pbPort}`;

    // 1b. Auto-restore any isolated tenant PocketBase instances from pb_tenants/registry.json.
    // Tenant databases are a multi-account feature; single-account mode (the default)
    // serves the one primary database above, so the registry is not read.
    loadDeploymentModeEnv();
    if (!isMultiAccountMode()) {
        console.log(`${CYAN}[PB]${RESET} Single-account mode: tenant databases are not started (set TENANT_MODE=multi to re-enable multi-account).`);
    } else {
        try {
            const registryPath = path.join(PB_DIR, 'pb_tenants', 'registry.json');
            if (fs.existsSync(registryPath) && fs.existsSync(PB_EXE)) {
                const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
                const tenants = registry && registry.tenants ? Object.values(registry.tenants) : [];
                for (const tenant of tenants) {
                    if (!tenant || tenant.tenantSlug === 'primary' || !tenant.port || !tenant.dataDir) continue;
                    const running = await isPocketBaseHealthy(tenant.port);
                    if (!running && fs.existsSync(tenant.dataDir)) {
                        console.log(`${GREEN}[PB:${tenant.tenantSlug}]${RESET} Starting isolated tenant DB on port ${tenant.port}...`);
                        const tProc = spawn(
                            PB_EXE,
                            [
                                'serve',
                                `--http=0.0.0.0:${tenant.port}`,
                                `--dir=${tenant.dataDir}`,
                                `--migrationsDir=${path.join(PB_DIR, 'pb_migrations')}`,
                            ],
                            {
                                cwd: PB_DIR,
                                stdio: ['ignore', 'pipe', 'pipe'],
                            }
                        );
                        children.push(tProc);
                        pipeOutput(tProc, `[PB:${tenant.port}]`, GREEN);
                    }
                }
            }
        } catch (tErr) {
            console.warn(`${YELLOW}[PB] Notice restoring tenant DBs: ${tErr.message}${RESET}`);
        }
    }

    // Ensure .env.local preserves existing environment keys while updating NEXT_PUBLIC_POCKETBASE_URL
    try {
        const envPath = path.join(ROOT_DIR, '.env.local');
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        const pbUrlLine = `NEXT_PUBLIC_POCKETBASE_URL=http://127.0.0.1:${pbPort}`;
        if (envContent.includes('NEXT_PUBLIC_POCKETBASE_URL=')) {
            envContent = envContent.replace(/NEXT_PUBLIC_POCKETBASE_URL=.*(\r?\n|$)/g, `${pbUrlLine}$1`);
        } else {
            envContent = envContent ? `${envContent.trim()}\n${pbUrlLine}\n` : `# PocketBase Configuration\n${pbUrlLine}\n`;
        }
        fs.writeFileSync(envPath, envContent, 'utf8');
    } catch { /* ignore */ }

    // 2. WhatsApp Sidecar — supervised: its http2 connection to WhatsApp can
    // reset unhandled (ECONNRESET on ClientHttp2Stream) and kill the process;
    // session auto-restore makes a restart clean, so bring it back.
    const wppRunning = await isServerListening('http://127.0.0.1:21465/health');
    if (wppRunning) {
        console.log(`${MAGENTA}[WPP]${RESET} WhatsApp Sidecar is already running on http://127.0.0.1:21465`);
    } else {
        console.log(`${MAGENTA}[WPP]${RESET} Starting WhatsApp Sidecar server...`);
        supervise('[WPP]', () => {
            const wppProc = spawn('node', ['server.js'], {
                cwd: WPP_DIR,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, WPPCONNECT_PORT: '21465', WPPCONNECT_SECRET: DEV_SIDECAR_SECRET }
            });
            children.push(wppProc);
            pipeOutput(wppProc, '[WPP]', MAGENTA);
            return wppProc;
        });
    }

    // 3. Next.js Frontend — supervised with the same policy as the sidecar.
    console.log(`${CYAN}[NEXT]${RESET} Starting Next.js frontend on http://localhost:3000...`);
    const nextBin = path.join(ROOT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
    const isWin = process.platform === 'win32';
    supervise('[NEXT]', () => {
        const nextProc = fs.existsSync(nextBin)
            ? spawn(process.execPath, [nextBin, 'dev', '--webpack'], {
                cwd: ROOT_DIR,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, NEXT_PUBLIC_WPPCONNECT_SECRET: DEV_SIDECAR_SECRET }
            })
            : spawn(isWin ? 'npx.cmd' : 'npx', ['next', 'dev', '--webpack'], {
                cwd: ROOT_DIR,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: isWin,
                env: { ...process.env }
            });
        children.push(nextProc);
        pipeOutput(nextProc, '[NEXT]', CYAN);
        return nextProc;
    });

    console.log(`\n${GREEN}✓ All services triggered. Press Ctrl+C to stop all.${RESET}\n`);

    // Precompile every route now so the app is fully warm once the user opens it.
    warmupNextRoutes('http://localhost:3000').catch((err) => {
        console.warn(`${YELLOW}[WARMUP]${RESET} Warmup aborted: ${err?.message || err}`);
    });
}

main().catch(err => {
    console.error(`${RED}Startup failed:${RESET}`, err);
    cleanup();
});
