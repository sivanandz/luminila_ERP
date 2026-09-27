const { evalInWebview } = require('./test-android-cdp');

async function getTrace() {
    const errorInfo = await evalInWebview(`
        (() => {
            return {
                url: window.location.href,
                body: document.body.innerText
            };
        })()
    `);
    console.log('Error info:', errorInfo);
}

getTrace().catch(console.error);
