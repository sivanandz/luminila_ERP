/**
 * Luminila Unified Multi-Service Cloudflare Tunnel Launcher
 * Exposes local services securely to the internet via HTTPS:
 * 1. Next.js Web App (:3000)
 * 2. PocketBase Database (:8090 or :8091 fallback)
 * 3. WhatsApp WPPConnect Sidecar (:21465)
 */

const { spawn, execSync, execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

console.log(`\n${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${CYAN}${BOLD}║        Luminila Multi-Service Cloudflare Tunnel Launcher     ║${RESET}`);
console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}\n`);

// 1. Verify cloudflared binary
let hasCloudflared = false;
try {
    execSync('cloudflared --version', { stdio: 'ignore' });
    hasCloudflared = true;
} catch (e) {
    hasCloudflared = false;
}

if (!hasCloudflared) {
    console.log(`${RED}${BOLD}Error: cloudflared is not installed or not in your PATH.${RESET}`);
    console.log(`\nTo install Cloudflare Tunnel on Windows:`);
    console.log(`  ${GREEN}winget install Cloudflare.cloudflared${RESET}`);
    console.log(`Or download the binary directly from:`);
    console.log(`  https://github.com/cloudflare/cloudflared/releases/latest\n`);
    process.exit(1);
}

// 2. Parse CLI Arguments
const args = process.argv.slice(2);
const onlyPb = args.includes('--pb');
const onlyApp = args.includes('--app') || args.includes('--frontend');
const onlyWa = args.includes('--wa') || args.includes('--sidecar');
const tunnelAll = args.includes('--all') || (!onlyPb && !onlyApp && !onlyWa);

function getCustomPort(flag, defaultPort) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !isNaN(parseInt(args[idx + 1], 10))) {
        return parseInt(args[idx + 1], 10);
    }
    return defaultPort;
}

// Helper to probe an HTTP endpoint
function probeHttp(url, timeoutMs = 1200) {
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

// Determine PocketBase active port (deterministic 8090 unless configured).
// PB_PORT comes from the environment, so it is validated into a real TCP port
// before it is ever interpolated into a request URL.
async function resolvePbPort() {
    if (process.env.PB_PORT) {
        const fromEnv = parseInt(process.env.PB_PORT, 10);
        if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv <= 65535) {
            return fromEnv;
        }
        console.warn(`${YELLOW}Ignoring invalid PB_PORT="${process.env.PB_PORT}"; using 8090.${RESET}`);
    }
    const explicitPort = getCustomPort('--pb-port', null);
    if (explicitPort) return explicitPort;
    return 8090;
}

const tunnels = [];

function killProc(proc) {
    if (!proc || !proc.pid) return;
    if (process.platform === 'win32') {
        const pid = Number(proc.pid);
        // Shell-free: the pid is passed as an argv element, so nothing in it
        // can be interpreted as a command (CWE-78). A non-integer pid is
        // refused rather than interpolated into a command line.
        if (!Number.isInteger(pid) || pid <= 0) return;
        try {
            execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {});
        } catch { /* ignore */ }
    } else {
        try {
            proc.kill('SIGTERM');
        } catch { /* ignore */ }
    }
}

function cleanup() {
    console.log(`\n${YELLOW}Shutting down Cloudflare tunnels...${RESET}`);
    for (const item of tunnels) {
        killProc(item.proc);
    }
    setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
    for (const item of tunnels) {
        killProc(item.proc);
    }
});

