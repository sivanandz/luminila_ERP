/**
 * WPPConnect Sidecar Server
 * Lightweight WhatsApp API server for Luminila
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Configuration
const PORT = process.env.WPPCONNECT_PORT || 21465;
const SECRET_KEY = process.env.WPPCONNECT_SECRET || 'luminila-secret-key';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// Session storage
const sessions = new Map();
let wppconnect = null;

// Lazy load wppconnect to reduce startup time
async function getWppConnect() {
    if (!wppconnect) {
        wppconnect = require('@wppconnect-team/wppconnect');
    }
    return wppconnect;
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        sessions: sessions.size,
        uptime: process.uptime()
    });
});

// Get server status
app.get('/api/status', (req, res) => {
    const sessionList = [];
    sessions.forEach((session, name) => {
        sessionList.push({
            name,
            connected: session.connected || false,
            qrReady: session.qrReady || false
        });
    });
    res.json({ sessions: sessionList });
});

// Start new session
app.post('/api/:session/start', async (req, res) => {
    const { session } = req.params;

    if (sessions.has(session)) {
        return res.json({ success: true, message: 'Session already exists' });
    }

    try {
        const wpp = await getWppConnect();

        const sessionData = {
            connected: false,
            qrReady: false,
            qrCode: null,
            client: null
        };
        sessions.set(session, sessionData);

        wpp.create({
            session: session,
            catchQR: async (base64Qr, asciiQR, attempts) => {
                console.log(`[${session}] QR Code generated (attempt ${attempts})`);
                console.log(`[${session}] QR Length: ${base64Qr ? base64Qr.length : 0}`);

                try {
                    const matches = base64Qr.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                    if (matches && matches.length === 3) {
                        const buffer = Buffer.from(matches[2], 'base64');
                        fs.writeFileSync('debug_qr.png', buffer);
                        console.log(`[${session}] Saved debug_qr.png`);
                    }
                } catch (e) {
                    console.error(`[${session}] Error saving debug QR:`, e.message);
                }

                sessionData.qrCode = base64Qr;
                sessionData.qrReady = true;
                io.emit('qrcode', { session, qrCode: base64Qr, attempts });
            },
            statusFind: (statusSession, session) => {
                console.log(`[${session}] Status: ${statusSession}`);
                if (statusSession === 'inChat' || statusSession === 'isLogged') {
                    sessionData.connected = true;
                    sessionData.qrReady = false;
                    io.emit('connected', { session });
                }
                if (statusSession === 'notLogged' || statusSession === 'browserClose') {
                    sessionData.connected = false;
                    io.emit('disconnected', { session });
                }
            },
            headless: true,
            devtools: false,
            useChrome: true,
            debug: true,
            logConsole: true,
            logQR: false,
            browserArgs: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--disable-gpu'
            ],
            autoClose: 0, // Disable auto close
            puppeteerOptions: {
                headless: 'new',
                defaultViewport: {
                    width: 1280,
                    height: 800
                },
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
            },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }).then((client) => {
            sessionData.client = client;
            sessionData.connected = true;

            // Handle incoming messages
            client.onMessage((message) => {
                io.emit('message', {
                    session,
                    message: {
                        id: message.id,
                        from: message.from,
                        to: message.to,
                        body: message.body,
                        type: message.type,
                        timestamp: message.timestamp,
                        isGroupMsg: message.isGroupMsg,
                        sender: message.sender
                    }
                });
            });

            // Handle ack (message status)
            client.onAck((ack) => {
                io.emit('ack', { session, ack });
            });

            console.log(`[${session}] Client ready`);
        }).catch((error) => {
            console.error(`[${session}] Error:`, error);
            sessions.delete(session);
        });

        res.json({ success: true, message: 'Session starting' });
    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get QR code
app.get('/api/:session/qrcode', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (!sessionData.qrCode) {
        return res.status(202).json({ success: true, message: 'QR code not ready yet' });
    }

    res.json({ success: true, qrCode: sessionData.qrCode });
});

// Get QR code as image
app.get('/api/:session/qrcode/image', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.qrCode) {
        return res.status(404).send('QR not ready');
    }

    res.type('png');
    const qrBuffer = Buffer.from(sessionData.qrCode.split(',')[1], 'base64');
    res.send(qrBuffer);
});

// Check session status
app.get('/api/:session/status', (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData) {
        return res.json({ exists: false, connected: false });
    }

    res.json({
        exists: true,
        connected: sessionData.connected,
        qrReady: sessionData.qrReady
    });
});

// Logout session
app.post('/api/:session/logout', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.json({ success: true, message: 'Session not found or already logged out' });
    }

    try {
        console.log(`[${session}] Logging out...`);
        if (sessionData.client) {
            try { await sessionData.client.logout(); } catch (e) { console.warn(`[${session}] Logout warning:`, e.message); }
            try {
                await sessionData.client.close();
                await new Promise(r => setTimeout(r, 2000)); // Wait for browser to die
            } catch (e) { console.warn(`[${session}] Close warning:`, e.message); }
        }
        sessions.delete(session);

        // Force clear tokens
        try {
            const tokenPath = `./tokens/${session}`;
            if (fs.existsSync(tokenPath)) {
                console.log(`[${session}] Cleaning up tokens...`);
                fs.rmSync(tokenPath, { recursive: true, force: true });
            }
        } catch (e) {
            console.error(`[${session}] Token cleanup error:`, e.message);
        }

        console.log(`[${session}] Logged out and cleaned up successfully`);
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        console.error(`[${session}] Logout connection error:`, error.message);
        sessions.delete(session);
        res.json({ success: true, message: 'Session cleared' });
    }
});

// Request Pairing Code (Phone Number Login)
// Uses a separate session name to avoid interfering with QR login
app.post('/api/:session/pair-phone', async (req, res) => {
    const { session } = req.params;
    const { phone } = req.body;
    const phoneSession = `${session}_phone`; // Use separate session for phone login

    console.log(`[${phoneSession}] Link Phone Request: ${phone}`);

    // Clean up existing phone session if it exists (not the main session!)
    const existingPhoneSession = sessions.get(phoneSession);
    if (existingPhoneSession) {
        if (existingPhoneSession.client) {
            try {
                await existingPhoneSession.client.close();
            } catch (e) {
                console.error(`[${phoneSession}] Error closing existing phone session:`, e);
            }
        }
        sessions.delete(phoneSession);
    }

    // Start new session with phone number
    try {
        const wpp = await getWppConnect();

        const sessionData = {
            connected: false,
            qrReady: false,
            qrCode: null,
            client: null
        };
        sessions.set(phoneSession, sessionData);

        // Create a promise that resolves when pairing code is received
        const codePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Timeout waiting for pairing code (90s)"));
            }, 90000);

            wpp.create({
                session: phoneSession,
                phoneNumber: phone,
                catchLinkCode: (code) => {
                    console.log(`[${phoneSession}] Pairing Code Received: ${code}`);
                    clearTimeout(timeout);
                    resolve(code);
                },
                statusFind: (statusSession) => {
                    console.log(`[${phoneSession}] Status: ${statusSession}`);
                    if (statusSession === 'inChat' || statusSession === 'isLogged') {
                        sessionData.connected = true;
                        io.emit('connected', { session: phoneSession });
                    }
                },
                headless: true,
                useChrome: true,
                autoClose: 0,
                browserArgs: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ],
                puppeteerOptions: { headless: 'new' }
            }).then((client) => {
                sessionData.client = client;
                sessionData.connected = true;
                client.onMessage((message) => {
                    io.emit('message', { session: phoneSession, message });
                });
            }).catch(err => {
                console.error(`[${phoneSession}] Create Error:`, err);
            });
        });

        const code = await codePromise;
        res.json({ success: true, code, phoneSession });

    } catch (error) {
        console.error(`[${phoneSession}] Pairing request error:`, error);
        sessions.delete(phoneSession);
        res.status(500).json({ success: false, error: error.message || 'Failed to generate code' });
    }
});

// Logout session (keeps session files for reconnection)
app.post('/api/:session/logout', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not found' });
    }

    try {
        await sessionData.client.logout();
        sessionData.connected = false;
        sessions.delete(session);
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Close session (completely removes session)
app.post('/api/:session/close', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        sessions.delete(session);
        return res.json({ success: true, message: 'Session closed' });
    }

    try {
        await sessionData.client.close();
        sessions.delete(session);
        res.json({ success: true, message: 'Session closed successfully' });
    } catch (error) {
        sessions.delete(session);
        res.json({ success: true, message: 'Session force closed' });
    }
});


// Send text message
app.post('/api/:session/send-message', async (req, res) => {
    const { session } = req.params;
    const { phone, message, isGroup } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        // Handle both full chat IDs (123@c.us) and plain phone numbers (123)
        let chatId = phone;
        if (!phone.includes('@')) {
            // Plain phone number - add suffix based on isGroup flag
            chatId = isGroup ? `${phone}@g.us` : `${phone}@c.us`;
        }

        const result = await sessionData.client.sendText(chatId, message);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send image
app.post('/api/:session/send-image', async (req, res) => {
    const { session } = req.params;
    const { phone, imageUrl, caption } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendImage(`${phone}@c.us`, imageUrl, 'image', caption);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all chats
app.get('/api/:session/chats', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const chats = await sessionData.client.listChats();
        res.json({ success: true, chats: chats.slice(0, 50) }); // Limit to 50
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get messages from chat
app.get('/api/:session/messages/:chatId', async (req, res) => {
    const { session, chatId } = req.params;
    const { count = 20 } = req.query;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const messages = await sessionData.client.getMessages(chatId, { count: parseInt(count) });
        res.json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get profile picture
app.get('/api/:session/profile-pic/:contactId', async (req, res) => {
    const { session, contactId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const profilePic = await sessionData.client.getProfilePicFromServer(contactId);
        res.json({ success: true, profilePic });
    } catch (error) {
        res.json({ success: true, profilePic: null }); // Return null if no profile pic
    }
});

// Download media from message - CLEAN REWRITE
app.post('/api/:session/download-media', async (req, res) => {
    const { session } = req.params;
    const { messageId } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData?.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    if (!messageId) {
        return res.status(400).json({ success: false, error: 'messageId is required' });
    }

    try {
        // Get the base64 content directly using downloadMedia with ID
        const base64Content = await sessionData.client.downloadMedia(messageId);

        if (!base64Content) {
            return res.json({ success: false, error: 'No media content returned' });
        }

        // Get mimetype from message
        let mimetype = 'image/jpeg';
        try {
            const msg = await sessionData.client.getMessageById(messageId);
            if (msg?.mimetype) mimetype = msg.mimetype;
        } catch { /* use default */ }

        // Build data URI
        let dataUri;
        if (typeof base64Content === 'string') {
            if (base64Content.startsWith('data:')) {
                // Already a data URI
                dataUri = base64Content;
            } else {
                // Raw base64
                dataUri = `data:${mimetype};base64,${base64Content}`;
            }
        } else if (Buffer.isBuffer(base64Content)) {
            dataUri = `data:${mimetype};base64,${base64Content.toString('base64')}`;
        } else {
            return res.json({ success: false, error: 'Unknown media format' });
        }

        res.json({ success: true, mediaUrl: dataUri, mimetype });
    } catch (error) {
        console.error(`[${session}] Download media error:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send image
app.post('/api/:session/send-image', async (req, res) => {
    const { session } = req.params;
    const { phone, base64, filename, caption } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendImage(phone, base64, filename || 'image.jpg', caption || '');
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send video
app.post('/api/:session/send-video', async (req, res) => {
    const { session } = req.params;
    const { phone, base64, filename, caption } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendFile(phone, base64, filename || 'video.mp4', caption || '');
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send file/document
app.post('/api/:session/send-file', async (req, res) => {
    const { session } = req.params;
    const { phone, base64, filename, caption } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendFile(phone, base64, filename || 'file', caption || '');
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send audio
app.post('/api/:session/send-audio', async (req, res) => {
    const { session } = req.params;
    const { phone, base64, ptt = false } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = ptt
            ? await sessionData.client.sendPtt(phone, base64)
            : await sessionData.client.sendFile(phone, base64, 'audio.mp3', '');
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send location
app.post('/api/:session/send-location', async (req, res) => {
    const { session } = req.params;
    const { phone, lat, lng, title, address } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendLocation(phone, lat, lng, title || '', address || '');
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send contact (vCard)
app.post('/api/:session/send-contact', async (req, res) => {
    const { session } = req.params;
    const { phone, contactPhone, name } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendContactVcard(phone, contactPhone, name);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all contacts
app.get('/api/:session/contacts', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const contacts = await sessionData.client.getAllContacts();
        res.json({ success: true, contacts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get contact info
app.get('/api/:session/contact/:contactId', async (req, res) => {
    const { session, contactId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const contact = await sessionData.client.getContact(contactId);
        res.json({ success: true, contact });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if number is registered on WhatsApp
app.get('/api/:session/check-number/:phone', async (req, res) => {
    const { session, phone } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.checkNumberStatus(phone);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mark chat as read
app.post('/api/:session/mark-as-read', async (req, res) => {
    const { session } = req.params;
    const { chatId } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.markUnseenMessage(chatId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Archive/Unarchive chat
app.post('/api/:session/archive-chat', async (req, res) => {
    const { session } = req.params;
    const { chatId, archive = true } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        if (archive) {
            await sessionData.client.archiveChat(chatId);
        } else {
            await sessionData.client.unarchiveChat(chatId);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete chat
app.post('/api/:session/delete-chat', async (req, res) => {
    const { session } = req.params;
    const { chatId } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.deleteChat(chatId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Block contact
app.post('/api/:session/block-contact', async (req, res) => {
    const { session } = req.params;
    const { contactId } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.blockContact(contactId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Unblock contact
app.post('/api/:session/unblock-contact', async (req, res) => {
    const { session } = req.params;
    const { contactId } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.unblockContact(contactId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get blocked contacts
app.get('/api/:session/blocked-contacts', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const blocked = await sessionData.client.getBlockList();
        res.json({ success: true, blocked });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set presence (online/offline/typing)
app.post('/api/:session/set-presence', async (req, res) => {
    const { session } = req.params;
    const { presence, chatId } = req.body; // 'composing', 'recording', 'available', 'unavailable'
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        if (presence === 'composing') {
            await sessionData.client.startTyping(chatId);
        } else if (presence === 'recording') {
            await sessionData.client.startRecording(chatId);
        } else if (presence === 'available') {
            await sessionData.client.setOnlinePresence(true);
        } else if (presence === 'unavailable') {
            await sessionData.client.setOnlinePresence(false);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get device/battery info
app.get('/api/:session/device-info', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const hostDevice = await sessionData.client.getHostDevice();
        res.json({ success: true, device: hostDevice });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get starred messages
app.get('/api/:session/starred-messages', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const starred = await sessionData.client.getStarredMessages();
        res.json({ success: true, messages: starred });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Star/unstar message
app.post('/api/:session/star-message', async (req, res) => {
    const { session } = req.params;
    const { messageId, star = true } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.starMessage(messageId, star);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete message
app.post('/api/:session/delete-message', async (req, res) => {
    const { session } = req.params;
    const { chatId, messageId, deleteForEveryone = false } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.deleteMessage(chatId, messageId, deleteForEveryone);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Forward message
app.post('/api/:session/forward-message', async (req, res) => {
    const { session } = req.params;
    const { messageId, toPhone } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.forwardMessage(toPhone, messageId);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reply to message
app.post('/api/:session/reply-message', async (req, res) => {
    const { session } = req.params;
    const { messageId, text } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.reply(messageId, text);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get groups
app.get('/api/:session/groups', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const groups = await sessionData.client.getAllGroups();
        res.json({ success: true, groups });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get group info
app.get('/api/:session/group/:groupId', async (req, res) => {
    const { session, groupId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const groupInfo = await sessionData.client.getGroupInfo(groupId);
        res.json({ success: true, group: groupInfo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create group
app.post('/api/:session/create-group', async (req, res) => {
    const { session } = req.params;
    const { name, participants } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.createGroup(name, participants);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add participant to group
app.post('/api/:session/group-add-participant', async (req, res) => {
    const { session } = req.params;
    const { groupId, participantPhone } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.addParticipant(groupId, participantPhone);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Remove participant from group
app.post('/api/:session/group-remove-participant', async (req, res) => {
    const { session } = req.params;
    const { groupId, participantPhone } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.removeParticipant(groupId, participantPhone);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Leave group
app.post('/api/:session/leave-group', async (req, res) => {
    const { session } = req.params;
    const { groupId } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.leaveGroup(groupId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get group invite link
app.get('/api/:session/group-invite-link/:groupId', async (req, res) => {
    const { session, groupId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const link = await sessionData.client.getGroupInviteLink(groupId);
        res.json({ success: true, link });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// CATALOG & BUSINESS APIs (for inventory system)
// ============================================

// Get all products from business catalog
app.get('/api/:session/get-products', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const products = await sessionData.client.getProducts();
        res.json({ success: true, products });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get product by ID
app.get('/api/:session/get-product-by-id/:productId', async (req, res) => {
    const { session, productId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const product = await sessionData.client.getProductById(productId);
        res.json({ success: true, product });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add product to catalog
app.post('/api/:session/add-product', async (req, res) => {
    const { session } = req.params;
    const { name, description, price, currency = 'INR', image, isHidden } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.createProduct(name, image, description, price, isHidden, currency);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete products
app.post('/api/:session/del-products', async (req, res) => {
    const { session } = req.params;
    const { productIds } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.deleteProduct(productIds);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get collections
app.get('/api/:session/get-collections', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const collections = await sessionData.client.getCollections();
        res.json({ success: true, collections });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send order message
app.post('/api/:session/send-order-message', async (req, res) => {
    const { session } = req.params;
    const { phone, orderItems, options } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendOrderMessage(phone, orderItems, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get order by message ID
app.get('/api/:session/get-order-by-messageId/:messageId', async (req, res) => {
    const { session, messageId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const order = await sessionData.client.getOrderbyMsg(messageId);
        res.json({ success: true, order });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// LABELS APIs
// ============================================

// Get all labels
app.get('/api/:session/get-all-labels', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const labels = await sessionData.client.getAllLabels();
        res.json({ success: true, labels });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add new label
app.post('/api/:session/add-new-label', async (req, res) => {
    const { session } = req.params;
    const { name, options } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.addNewLabel(name, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add or remove label from chat
app.post('/api/:session/add-or-remove-label', async (req, res) => {
    const { session } = req.params;
    const { chatId, labelId, action = 'add' } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        let result;
        if (action === 'add') {
            result = await sessionData.client.addOrRemoveLabels([chatId], [{ id: labelId, type: 'add' }]);
        } else {
            result = await sessionData.client.addOrRemoveLabels([chatId], [{ id: labelId, type: 'remove' }]);
        }
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete label
app.delete('/api/:session/delete-label/:labelId', async (req, res) => {
    const { session, labelId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.deleteLabel(labelId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// STATUS/STORIES APIs
// ============================================

// Send text status
app.post('/api/:session/send-text-storie', async (req, res) => {
    const { session } = req.params;
    const { text, backgroundColor, font } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendTextStatus(text, { backgroundColor, font });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send image status
app.post('/api/:session/send-image-storie', async (req, res) => {
    const { session } = req.params;
    const { base64, caption } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendImageStatus(base64, { caption });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send video status
app.post('/api/:session/send-video-storie', async (req, res) => {
    const { session } = req.params;
    const { base64, caption } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendVideoStatus(base64, { caption });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// ADDITIONAL MESSAGE APIs
// ============================================

// React to message
app.post('/api/:session/react-message', async (req, res) => {
    const { session } = req.params;
    const { messageId, reaction } = req.body; // reaction: emoji string or empty to remove
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendReaction(messageId, reaction);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Edit message
app.post('/api/:session/edit-message', async (req, res) => {
    const { session } = req.params;
    const { messageId, newText } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.editMessage(messageId, newText);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send poll message
app.post('/api/:session/send-poll-message', async (req, res) => {
    const { session } = req.params;
    const { phone, title, options, multipleAnswers = false } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendPollMessage(phone, title, options, { multipleAnswers });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get poll votes
app.get('/api/:session/votes/:messageId', async (req, res) => {
    const { session, messageId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const votes = await sessionData.client.getVotes(messageId);
        res.json({ success: true, votes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get message reactions
app.get('/api/:session/reactions/:messageId', async (req, res) => {
    const { session, messageId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const reactions = await sessionData.client.getReactions(messageId);
        res.json({ success: true, reactions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send sticker
app.post('/api/:session/send-sticker', async (req, res) => {
    const { session } = req.params;
    const { phone, base64 } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendImageAsSticker(phone, base64);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Send link preview
app.post('/api/:session/send-link-preview', async (req, res) => {
    const { session } = req.params;
    const { phone, url, title, description } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendLinkPreview(phone, url, title, description);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// CHAT MANAGEMENT APIs
// ============================================

// Get unread messages
app.get('/api/:session/all-unread-messages', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const messages = await sessionData.client.getUnreadMessages();
        res.json({ success: true, messages });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get archived chats
app.get('/api/:session/all-chats-archived', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const chats = await sessionData.client.getArchivedChats();
        res.json({ success: true, chats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Pin/Unpin chat
app.post('/api/:session/pin-chat', async (req, res) => {
    const { session } = req.params;
    const { chatId, pin = true } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        if (pin) {
            await sessionData.client.pinChat(chatId, true);
        } else {
            await sessionData.client.pinChat(chatId, false);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Clear chat
app.post('/api/:session/clear-chat', async (req, res) => {
    const { session } = req.params;
    const { chatId, keepStarred = true } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.clearChat(chatId, keepStarred);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mute chat
app.post('/api/:session/send-mute', async (req, res) => {
    const { session } = req.params;
    const { chatId, duration } = req.body; // duration in seconds, -1 for forever
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.muteChat(chatId, duration);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if contact is online
app.get('/api/:session/chat-is-online/:contactId', async (req, res) => {
    const { session, contactId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const isOnline = await sessionData.client.getChatIsOnline(contactId);
        res.json({ success: true, isOnline });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get last seen
app.get('/api/:session/last-seen/:contactId', async (req, res) => {
    const { session, contactId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const lastSeen = await sessionData.client.getLastSeen(contactId);
        res.json({ success: true, lastSeen });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get profile status
app.get('/api/:session/profile-status/:contactId', async (req, res) => {
    const { session, contactId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const status = await sessionData.client.getStatus(contactId);
        res.json({ success: true, status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// PROFILE APIs
// ============================================

// Set profile pic
app.post('/api/:session/set-profile-pic', async (req, res) => {
    const { session } = req.params;
    const { base64 } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.setProfilePic(base64);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set profile status
app.post('/api/:session/profile-status', async (req, res) => {
    const { session } = req.params;
    const { status } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.setProfileStatus(status);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Change username
app.post('/api/:session/change-username', async (req, res) => {
    const { session } = req.params;
    const { name } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.setProfileName(name);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// MISC APIs
// ============================================

// Reject call
app.post('/api/:session/reject-call', async (req, res) => {
    const { session } = req.params;
    const { callId } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        await sessionData.client.rejectCall(callId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get battery level
app.get('/api/:session/get-battery-level', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const battery = await sessionData.client.getBatteryLevel();
        res.json({ success: true, battery });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get my phone number
app.get('/api/:session/get-phone-number', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const number = await sessionData.client.getWid();
        res.json({ success: true, number });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Take screenshot
app.get('/api/:session/take-screenshot', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const screenshot = await sessionData.client.takeScreenshot();
        res.json({ success: true, screenshot });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get broadcast lists
app.get('/api/:session/all-broadcast-list', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const broadcasts = await sessionData.client.getAllBroadcastList();
        res.json({ success: true, broadcasts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Close session
app.post('/api/:session/close', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData) {
        return res.json({ success: true, message: 'Session not found' });
    }

    try {
        if (sessionData.client) {
            await sessionData.client.close();
        }
        sessions.delete(session);
        res.json({ success: true, message: 'Session closed' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Logout (clear session data)
app.post('/api/:session/logout', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.json({ success: true, message: 'Session not found' });
    }

    try {
        await sessionData.client.logout();
        sessions.delete(session);
        res.json({ success: true, message: 'Logged out' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Socket.IO connection
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    for (const [name, session] of sessions) {
        if (session.client) {
            try {
                await session.client.close();
            } catch (e) {
                // Ignore
            }
        }
    }
    process.exit(0);
});

// --- Catalog / Product Management ---

// Get all products from catalog
app.get('/api/:session/catalog/products', async (req, res) => {
    const { session } = req.params;
    const { phone = null, count = 50 } = req.query; // phone is optional, defaults to own catalog
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        // If phone is provided, get that user's catalog. If not, get own catalog.
        const products = await sessionData.client.getProducts(phone, count);
        res.json({ success: true, products });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get specific product
app.get('/api/:session/catalog/products/:productId', async (req, res) => {
    const { session, productId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const product = await sessionData.client.getProduct(productId);
        res.json({ success: true, product });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create product
app.post('/api/:session/catalog/products', async (req, res) => {
    const { session } = req.params;
    const { name, image, price, currency, isHidden, url, retailerId, description } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        // image should be base64
        const result = await sessionData.client.createProduct(
            name,
            image, // base64
            price,
            currency || 'INR',
            isHidden || false,
            url || '',
            retailerId || '',
            description || ''
        );
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Edit product
app.put('/api/:session/catalog/products/:productId', async (req, res) => {
    const { session, productId } = req.params;
    const { options } = req.body; // Object with fields to update
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.editProduct(productId, options);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete product
app.delete('/api/:session/catalog/products/:productId', async (req, res) => {
    const { session, productId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.delProducts([productId]);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==============================
// LABELS ENDPOINTS
// ==============================

// Get all labels
app.get('/api/:session/labels', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const labels = await sessionData.client.getAllLabels();
        res.json({ success: true, labels });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add new label
app.post('/api/:session/labels', async (req, res) => {
    const { session } = req.params;
    const { name, color } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.addNewLabel(name, { labelColor: color });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add or remove label from chat
app.post('/api/:session/labels/:labelId', async (req, res) => {
    const { session, labelId } = req.params;
    const { chatIds, action = 'add' } = req.body; // action: 'add' or 'remove'
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.addOrRemoveLabels(
            Array.isArray(chatIds) ? chatIds : [chatIds],
            [{ labelId, type: action }]
        );
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete label
app.delete('/api/:session/labels/:labelId', async (req, res) => {
    const { session, labelId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.deleteLabel(labelId);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get chats by label
app.get('/api/:session/labels/:labelId/chats', async (req, res) => {
    const { session, labelId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const chats = await sessionData.client.getChatsByLabelId(labelId);
        res.json({ success: true, chats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==============================
// BUSINESS PROFILE ENDPOINTS
// ==============================

// Get business profile
app.get('/api/:session/business-profile', async (req, res) => {
    const { session } = req.params;
    const { chatId } = req.query;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const profile = chatId
            ? await sessionData.client.getBusinessProfile(chatId)
            : await sessionData.client.getBusinessProfile();
        res.json({ success: true, profile });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Edit own business profile
app.put('/api/:session/business-profile', async (req, res) => {
    const { session } = req.params;
    const { description, email, website, address, categories } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.editBusinessProfile({
            description,
            email,
            website: Array.isArray(website) ? website : [website].filter(Boolean),
            address,
            categories
        });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==============================
// ORDER MESSAGE ENDPOINTS
// ==============================

// Send order message
app.post('/api/:session/send-order', async (req, res) => {
    const { session } = req.params;
    const { phone, items, options } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        // items: array of { productId, quantity }
        const result = await sessionData.client.sendOrderMessage(phone, items, options || {});
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


process.on('SIGTERM', () => process.emit('SIGINT'));

// Start server
server.listen(PORT, '127.0.0.1', () => {
    console.log(`WPPConnect Sidecar running on http://127.0.0.1:${PORT}`);
    console.log('Health check: /health');
    console.log('API docs: /api/status');
});
