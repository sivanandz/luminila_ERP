/**
 * Cross-platform `next build` launcher.
 *
 * The old package.json script used Windows `set NODE_OPTIONS=...&&`, which
 * breaks on Linux shells (and silently drops the preload). Spawn the next CLI
 * directly and preload the exFAT readlink shim only on Windows, where exFAT
 * checkouts live — Linux (ext4) and NTFS report readlink() correctly and need
 * nothing.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const args = [nextBin, 'build', '--webpack'];

if (process.platform === 'win32') {
    args.unshift('--require', path.join(root, 'scripts', 'fix-exfat-readlink.cjs'));
}

const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
    console.error('[build] failed to start next:', err.message);
    process.exit(1);
});
