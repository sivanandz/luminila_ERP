const http = require('http');

const candidates = [
    'password', 'password123', 'password123456',
    'Admin@123', 'Admin@123456', 'admin@123', 'admin@123456',
    'admin', 'Admin123', 'admin123', 'admin123456',
    'luminila', 'Luminila@123', 'Luminila123', 'Luminila2026',
    '123456', '12345678', '123456789'
];

const users = [
    'admin@luminila.local',
    'sivanandam.dbz@gmail.com',
    'niththigal@gmail.com'
];

async function tryAuth(user, pass) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ identity: user, password: pass });
        const req = http.request('http://127.0.0.1:8090/api/collections/users/auth-with-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve({ ok: true, data: JSON.parse(data) });
                } else {
                    resolve({ ok: false, status: res.statusCode });
                }
            });
        });
        req.on('error', () => resolve({ ok: false }));
        req.write(body);
        req.end();
    });
}

async function findWorkingLogin() {
    for (const u of users) {
        for (const p of candidates) {
            const res = await tryAuth(u, p);
            if (res.ok) {
                console.log(`FOUND WORKING CREDENTIALS: User=${u} Password=${p}`);
                return;
            }
        }
    }
    console.log('No common password matched.');
}

findWorkingLogin().catch(console.error);
