/**
 * Assemble the bundled Next server for the desktop build.
 *
 * `next build` with `output: "standalone"` emits `.next/standalone` containing
 * server.js and only the traced dependencies. Next documents two extra copies:
 * static assets into `.next/standalone/.next/static`, and `public` into
 * `.next/standalone/public`. This script performs both into `server-dist/`,
 * which the Tauri bundle ships as `server/`.
 *
 * Run through `npm run build:desktop`, which builds first.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const target = path.join(root, 'server-dist');

function fail(message) {
    console.error(`[prepare-server-dist] ${message}`);
    process.exit(1);
}

function copyDir(from, to) {
    if (!fs.existsSync(from)) return false;
    fs.cpSync(from, to, { recursive: true });
    return true;
}

if (!fs.existsSync(path.join(standalone, 'server.js'))) {
    fail('`.next/standalone/server.js` is missing. Run `npm run build` with output "standalone" first.');
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

fs.cpSync(standalone, target, { recursive: true });

const staticSource = path.join(root, '.next', 'static');
if (!copyDir(staticSource, path.join(target, '.next', 'static'))) {
    console.warn('[prepare-server-dist] no .next/static found; the UI will render unstyled.');
}

const publicSource = path.join(root, 'public');
if (!copyDir(publicSource, path.join(target, 'public'))) {
    console.log('[prepare-server-dist] no public directory; nothing to copy.');
}

const entry = path.join(target, 'server.js');
if (!fs.existsSync(entry)) {
    fail('server-dist/server.js was not produced.');
}

console.log(`[prepare-server-dist] ready: ${target}`);
