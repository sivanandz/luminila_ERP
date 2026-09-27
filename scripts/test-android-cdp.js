const http = require('http');

async function getWsUrl() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9223/json/list', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const list = JSON.parse(data);
                if (list.length > 0 && list[0].webSocketDebuggerUrl) {
                    resolve(list[0].webSocketDebuggerUrl);
                } else {
                    reject(new Error('No inspectable page found'));
                }
            });
        }).on('error', reject);
    });
}

async function evalInWebview(expr, awaitPromise = false) {
    const wsUrl = await getWsUrl();
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const reqId = Math.floor(Math.random() * 100000);
        ws.onopen = () => {
            ws.send(JSON.stringify({
                id: reqId,
                method: 'Runtime.evaluate',
                params: {
                    expression: expr,
                    awaitPromise: awaitPromise,
                    returnByValue: true
                }
            }));
        };
        ws.onmessage = (evt) => {
            const data = JSON.parse(evt.data);
            if (data.id === reqId) {
                ws.close();
                if (data.result.exceptionDetails) {
                    reject(data.result.exceptionDetails);
                } else {
                    resolve(data.result.result.value);
                }
            }
        };
        ws.onerror = reject;
    });
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    // Check if on login page, if not navigate to /login
    let currentPath = await evalInWebview('window.location.pathname');
    if (currentPath !== '/login') {
        console.log('Navigating to /login...');
        await evalInWebview('window.location.href = "/login"');
        await sleep(2500);
    }

    console.log('--- 1. Filling credentials: admin@luminila.local / password123456 ---');
    const fillResult = await evalInWebview(`
        (() => {
            const emailInput = document.querySelector('input[type="email"]');
            const passInput = document.querySelector('input[type="password"]');
            const submitBtn = document.querySelector('button[type="submit"]');

            if (!emailInput || !passInput || !submitBtn) {
                return { ok: false, error: 'Inputs not found' };
            }

            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(emailInput, 'admin@luminila.local');
            emailInput.dispatchEvent(new Event('input', { bubbles: true }));

            nativeSetter.call(passInput, 'password123456');
            passInput.dispatchEvent(new Event('input', { bubbles: true }));

            submitBtn.click();
            return { ok: true, email: emailInput.value };
        })()
    `);
    console.log('Fill result:', fillResult);

    console.log('Waiting for authentication and redirect...');
    await sleep(4000);

    const state = await evalInWebview(`
        (() => {
            const pbAuth = localStorage.getItem('pocketbase_auth');
            return {
                pathname: window.location.pathname,
                authValid: pbAuth ? JSON.parse(pbAuth).isValid || !!JSON.parse(pbAuth).token : false,
                heading: document.querySelector('h1, h2, h3')?.innerText,
                bodySnippet: document.body.innerText.slice(0, 200).replace(/\\n+/g, ' ')
            };
        })()
    `);
    console.log('After login state:', state);
}

module.exports = { getWsUrl, evalInWebview, sleep };
if (require.main === module) {
    main().catch(console.error);
}
