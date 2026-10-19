/**
 * Luminila Unified Development Server
 * Concurrently orchestrates:
 * 1. PocketBase DB (:8090)
 * 2. WPPConnect WhatsApp Sidecar (:21465)
 * 3. Next.js Frontend (:3000)
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

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
            exec(`taskkill /pid ${proc.pid} /T /F`, () => {});
        } catch { /* ignore */ }
    } else {
        try {
            proc.kill('SIGTERM');
        } catch { /* ignore */ }
    }
}

async function cleanup() {
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

    // 2. WhatsApp Sidecar
    const wppRunning = await isServerListening('http://127.0.0.1:21465/health');
    if (wppRunning) {
        console.log(`${MAGENTA}[WPP]${RESET} WhatsApp Sidecar is already running on http://127.0.0.1:21465`);
    } else {
        console.log(`${MAGENTA}[WPP]${RESET} Starting WhatsApp Sidecar server...`);
        const wppProc = spawn('node', ['server.js'], {
            cwd: WPP_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, WPPCONNECT_PORT: '21465' }
        });
        children.push(wppProc);
        pipeOutput(wppProc, '[WPP]', MAGENTA);
    }

    // 3. Next.js Frontend
    console.log(`${CYAN}[NEXT]${RESET} Starting Next.js frontend on http://localhost:3000...`);
    const nextBin = path.join(ROOT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
    const isWin = process.platform === 'win32';
    const nextProc = fs.existsSync(nextBin)
        ? spawn(process.execPath, [nextBin, 'dev', '--webpack'], {
            cwd: ROOT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env }
        })
        : spawn(isWin ? 'npx.cmd' : 'npx', ['next', 'dev', '--webpack'], {
            cwd: ROOT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: isWin,
            env: { ...process.env }
        });
    children.push(nextProc);
    pipeOutput(nextProc, '[NEXT]', CYAN);

    console.log(`\n${GREEN}✓ All services triggered. Press Ctrl+C to stop all.${RESET}\n`);
}

main().catch(err => {
    console.error(`${RED}Startup failed:${RESET}`, err);
    cleanup();
});