async function main() {
    const pbPort = await resolvePbPort();
    const appPort = getCustomPort('--app-port', 3000);
    const waPort = getCustomPort('--wa-port', 21465);

    const services = [];

    if (tunnelAll || onlyApp) {
        services.push({
            id: 'app',
            name: 'Next.js Web App',
            localPort: appPort,
            localUrl: `http://127.0.0.1:${appPort}`,
            color: CYAN,
        });
    }

    if (onlyPb) {
        console.log(`${YELLOW}[SECURITY WARNING] PocketBase DB is being exposed over a public tunnel. Ensure authentication is required.${RESET}`);
        services.push({
            id: 'pb',
            name: 'PocketBase DB',
            localPort: pbPort,
            localUrl: `http://127.0.0.1:${pbPort}`,
            color: GREEN,
        });
    }

    if (tunnelAll || onlyWa) {
        services.push({
            id: 'wa',
            name: 'WhatsApp Sidecar',
            localPort: waPort,
            localUrl: `http://127.0.0.1:${waPort}`,
            color: MAGENTA,
        });
    }

    console.log(`Starting ${BOLD}${services.length}${RESET} tunnel service(s):\n`);
    for (const svc of services) {
        console.log(`  • ${svc.color}${BOLD}${svc.name}${RESET} -> ${svc.localUrl}`);
    }
    console.log(`\n${DIM}Requesting secure HTTPS trycloudflare.com endpoints...${RESET}\n`);

    const results = {};
    let pendingCount = services.length;

    function checkAllReady() {
        if (pendingCount === 0) {
            console.log(`\n${GREEN}${BOLD}══════════════════════════════════════════════════════════════════════════════${RESET}`);
            console.log(`${GREEN}${BOLD}                LUMINILA CLOUDFLARE TUNNELS READY (ACTIVE)                    ${RESET}`);
            console.log(`${GREEN}${BOLD}══════════════════════════════════════════════════════════════════════════════${RESET}\n`);

            for (const svc of services) {
                const pubUrl = results[svc.id] || `${RED}Failed to generate${RESET}`;
                console.log(`  ${svc.color}${BOLD}${svc.name.padEnd(18)}${RESET} [Port ${svc.localPort}]`);
                console.log(`  ${BOLD}Public HTTPS URL :${RESET} ${CYAN}${BOLD}${pubUrl}${RESET}\n`);
            }

            console.log(`${BOLD}Quick Configuration Guide:${RESET}`);
            if (results['app']) {
                console.log(`  1. Open ${CYAN}${results['app']}${RESET} in mobile Chrome/Safari for standalone showroom PWA.`);
            }
            if (results['pb']) {
                console.log(`  2. In Luminila app: Tap ${BOLD}Settings -> Server Connection${RESET} -> paste PocketBase URL:`);
                console.log(`     ${GREEN}${results['pb']}${RESET}`);
            }
            if (results['wa']) {
                console.log(`  3. WhatsApp Sidecar Tunnel:`);
                console.log(`     ${MAGENTA}${results['wa']}${RESET}`);
            }

            console.log(`\n${YELLOW}Press Ctrl+C to safely close all tunnels.${RESET}\n`);

            // Persist URLs to scratch directory for other scripts/tools
            try {
                const scratchDir = path.resolve(__dirname, '..', 'scratch');
                if (!fs.existsSync(scratchDir)) {
                    fs.mkdirSync(scratchDir, { recursive: true });
                }
                const record = {
                    timestamp: new Date().toISOString(),
                    services: results,
                };
                fs.writeFileSync(path.join(scratchDir, 'tunnel-urls.json'), JSON.stringify(record, null, 2));
            } catch { /* ignore */ }
        }
    }

    for (const svc of services) {
        const proc = spawn('cloudflared', ['tunnel', '--url', svc.localUrl], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        tunnels.push({ svc, proc });

        let captured = false;
        const handleOutput = (data) => {
            const text = data.toString();
            const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
            if (match && !captured) {
                captured = true;
                results[svc.id] = match[0];
                console.log(`  ${GREEN}✓${RESET} ${svc.name} tunnel created: ${CYAN}${match[0]}${RESET}`);
                pendingCount--;
                checkAllReady();
            }
        };

        proc.stdout.on('data', handleOutput);
        proc.stderr.on('data', handleOutput);

        proc.on('close', (code) => {
            if (!captured) {
                console.log(`  ${RED}✗${RESET} ${svc.name} tunnel process exited with code ${code}`);
                pendingCount--;
                checkAllReady();
            }
        });
    }
}

main().catch((err) => {
    console.error(`${RED}Fatal tunnel launcher error:${RESET}`, err);
    cleanup();
});
