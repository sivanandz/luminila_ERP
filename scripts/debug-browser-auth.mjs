import puppeteer from 'puppeteer-core';

async function main() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox']
    });

    const page = await browser.newPage();

    // Log all requests
    page.on('request', req => {
        if (req.url().includes('8090') || req.url().includes('login') || req.url().includes('auth')) {
            console.log(`[REQ] ${req.method()} ${req.url()}`);
        }
    });

    page.on('response', async res => {
        if (res.url().includes('8090') || res.url().includes('auth')) {
            let body = '';
            try { body = (await res.text()).slice(0, 200); } catch {}
            console.log(`[RES ${res.status()}] ${res.url()} -> ${body}`);
        }
    });

    page.on('console', msg => {
        console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', err => {
        console.error(`[PAGE ERROR] ${err.message}`);
    });

    console.log('Opening /login ...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });

    // Focus password input and type
    console.log('Typing password...');
    await page.focus('#password');
    await page.type('#password', 'Craftisan@321');

    console.log('Clicking Sign In...');
    await page.click('button[type="submit"]');

    // Wait 4 seconds and log state
    for (let i = 1; i <= 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const info = await page.evaluate(() => {
            return {
                url: window.location.href,
                hasToken: Boolean(localStorage.getItem('pocketbase_auth')),
                tokenData: localStorage.getItem('pocketbase_auth')?.slice(0, 50),
                bodyPreview: document.body.innerText.slice(0, 100).replace(/\n/g, ' ')
            };
        });
        console.log(`[T+${i}s] Info:`, JSON.stringify(info));
    }

    await browser.close();
}

main().catch(console.error);
