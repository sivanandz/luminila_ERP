/**
 * Build script for WPPConnect Sidecar
 * Compiles to platform-specific binary and copies to Tauri binaries folder
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Target triples for each platform
const TARGETS = {
    'win32': {
        pkg: 'node18-win-x64',
        triple: 'x86_64-pc-windows-msvc',
        ext: '.exe'
    },
    'darwin': {
        pkg: 'node18-macos-x64',
        triple: 'x86_64-apple-darwin',
        ext: ''
    },
    'linux': {
        pkg: 'node18-linux-x64',
        triple: 'x86_64-unknown-linux-gnu',
        ext: ''
    }
};

const platform = process.platform;
const target = TARGETS[platform];

if (!target) {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
}

const DIST_DIR = path.join(__dirname, 'dist');
const TAURI_BIN_DIR = path.join(__dirname, '..', 'src-tauri', 'binaries');

// Ensure directories exist
if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
}
if (!fs.existsSync(TAURI_BIN_DIR)) {
    fs.mkdirSync(TAURI_BIN_DIR, { recursive: true });
}

console.log(`Building for ${platform} (${target.triple})...`);

try {
    // Build with pkg
    const outputName = `wppconnect-server${target.ext}`;
    const outputPath = path.join(DIST_DIR, outputName);

    execSync(`npx pkg . --targets ${target.pkg} --output "${outputPath}"`, {
        stdio: 'inherit',
        cwd: __dirname
    });

    console.log(`Built: ${outputPath}`);

    // Copy to Tauri binaries with target triple suffix
    const tauriBinaryName = `wppconnect-server-${target.triple}${target.ext}`;
    const tauriBinaryPath = path.join(TAURI_BIN_DIR, tauriBinaryName);

    fs.copyFileSync(outputPath, tauriBinaryPath);
    console.log(`Copied to: ${tauriBinaryPath}`);

    console.log('\n✓ Build complete!');
    console.log(`\nAdd this to tauri.conf.json > bundle > externalBin:`);
    console.log(`  "binaries/wppconnect-server"`);

} catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
}
