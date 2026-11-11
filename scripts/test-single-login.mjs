import puppeteer from 'puppeteer-core';

async function testLogin() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    page.on('console', m => console.log('BROWSER LOG:', m.text()));
    page.on('pageerror', e => console.error('BROWSER ERROR:', e.message));

    console.log('Navigating to http://localhost:3000/login ...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1000));

    const initialEmail = await page.evaluate(() => {
        const el = document.querySelector('input[type="email"]');
        return el ? el.value : 'NOT_FOUND';
    });
    console.log('Initial email field value:', initialEmail);

    // Enter email and password
    await page.evaluate(() => {
        const emailInput = document.querySelector('input[type="email"]');
        const passInput = document.querySelector('input[type="password"]');
        
        // Native setter for React controlled components
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeInputValueSetter.call(emailInput, 'niththigal@gmail.com');
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        emailInput.dispatchEvent(new Event('change', { bubbles: true }));

        nativeInputValueSetter.call(passInput, 'Craftisan@321');
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
        passInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    console.log('Clicking Sign In button...');
    await page.click('button[type="submit"]');

    for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const url = page.url();
        const text = await page.evaluate(() => document.body.innerText);
        console.log(`[T+${i+1}s] URL: ${url} | Content: ${text.slice(0, 100).replace(/\n/g, ' ')}`);
    }

    await browser.close();
}

testLogin().catch(console.error);
