const { evalInWebview, sleep } = require('./test-android-cdp');

async function testCustomers() {
    await evalInWebview(`window.location.href = '/customers';`);
    await sleep(3000);
    const info = await evalInWebview(`
        (() => {
            return {
                url: window.location.href,
                title: document.title,
                heading: document.querySelector('h1, h2')?.innerText,
                body: document.body.innerText.slice(0, 300).replace(/\\n+/g, ' ')
            };
        })()
    `);
    console.log('Customers Page Result:', info);
}

testCustomers().catch(console.error);
