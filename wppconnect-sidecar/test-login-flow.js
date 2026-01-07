const http = require('http');
const fs = require('fs');

const SESSION = 'test-session-' + Date.now();
const BASE_URL = 'http://127.0.0.1:21465/api/' + SESSION;

function request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 21465,
            path: `/api/${SESSION}${path}`,
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log('Starting session...');
    const start = await request('/start', 'POST');
    console.log('Start response:', start);

    let attempts = 0;
    const interval = setInterval(async () => {
        attempts++;
        const status = await request('/status');
        console.log(`[${attempts}] Status:`, status);

        if (status.status === 'QR_CODE' || status.qrReady) {
            console.log('QR Code Ready! Fetching...');
            const qr = await request('/qrcode');
            if (qr.success && qr.qrCode) {
                console.log('QR Code fetched successfully (Length: ' + qr.qrCode.length + ')');
                const base64Data = qr.qrCode.replace(/^data:image\/\w+;base64,/, "");
                fs.writeFileSync('test_qr_output.png', base64Data, 'base64');
                console.log('Saved to test_qr_output.png');

                // Cleanup
                await request('/logout', 'POST');
                console.log('Session cleaned up');
                process.exit(0);
            }
        }

        if (attempts > 30) {
            console.log('Timeout waiting for QR');
            process.exit(1);
        }
    }, 2000);
}

run();
