const http = require('http');

function post(path, data) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = http.request(
            { host: '127.0.0.1', port: 8091, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ code: res.statusCode, body: d })); }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

(async () => {
    const u = await post('/api/collections/users/auth-with-password', { identity: 'niththigal@gmail.com', password: 'Luminila2026!' });
    if (u.code === 200) {
        const rec = JSON.parse(u.body).record;
        console.log('user auth OK:', rec.email, 'id:', rec.id);
    } else {
        console.log('user auth:', u.code, JSON.parse(u.body).message);
    }
})().catch((e) => console.error('ERR', e.message));
