import puppeteer from 'puppeteer-core';

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('Launching headless Chrome...');
    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    const page = await browser.newPage();

    page.on('console', msg => {
        console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', err => {
        console.error('[PAGE ERROR]', err.message);
    });

    console.log('Visiting http://localhost:3000/ ...');
    await page.goto('http://localhost:3000/', { waitUntil: 'load' });
    await delay(3000);

    console.log('Current URL after / visit:', page.url());
    let body = await page.evaluate(() => document.body.innerText);
    console.log('Page content:\n' + body);

    await browser.close();
}

main().catch(console.error);
