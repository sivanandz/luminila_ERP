const { evalInWebview } = require('./test-android-cdp');

async function checkAuthError() {
    const res = await evalInWebview(`
        (async () => {
            try {
                const response = await fetch("http://10.0.2.2:8090/api/collections/users/auth-with-password", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        identity: 'admin@luminila.local',
                        password: 'Admin@123456'
                    })
                });
                const data = await response.json();
                return { status: response.status, data };
            } catch(e) {
                return { error: e.message };
            }
        })()
    `, true);
    console.log('Direct auth-with-password result:', JSON.stringify(res, null, 2));
}

checkAuthError().catch(console.error);
