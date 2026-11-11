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

const isVisible = process.argv.includes('--visible') || process.env.HEADLESS === 'false';

async function main() {
    console.log(`=== BROWSER TEST: LOGIN & ALL PAGES (Visible: ${isVisible}) ===`);
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: !isVisible,
        defaultViewport: { width: 1440, height: 900 },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1440,900'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            const t = msg.text();
            if (!t.includes('Failed to load resource: the server responded with a status of 404')) {
                console.error('  [BROWSER CONSOLE ERROR]', t.slice(0, 160));
            }
        }
    });

    page.on('pageerror', err => {
        console.error('  [PAGE RUNTIME ERROR]', err.message);
        errors.push(err.message);
    });

    console.log('\n1. Navigating to http://localhost:3000/login ...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });

    console.log('2. Entering credentials for niththigal@gmail.com ...');
    await page.waitForSelector('#password', { timeout: 10000 });
    
    // Ensure email is set
    await page.evaluate(() => {
        const emailEl = document.querySelector('input[type="email"]');
        if (emailEl) {
            emailEl.value = 'niththigal@gmail.com';
            emailEl.dispatchEvent(new Event('input', { bubbles: true }));
            emailEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    await page.focus('#password');
    await page.type('#password', 'Craftisan@321');

    console.log('3. Clicking Sign In...');
    await page.click('button[type="submit"]');

    // Wait for redirect to / or dashboard
    let authenticated = false;
    for (let i = 0; i < 10; i++) {
        await delay(1000);
        const state = await page.evaluate(() => ({
            url: window.location.href,
            pathname: window.location.pathname,
            hasToken: Boolean(localStorage.getItem('pocketbase_auth')),
            bodyPreview: document.body.innerText.slice(0, 120).replace(/\n/g, ' ')
        }));
        console.log(`  Waiting auth [${i+1}s]:`, state.pathname, '| Token:', state.hasToken ? 'YES' : 'NO');
        if (state.hasToken && state.pathname === '/') {
            authenticated = true;
            break;
        }
    }

    if (!authenticated) {
        throw new Error('Authentication failed or did not redirect to dashboard within 10s');
    }

    console.log('Successfully authenticated as niththigal@gmail.com!');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '00-dashboard-initial.png') });

    const allRoutes = [
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

    console.log(`\n4. Auditing ${allRoutes.length} pages in authenticated session...`);
    const results = [];

    for (const route of allRoutes) {
        const cleanName = route === '/' ? 'dashboard' : route.slice(1).replace(/\//g, '-');
        try {
            await page.goto(`http://localhost:3000${route}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
            
            // Wait for session loading to complete if present
            try {
                await page.waitForFunction(
                    () => !document.body.innerText.includes('Loading session...'),
                    { timeout: 6000 }
                );
            } catch {
                // If timed out, let the evaluation capture the state
            }
            await delay(500);

            const pageInfo = await page.evaluate(() => {
                const text = document.body.innerText || '';
                return {
                    url: window.location.href,
                    pathname: window.location.pathname,
                    title: document.title,
                    textSnippet: text.slice(0, 200).replace(/\n/g, ' '),
                    isStuckLoading: text.includes('Loading session...'),
                    isAccessDenied: text.includes('Access Denied') || text.includes('403 Forbidden'),
                    isAuthRequired: text.includes('Authentication Required'),
                    isError: text.includes('Application error') || text.includes('Unhandled Runtime Error'),
                    isLoginPage: window.location.pathname === '/login'
                };
            });

            let status = 'PASS';
            let failureReason = '';

            if (pageInfo.isStuckLoading) {
                status = 'FAIL';
                failureReason = 'Stuck on Loading session...';
            } else if (pageInfo.isLoginPage) {
                status = 'FAIL';
                failureReason = 'Premature redirect to /login';
            } else if (pageInfo.isAccessDenied) {
                status = 'FAIL';
                failureReason = 'Access Denied (permission issue)';
            } else if (pageInfo.isAuthRequired) {
                status = 'FAIL';
                failureReason = 'Authentication Required';
            } else if (pageInfo.isError) {
                status = 'FAIL';
                failureReason = 'Runtime error on page';
            }

            const screenshotPath = path.join(SCREENSHOTS_DIR, `page-${cleanName}.png`);
            await page.screenshot({ path: screenshotPath });

            console.log(`  [${status}] ${route.padEnd(22)} | ${status === 'PASS' ? 'OK' : failureReason}`);
            results.push({
                route,
                status,
                reason: failureReason || 'OK',
                snippet: pageInfo.textSnippet.slice(0, 80)
            });
        } catch (e) {
            console.error(`  [ERROR] ${route}:`, e.message);
            results.push({
                route,
                status: 'ERROR',
                reason: e.message,
                snippet: ''
            });
        }
    }

    console.log('\n=== AUDIT SUMMARY ===');
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status !== 'PASS').length;
    console.log(`Total Pages: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

    if (failed > 0) {
        console.log('\nFailed pages:');
        results.filter(r => r.status !== 'PASS').forEach(r => {
            console.log(`  - ${r.route}: ${r.reason}`);
        });
    }

    await browser.close();
}

main().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
});
