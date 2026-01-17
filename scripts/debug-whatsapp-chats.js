const http = require('http');

const session = 'luminila';
const baseUrl = 'http://127.0.0.1:21465';

function request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 21465,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
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
    await request(`/api/${session}/start`, 'POST');

    console.log('Waiting for connection...');
    let connected = false;
    for (let i = 0; i < 20; i++) {
        const status = await request(`/api/${session}/status`);
        console.log(`Status (${i}):`, status);
        if (status.connected) {
            connected = true;
            break;
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    if (!connected) {
        console.error('Failed to connect or timed out. Please scan QR if needed.');
        // Try getting QR
        const qr = await request(`/api/${session}/qrcode`);
        if (qr && qr.qrCode) console.log('QR Code available (base64 length):', qr.qrCode.length);
        return;
    }

    console.log('Fetching chats...');
    const chatsResponse = await request(`/api/${session}/chats`);
    const chats = chatsResponse.chats || [];
    console.log(`Fetched ${chats.length} chats.`);

    // Test getMessages for the first chat
    if (chats.length > 0) {
        const firstChatId = chats[0].id?._serialized || chats[0].id;
        console.log(`Testing getMessages for chat: ${firstChatId}`);
        const msgResponse = await request(`/api/${session}/messages/${firstChatId}?count=5`);

        if (msgResponse.success) {
            console.log(`Fetched ${msgResponse.messages.length} messages.`);
            if (msgResponse.messages.length === 0) {
                console.log('WARNING: No messages returned.');
            } else {
                console.log('Sample Message:', JSON.stringify(msgResponse.messages[0], null, 2));
            }
        } else {
            console.log('Error fetching messages:', msgResponse.error);
        }
    } else {
        console.log('No chats available to test getMessages.');
    }

    // Find a message with media and try to download
    let mediaMsgId = null;
    for (const chat of chats) {
        if (chat.lastMessage && (chat.lastMessage.type === 'image' || chat.lastMessage.type === 'sticker' || chat.lastMessage.type === 'ptt')) {
            mediaMsgId = chat.lastMessage.id;
            console.log(`Found media message: ${mediaMsgId} (${chat.lastMessage.type})`);
            break;
        }
    }

    if (mediaMsgId) {
        console.log('Testing download-media...');
        const media = await request(`/api/${session}/download-media`, 'POST', { messageId: mediaMsgId });
        console.log('Download Result:', media.success ? 'Success' : 'Failed');
        if (media.success) console.log('Mime:', media.mimetype, 'Data Length:', media.mediaUrl.length);
        else console.log('Error:', media.error);
    } else {
        console.log('No media message found to test download.');
    }
}

run().catch(console.error);
