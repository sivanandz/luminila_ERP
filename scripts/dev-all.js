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

function checkPort(url, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            resolve(res.statusCode >= 200 && res.statusCode < 500);
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
    const pbRunning = await checkPort('http://127.0.0.1:8090/api/health');
    if (pbRunning) {
        console.log(`${GREEN}[PB]${RESET} PocketBase is already running on http://127.0.0.1:8090`);
    } else {
        if (!fs.existsSync(PB_EXE)) {
            console.error(`${RED}[PB] PocketBase executable not found at: ${PB_EXE}${RESET}`);
        } else {
            console.log(`${GREEN}[PB]${RESET} Starting PocketBase DB server...`);
            const pbProc = spawn(PB_EXE, ['serve', '--http=0.0.0.0:8090', `--dir=${PB_DATA}`], {
                cwd: PB_DIR,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            children.push(pbProc);
            pipeOutput(pbProc, '[PB]', GREEN);

            // Wait for PB to become ready
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 250));
                if (await checkPort('http://127.0.0.1:8090/api/health')) {
                    console.log(`${GREEN}[PB]${RESET} PocketBase ready! Admin UI: http://127.0.0.1:8090/_/`);
                    break;
                }
            }
        }
    }

    // 2. WhatsApp Sidecar
    const wppRunning = await checkPort('http://127.0.0.1:21465/health');
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
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const nextProc = spawn(npxCmd, ['next', 'dev'], {
        cwd: ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
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
