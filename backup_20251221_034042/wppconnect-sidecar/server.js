/**
 * WPPConnect Sidecar Server
 * Lightweight WhatsApp API server for Luminila
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
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
            debug: false,
            logQR: false,
            browserArgs: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--disable-gpu'
            ],
            puppeteerOptions: {
                headless: 'new'
            }
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

// Send text message
app.post('/api/:session/send-message', async (req, res) => {
    const { session } = req.params;
    const { phone, message } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const result = await sessionData.client.sendText(`${phone}@c.us`, message);
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
        const chats = await sessionData.client.getAllChats();
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

process.on('SIGTERM', () => process.emit('SIGINT'));

// Start server
server.listen(PORT, '127.0.0.1', () => {
    console.log(`WPPConnect Sidecar running on http://127.0.0.1:${PORT}`);
    console.log('Health check: /health');
    console.log('API docs: /api/status');
});
