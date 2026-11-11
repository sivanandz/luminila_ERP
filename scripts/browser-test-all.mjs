import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = 'scripts/screenshots';
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function run() {
    console.log('=== STARTING BROWSER E2E TEST ===');
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--window-size=1440,900'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            errors.push(`[CONSOLE ERROR] ${msg.text()}`);
            console.log(`  [CONSOLE ERROR] ${msg.text().slice(0, 120)}`);
        }
    });

    page.on('pageerror', err => {
        errors.push(`[PAGE ERROR] ${err.message}`);
        console.error(`  [PAGE ERROR] ${err.message}`);
    });

    // 1. Visit /login
    console.log('\n--- Step 1: Visit /login ---');
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await delay(1500);

    let loginUrl = page.url();
    let loginBody = await page.evaluate(() => document.body.innerText);
    console.log('Login URL:', loginUrl);
    console.log('Login page loaded:', loginBody.includes('Sign in to Luminila') || loginBody.includes('Sign in') || loginBody.includes('Welcome'));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-login-page.png') });

    // 2. Perform Login with niththigal@gmail.com / Artisan@321 (or Craftisan@321)
    console.log('\n--- Step 2: Fill and Submit Login Form ---');
    
    // Clear and fill email
    await page.waitForSelector('input[type="email"]');
    await page.click('input[type="email"]', { clickCount: 3 });
    await page.type('input[type="email"]', 'niththigal@gmail.com');

    // Fill password
    await page.waitForSelector('input[type="password"]');
    await page.click('input[type="password"]', { clickCount: 3 });
    await page.type('input[type="password"]', 'Craftisan@321');

    // Click submit
    console.log('Submitting login credentials...');
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await delay(3000);
    const postLoginUrl = page.url();
    console.log('Post-login URL:', postLoginUrl);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-post-login.png') });

    const postLoginText = await page.evaluate(() => document.body.innerText);
    console.log('Post-login preview:', postLoginText.slice(0, 150).replace(/\n/g, ' '));

    // 3. Test Every Single Page
    const pagesToTest = [
        '/',
        '/inventory',
        '/pos',
        '/orders',
        '/whatsapp',
        '/labels',
        '/invoices',
        '/vendors',
        '/purchase',
        '/customers',
        '/reports',
        '/activity',
        '/users',
        '/returns',
        '/challan',
        '/expenses',
        '/banking',
        '/storefront-control',
        '/manufacturing',
        '/cheques',
        '/backup',
        '/assistant',
        '/packing',
        '/analytics',
        '/settings'
    ];

    console.log(`\n--- Step 3: Testing ${pagesToTest.length} Application Pages ---`);
    const results = [];

    for (let i = 0; i < pagesToTest.length; i++) {
        const route = pagesToTest[i];
        const routeName = route === '/' ? 'dashboard' : route.slice(1);
        console.log(`\nTesting [${i + 1}/${pagesToTest.length}]: ${route} ...`);

        try {
            await page.goto(`http://localhost:3000${route}`, { waitUntil: 'load' });
            await delay(2000);

            const currentUrl = page.url();
            const text = await page.evaluate(() => document.body.innerText);
            const isStuck = text.trim() === 'Loading session...' || text.includes('Loading session...');
            const isDenied = text.includes('Access Denied') || text.includes('Authentication Required');
            const hasError = text.includes('Application error') || text.includes('Unhandled Runtime Error');

            const status = isStuck
                ? 'STUCK_LOADING'
                : hasError
                ? 'RUNTIME_ERROR'
                : isDenied
                ? 'ACCESS_DENIED'
                : 'PASS';

            console.log(`  -> Status: ${status} | URL: ${currentUrl}`);

            const screenshotName = `${String(i + 3).padStart(2, '0')}-${routeName}.png`;
            await page.screenshot({ path: path.join(SCREENSHOTS_DIR, screenshotName) });

            results.push({
                route,
                status,
                url: currentUrl,
                preview: text.slice(0, 80).replace(/\n/g, ' ')
            });
        } catch (err) {
            console.error(`  -> Failed testing ${route}:`, err.message);
            results.push({ route, status: 'EXCEPTION', error: err.message });
        }
    }

    console.log('\n=== SUMMARY OF BROWSER TEST RESULTS ===');
    console.table(results);

    if (errors.length > 0) {
        console.log(`\nTotal Browser Errors Caught: ${errors.length}`);
    } else {
        console.log('\nZero browser errors caught during the entire run!');
    }

    await browser.close();
}

run().catch(console.error);
