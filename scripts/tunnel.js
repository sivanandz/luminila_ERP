/**
 * Luminila Cloudflare Tunnel Launcher
 * Exposes local PocketBase (:8090) to the internet securely via HTTPS
 * for remote Android and multi-terminal access.
 */

const { spawn, execSync } = require('child_process');

const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

console.log(`${CYAN}${BOLD}=== Luminila Cloudflare Tunnel Launcher ===${RESET}\n`);

// 1. Check if cloudflared binary is available
let hasCloudflared = false;
try {
    execSync('cloudflared --version', { stdio: 'ignore' });
    hasCloudflared = true;
} catch (e) {
    hasCloudflared = false;
}

if (!hasCloudflared) {
    console.log(`${YELLOW}${BOLD}cloudflared is not installed or not in your PATH.${RESET}`);
    console.log(`\nTo install Cloudflare Tunnel on Windows:`);
    console.log(`  ${GREEN}winget install Cloudflare.cloudflared${RESET}`);
    console.log(`Or download the binary directly from:`);
    console.log(`  https://github.com/cloudflare/cloudflared/releases/latest\n`);
    console.log(`Once installed, run: ${CYAN}npm run tunnel${RESET}\n`);
    process.exit(1);
}

// 2. Launch cloudflared tunnel
console.log(`${GREEN}Starting secure tunnel to local PocketBase (http://127.0.0.1:8090)...${RESET}\n`);

const tunnel = spawn('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:8090']);

let foundUrl = false;

tunnel.stderr.on('data', (data) => {
    const text = data.toString();
    // Cloudflare outputs the trycloudflare.com URL in stderr
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !foundUrl) {
        foundUrl = true;
        const publicUrl = match[0];
        console.log(`\n${GREEN}${BOLD}====================================================${RESET}`);
        console.log(`${GREEN}${BOLD}  LUMINILA REMOTE POCKETBASE URL (INTERNET SYNC):${RESET}`);
        console.log(`  ${CYAN}${BOLD}${publicUrl}${RESET}`);
        console.log(`${GREEN}${BOLD}====================================================${RESET}\n`);
        console.log(`Enter this URL into your Android app under:`);
        console.log(`  ${BOLD}Settings -> Server Connection${RESET} -> paste URL and tap Connect.\n`);
        console.log(`${YELLOW}Keep this terminal running while using the Android app remotely.${RESET}\n`);
    }
});

tunnel.on('close', (code) => {
    console.log(`\nTunnel closed with exit code ${code}`);
});

process.on('SIGINT', () => {
    tunnel.kill('SIGINT');
    process.exit(0);
});
