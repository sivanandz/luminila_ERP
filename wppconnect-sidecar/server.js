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
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');

// Configuration
const PORT = process.env.WPPCONNECT_PORT || 21465;
const SECRET_KEY = process.env.WPPCONNECT_SECRET || 'luminila-secret-key';

// Tokens directory: securely stored in user home to prevent git contamination and exFAT volume locks
const TOKENS_BASE_DIR = process.env.WPP_TOKENS_DIR || path.join(os.homedir(), '.luminila', 'wpp_tokens');
try {
    if (!fs.existsSync(TOKENS_BASE_DIR)) {
        fs.mkdirSync(TOKENS_BASE_DIR, { recursive: true });
    }
} catch (e) {
    console.error('Failed to initialize tokens directory:', e.message);
}

function getSessionTokenPath(sessionName) {
    return path.join(TOKENS_BASE_DIR, sessionName);
}

function killOrphanedSessionBrowsers(sessionName) {
    if (process.platform !== 'win32') return;
    try {
        const out = execSync('powershell "Get-WmiObject Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json"', { encoding: 'utf-8', timeout: 5000 });
        const list = JSON.parse(out || '[]');
        const items = Array.isArray(list) ? list : [list];
        const sessionPath = getSessionTokenPath(sessionName);
        const orphaned = items.filter(i => i.CommandLine && (i.CommandLine.includes(sessionName) || i.CommandLine.includes(sessionPath)));
        for (const item of orphaned) {
            try {
                process.kill(item.ProcessId, 'SIGKILL');
            } catch {}
        }
    } catch { /* ignore */ }
}

async function cleanSessionTokens(sessionName) {
    killOrphanedSessionBrowsers(sessionName);
    const sessionPath = getSessionTokenPath(sessionName);
    const dataJson = path.join(TOKENS_BASE_DIR, `${sessionName}.data.json`);
    const qrPng = path.join(TOKENS_BASE_DIR, `${sessionName}_qr.png`);
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
            if (fs.existsSync(dataJson)) {
                fs.rmSync(dataJson, { force: true });
            }
            if (fs.existsSync(qrPng)) {
                fs.rmSync(qrPng, { force: true });
            }
            break;
        } catch (e) {
            await new Promise(r => setTimeout(r, 600));
        }
    }
}

function removeStaleProfileLocks(sessionName) {
    killOrphanedSessionBrowsers(sessionName);
    const sessionPath = getSessionTokenPath(sessionName);
    const lockFiles = [
        'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile',
        path.join('Default', 'lockfile'),
        path.join('Default', 'SingletonLock'),
        path.join('Default', 'SingletonCookie'),
        path.join('Default', 'SingletonSocket')
    ];
    for (const lock of lockFiles) {
        const lockPath = path.join(sessionPath, lock);
        try {
            if (fs.existsSync(lockPath)) {
                fs.unlinkSync(lockPath);
            }
        } catch { /* ignore */ }
    }
}

const app = express();
const server = http.createServer(app);

// Origin allowlist: the sidecar controls a live WhatsApp account, so arbitrary
// websites open in the user's browser must not be able to drive it.
const EXTRA_ORIGINS = (process.env.WPP_ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);
const TRUSTED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$/i;
function isAllowedOrigin(origin) {
    // Same-machine server-to-server calls (Next.js API routes, scripts) send no Origin
    if (!origin) return true;
    return TRUSTED_ORIGIN.test(origin) || origin === 'tauri://localhost' || EXTRA_ORIGINS.includes(origin);
}
const corsOrigin = (origin, cb) => cb(null, isAllowedOrigin(origin));

const io = new Server(server, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] }
});

io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token || token !== SECRET_KEY) {
        return next(new Error('Unauthorized: Invalid sidecar socket token'));
    }
    next();
});

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
        return res.status(403).json({ success: false, error: 'Origin not allowed' });
    }
    if (origin && (origin.includes('localhost') || origin.includes('tauri'))) {
        res.header('Access-Control-Allow-Private-Network', 'true');
    }
    next();
});

app.use(cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Api-Key'],
    credentials: true
}));

// Require Bearer token authentication for all /api endpoints
function requireSidecarAuth(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') 
        ? authHeader.slice(7).trim() 
        : (req.query.token || req.headers['x-api-key']);
        
    if (!token || token !== SECRET_KEY) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or missing sidecar API token' });
    }
    next();
}

app.use('/api', requireSidecarAuth);

// Session names become filesystem paths (token dirs are rm -rf'd on reset) - restrict strictly
const SESSION_NAME = /^[A-Za-z0-9_-]{1,64}$/;
app.param('session', (req, res, next, value) => {
    if (!SESSION_NAME.test(value)) {
        return res.status(400).json({ success: false, error: 'Invalid session name' });
    }
    next();
});

app.use(express.json({ limit: '50mb' })); // Increase limit for media uploads

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
            connected: (session.connected && !!session.client) || false,
            qrReady: session.qrReady || false
        });
    });
    res.json({ sessions: sessionList });
});

// ---------------------------------------------------------------------------
// Session lifecycle
// `client` is only set once WhatsApp is actually logged in (all API endpoints
// guard on it). `pendingClient` holds the pre-login handle so the Chromium
// instance can always be closed - otherwise retries leak browsers and lock the
// profile directory.
// ---------------------------------------------------------------------------
const QR_SCAN_TIMEOUT_MS = 10 * 60 * 1000;
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu'
];

function newSessionData() {
    return {
        connected: false,
        qrReady: false,
        qrCode: null,
        linkingPhone: false,
        pairingCode: null,
        client: null,
        pendingClient: null,
        failed: false,
        closing: false
    };
}

const isCurrent = (name, data) => sessions.get(name) === data;

async function closeSessionData(data) {
    if (!data) return;
    data.closing = true;
    data.connected = false;
    const handle = data.client || data.pendingClient;
    if (handle) {
        let pid = null;
        try {
            const browser = handle.page?.browser?.() || handle.browser;
            pid = browser?.process?.()?.pid;
        } catch { /* ignore */ }

        try {
            // Allow Chromium enough time to flush SQLite/IndexedDB session cache cleanly
            await Promise.race([
                handle.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
            ]);
        } catch { /* browser already gone or timed out */ }

        if (pid) {
            try {
                process.kill(pid, 'SIGKILL');
            } catch { /* process exited */ }
        }
        await new Promise(r => setTimeout(r, 600));
    }
}

function attachClientListeners(names, client) {
    const emit = (event, data) => names.forEach(session => io.emit(event, { session, ...data }));

    const handleMsg = (message) => {
        const payload = {
            id: message.id,
            from: message.from,
            to: message.to,
            body: message.body,
            type: message.type,
            timestamp: message.timestamp,
            isGroupMsg: message.isGroupMsg,
            fromMe: message.fromMe,
            sender: message.sender
        };
        emit('message', { message: payload });
    };

    if (typeof client.onAnyMessage === 'function') {
        client.onAnyMessage(handleMsg);
    } else if (typeof client.onMessage === 'function') {
        client.onMessage(handleMsg);
    }

    if (typeof client.onAck === 'function') {
        client.onAck((ack) => emit('ack', { ack }));
    }
    if (typeof client.onRevokedMessage === 'function') {
        client.onRevokedMessage((revoked) => emit('message_revoked', { revoked }));
    }
    if (typeof client.onReactionMessage === 'function') {
        client.onReactionMessage((reaction) => emit('message_reaction', { reaction }));
    }
    if (typeof client.onMessageEdit === 'function') {
        client.onMessageEdit((edited) => emit('message_edit', { edited }));
    }
    if (typeof client.onPollResponse === 'function') {
        client.onPollResponse((poll) => emit('poll_response', { poll }));
    }
}

/**
 * Boots a WPPConnect client and resolves once logged in (or rejects on failure).
 * Uses waitForLogin:false + manual client.waitForLogin() so the client handle
 * is available during the QR / pairing-code phase.
 */
async function bootSession({ session, sessionData, phoneNumber, onLinkCode, aliasOf }) {
    const names = aliasOf ? [session, aliasOf] : [session];
    const emit = (event, extra = {}) => names.forEach(s => io.emit(event, { session: s, ...extra }));

    const markConnected = (client) => {
        if (!isCurrent(session, sessionData)) return;
        sessionData.client = client;
        sessionData.connected = true;
        sessionData.qrReady = false;
        sessionData.qrCode = null;
        if (aliasOf) sessions.set(aliasOf, sessionData);
        console.log(`[${session}] Logged in`);
        emit('connected');
    };

    const markDisconnected = () => {
        if (!sessionData.connected) return;
        sessionData.connected = false;
        emit('disconnected');
    };

    try {
        removeStaleProfileLocks(session);
        const wpp = await getWppConnect();
        const client = await wpp.create({
            session,
            ...(phoneNumber ? { phoneNumber } : {}),
            folderNameToken: TOKENS_BASE_DIR,
            tokenStore: new wpp.tokenStore.FileTokenStore({ path: TOKENS_BASE_DIR }),
            catchQR: (base64Qr, asciiQR, attempts) => {
                if (!isCurrent(session, sessionData)) return;
                console.log(`[${session}] QR code generated (attempt ${attempts})`);
                sessionData.qrCode = base64Qr;
                sessionData.qrReady = true;
                sessionData.connected = false;
                emit('qrcode', { qrCode: base64Qr, attempts });
            },
            catchLinkCode: (code) => {
                console.log(`[${session}] Pairing code received: ${code}`);
                sessionData.pairingCode = code;
                sessionData.linkingPhone = true;
                sessionData.connected = false;
                sessionData.qrReady = false;
                if (onLinkCode) onLinkCode(code);
                emit('pairingCode', { code });
            },
            // statusFind is only used for teardown signals. NOTE: 'inChat' fires
            // before the QR is scanned, so it is NOT a reliable login signal.
            statusFind: (status) => {
                console.log(`[${session}] Status: ${status}`);
                if (!isCurrent(session, sessionData)) return;
                if (status === 'disconnectedMobile' || status === 'phoneNotConnected') {
                    markDisconnected();
                }
                if (status === 'browserClose' || status === 'autocloseCalled' || status === 'serverClose') {
                    sessionData.connected = false;
                    sessionData.failed = true;
                    sessions.delete(session);
                    if (aliasOf && sessions.get(aliasOf) === sessionData) sessions.delete(aliasOf);
                    emit('disconnected');
                }
            },
            headless: true,
            whatsappVersion: null,
            devtools: false,
            useChrome: true,
            debug: false,
            logQR: false,
            disableWelcome: true,
            updatesLog: false,
            browserArgs: BROWSER_ARGS,
            autoClose: 0, // 0 disables auto-closing the browser on idle or sync
            deviceSyncTimeout: 300000,
            waitForLogin: false,
            puppeteerOptions: {
                headless: true,
                userDataDir: getSessionTokenPath(session),
                defaultViewport: { width: 1280, height: 800 },
            },
        });

        sessionData.pendingClient = client;
        if (sessionData.closing || !isCurrent(session, sessionData)) {
            await client.close().catch(() => {});
            return;
        }
        attachClientListeners(names, client);

        const isLogged = await client.waitForLogin();
        if (!isLogged) throw new Error('Not logged in');
        sessionData.linkingPhone = false;
        sessionData.pairingCode = null;
        markConnected(client);

        // Stabilized connection state watcher: avoids abrupt disconnects on temporary network pings
        client.onStateChange(async (state) => {
            if (!isCurrent(session, sessionData) || sessionData.closing) return;
            console.log(`[${session}] Connection state: ${state}`);
            // Wait 5 seconds to let WhatsApp Web stabilize before evaluating connection status
            await new Promise(r => setTimeout(r, 5000));
            if (!isCurrent(session, sessionData) || sessionData.closing) return;

            const registered = await client.page
                ?.evaluate(() => window.WPP?.conn?.isRegistered?.() ?? true)
                .catch(() => null);

            if (registered === false) {
                console.warn(`[${session}] Connection dropped / device unlinked`);
                markDisconnected();
            } else if (registered === true && !sessionData.connected) {
                markConnected(client);
            }
        });
    } catch (error) {
        console.error(`[${session}] Session failed:`, error?.message || error);
        if (isCurrent(session, sessionData)) {
            sessions.delete(session);
            sessionData.failed = true;
            emit('disconnected');
        }
        await closeSessionData(sessionData);
        throw error;
    }
}

// Start new session (idempotent: repeated calls never spawn a second browser)
app.post('/api/:session/start', async (req, res) => {
    const { session } = req.params;
    const forceNew = req.body?.forceNew === true || req.query?.forceNew === 'true';
    const existing = sessions.get(session);

    if (existing && !forceNew && !existing.failed) {
        if (existing.connected && existing.client) {
            return res.json({ success: true, status: 'CONNECTED', message: 'Session already connected' });
        }
        return res.json({
            success: true,
            status: existing.qrReady ? 'QR_CODE' : 'INITIALIZING',
            qrcode: existing.qrCode,
            message: 'Session already starting'
        });
    }

    if (existing) {
        sessions.delete(session);
        await closeSessionData(existing);
    }
    if (forceNew) {
        console.log(`[${session}] Force clean requested - purging tokens`);
        await cleanSessionTokens(session);
    }

    const sessionData = newSessionData();
    sessions.set(session, sessionData);
    bootSession({ session, sessionData }).catch(() => { /* logged in bootSession */ });
    res.json({ success: true, status: 'INITIALIZING', message: 'Session starting' });
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

// Check session status (auto-boots from disk if profile exists)
const bootingSessions = new Set();

app.get('/api/:session/status', async (req, res) => {
    const { session } = req.params;
    let sessionData = sessions.get(session);

    if (!sessionData) {
        const tokenPath = getSessionTokenPath(session);
        // If an existing Chromium profile exists on disk and not already booting
        if (fs.existsSync(path.join(tokenPath, 'Default')) && !bootingSessions.has(session)) {
            console.log(`[${session}] Auto-restoring session from disk on status check...`);
            bootingSessions.add(session);
            sessionData = newSessionData();
            sessions.set(session, sessionData);
            bootSession({ session, sessionData })
                .catch(err => {
                    console.warn(`[${session}] Auto-start failed:`, err?.message || err);
                })
                .finally(() => {
                    bootingSessions.delete(session);
                });
            return res.json({
                exists: true,
                connected: false,
                status: 'INITIALIZING',
                qrReady: false,
                linkingPhone: false,
                pairingCode: null
            });
        }

        return res.json({
            exists: false,
            connected: false,
            status: 'DISCONNECTED',
            qrReady: false,
            linkingPhone: false,
            pairingCode: null
        });
    }

    let connectedNumber = null;
    let pushname = null;
    let hostDevice = null;
    if (sessionData.client && sessionData.connected) {
        try {
            hostDevice = await sessionData.client.getHostDevice().catch(() => null);
            pushname = hostDevice?.pushname || null;

            if (sessionData.client.getWid) {
                const wid = await sessionData.client.getWid().catch(() => null);
                if (wid?.user) connectedNumber = wid.user;
                else if (typeof wid === 'string') connectedNumber = wid.split('@')[0].split(':')[0];
            }
            if (!connectedNumber && sessionData.client.getMe) {
                const me = await sessionData.client.getMe().catch(() => null);
                if (me?.user) connectedNumber = me.user;
                else if (me?.id?.user) connectedNumber = me.id.user;
                else if (typeof me === 'string') connectedNumber = me.split('@')[0].split(':')[0];
            }
            if (!connectedNumber && sessionData.client.page) {
                const extracted = await sessionData.client.page.evaluate(() => {
                    const lsLastWid = window.localStorage ? (window.localStorage.getItem('last-wid-md') || window.localStorage.getItem('last-wid') || window.localStorage.getItem('WABrowserId')) : null;
                    const wppMe = window.WPP?.conn?.getMyUserId?.();
                    const connMe = window.WPP?.whatsapp?.Conn?.me?._serialized || window.WPP?.whatsapp?.Conn?.wid?._serialized;
                    const userMe = window.WPP?.whatsapp?.User?.getMaybeMeUser?.()?._serialized;
                    const myUserId = (typeof wppMe === 'string') ? wppMe : (wppMe?._serialized || wppMe?.user);
                    return { lsLastWid, myUserId, connMe, userMe };
                }).catch(() => null);
                if (extracted) {
                    const raw = extracted.myUserId || extracted.connMe || extracted.userMe || extracted.lsLastWid;
                    if (typeof raw === 'string') {
                        const matched = raw.match(/\d{8,15}/);
                        if (matched) connectedNumber = matched[0];
                    }
                }
            }
            if (!connectedNumber && hostDevice) {
                connectedNumber = hostDevice.wid?.user || hostDevice.id?.user || hostDevice.phone || null;
            }
        } catch (e) {
            // ignore
        }
    }

    if (connectedNumber) {
        sessionData.connectedNumber = connectedNumber;
    }

    res.json({
        exists: true,
        connected: (sessionData.connected && !!sessionData.client) || false,
        status: sessionData.connected ? 'CONNECTED' : (sessionData.qrReady ? 'QR_CODE' : (sessionData.linkingPhone ? 'LINKING_PHONE' : 'INITIALIZING')),
        qrReady: sessionData.qrReady || false,
        linkingPhone: sessionData.linkingPhone || false,
        pairingCode: sessionData.pairingCode || null,
        qrcode: sessionData.qrCode || null,
        connectedNumber,
        pushname,
        hostDevice
    });
});

app.get('/api/:session/host-device', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);
    if (!sessionData?.client || !sessionData?.connected) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }
    try {
        const hostDevice = await sessionData.client.getHostDevice();
        const connectedNumber = hostDevice?.wid?.user || hostDevice?.id?.user || hostDevice?.phone || null;
        res.json({ success: true, hostDevice, connectedNumber });
    } catch (err) {
        res.status(500).json({ success: false, error: err?.message || 'Failed to get host device' });
    }
});

// Logout session
app.post('/api/:session/logout', async (req, res) => {
    const { session } = req.params;
    const phoneSession = `${session}_phone`;
    const sessionData = sessions.get(session) || sessions.get(phoneSession);

    console.log(`[${session}] Logging out...`);
    if (sessionData && sessionData.client) {
        try { await sessionData.client.logout(); } catch (e) { console.warn(`[${session}] Logout warning:`, e.message); }
    }
    if (sessionData) {
        await closeSessionData(sessionData);
    }

    sessions.delete(session);
    sessions.delete(phoneSession);

    await cleanSessionTokens(session);
    await cleanSessionTokens(phoneSession);

    io.emit('disconnected', { session });
    io.emit('disconnected', { session: phoneSession });

    console.log(`[${session}] Logged out and cleaned up successfully`);
    res.json({ success: true, message: 'Logged out successfully' });
});

// Reset session completely (force clean without waiting for client)
app.post('/api/:session/reset', async (req, res) => {
    const { session } = req.params;
    const phoneSession = `${session}_phone`;
    console.log(`[${session}] Resetting and purging session completely...`);

    const mainData = sessions.get(session);
    if (mainData) await closeSessionData(mainData);
    const phoneData = sessions.get(phoneSession);
    if (phoneData) await closeSessionData(phoneData);

    sessions.delete(session);
    sessions.delete(phoneSession);

    await cleanSessionTokens(session);
    await cleanSessionTokens(phoneSession);

    io.emit('disconnected', { session });
    io.emit('disconnected', { session: phoneSession });

    res.json({ success: true, message: 'Session reset and all stored tokens cleared' });
});

// Request Pairing Code (Phone Number Login)
app.post('/api/:session/pair-phone', async (req, res) => {
    const { session } = req.params;
    const { phone } = req.body;

    const cleanPhone = String(phone || '').replace(/\D/g, '');
    console.log(`[${session}] Link Phone Request: ${cleanPhone} (raw: ${phone})`);

    if (!cleanPhone || cleanPhone.length < 8) {
        return res.status(400).json({ success: false, error: 'Invalid phone number' });
    }

    // Clean up ANY existing session for this session (and legacy _phone)
    const existing = sessions.get(session);
    if (existing) {
        sessions.delete(session);
        await closeSessionData(existing);
    }
    const legacyPhone = sessions.get(`${session}_phone`);
    if (legacyPhone) {
        sessions.delete(`${session}_phone`);
        await closeSessionData(legacyPhone);
    }

    // Clean stored tokens so phone pairing starts completely clean without picking up stale locks
    await cleanSessionTokens(session);

    try {
        const sessionData = newSessionData();
        sessionData.linkingPhone = true;
        sessions.set(session, sessionData);

        let codeResolved = false;
        const codePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (!codeResolved) reject(new Error("Timeout waiting for pairing code (90s)"));
            }, 90000);

            bootSession({
                session,
                sessionData,
                phoneNumber: cleanPhone,
                onLinkCode: (code) => {
                    codeResolved = true;
                    clearTimeout(timeout);
                    resolve(code);
                }
            }).catch(err => {
                if (!codeResolved) {
                    clearTimeout(timeout);
                    reject(err);
                }
            });
        });

        const code = await codePromise;
        res.json({ success: true, code, session });

    } catch (error) {
        console.error(`[${session}] Pairing request error:`, error);
        sessions.delete(session);
        res.status(500).json({ success: false, error: error.message || 'Failed to generate code' });
    }
});

// Close session (completely removes session)
app.post('/api/:session/close', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);
    sessions.delete(session);
    if (sessionData) await closeSessionData(sessionData);
    res.json({ success: true, message: 'Session closed successfully' });
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


// Get all chats
app.get('/api/:session/chats', async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        console.log(`[${session}] Fetching chats...`);

        let chats = [];
        try {
            if (typeof sessionData.client.listChats === 'function') {
                console.log(`[${session}] Calling client.listChats()...`);
                const result = await sessionData.client.listChats({ count: 100 });
                if (Array.isArray(result)) {
                    chats = result;
                }
            }
        } catch (err) {
            console.warn(`[${session}] client.listChats error:`, err.message);
        }

        // Direct in-page fallback using WPP.chat.list() if listChats didn't return an array
        if (!Array.isArray(chats) || chats.length === 0) {
            try {
                if (sessionData.client.page && !sessionData.client.page.isClosed()) {
                    console.log(`[${session}] Trying WPP.chat.list() in browser context...`);
                    const evaluated = await sessionData.client.page.evaluate(async () => {
                        if (window.WPP && window.WPP.chat && typeof window.WPP.chat.list === 'function') {
                            const raw = await window.WPP.chat.list({ count: 100 });
                            return (raw || []).map(c => {
                                const idStr = c.id?._serialized || (typeof c.id === 'string' ? c.id : '');
                                const nameStr = c.name || c.formattedTitle || c.contact?.pushname || c.contact?.name || (idStr ? idStr.split('@')[0] : 'Unknown');
                                const isComm = !!(c.isParentGroup || c.isCommunity || (c.groupMetadata && c.groupMetadata.isParentGroup));
                                const isCommAnnounce = !!(c.isCommunityAnnounce || c.isDefaultSubgroup || (c.groupMetadata && c.groupMetadata.isCommunityAnnounce) || (c.isGroup && nameStr.toLowerCase().includes('announcement')));
                                return {
                                    id: { _serialized: idStr },
                                    name: nameStr,
                                    isGroup: !!c.isGroup,
                                    isParentGroup: isComm,
                                    isCommunity: isComm,
                                    isCommunityAnnounce: isCommAnnounce,
                                    isNewsletter: idStr.includes('@newsletter'),
                                    parentGroup: c.parentGroup?._serialized || c.parentGroup || null,
                                    timestamp: c.t || c.timestamp || Math.floor(Date.now() / 1000),
                                    unreadCount: c.unreadCount || 0,
                                    lastMessage: c.lastMessage ? {
                                        body: c.lastMessage.body || '',
                                        timestamp: c.lastMessage.t || c.lastMessage.timestamp || 0,
                                        type: c.lastMessage.type || 'chat'
                                    } : undefined
                                };
                            });
                        }
                        return [];
                    });
                    if (Array.isArray(evaluated) && evaluated.length > 0) {
                        chats = evaluated;
                    }
                }
            } catch (evalErr) {
                console.warn(`[${session}] Browser WPP.chat.list() error:`, evalErr.message);
            }
        }

        console.log(`[${session}] Retrieved ${chats.length} chats`);

        // Enrich the top 50 chats with lastMessage if missing
        const slicedChats = (chats || []).slice(0, 100);

        const enrichedChats = await Promise.all(slicedChats.map(async (chat) => {
            try {
                if (!chat.lastMessage || !chat.lastMessage.body) {
                    const chatId = chat.id?._serialized || (typeof chat.id === 'string' ? chat.id : null);
                    if (chatId && typeof sessionData.client.getMessages === 'function') {
                        const msgs = await sessionData.client.getMessages(chatId, { count: 1 });
                        if (msgs && msgs.length > 0) {
                            chat.lastMessage = msgs[msgs.length - 1];
                        }
                    }
                }
            } catch (err) {
                console.warn(`[${session}] Failed to enrich chat ${chat.id?._serialized || chat.id}: ${err.message}`);
            }

            const idStr = chat.id?._serialized || (typeof chat.id === 'string' ? chat.id : '');
            const nameStr = (chat.name || chat.formattedTitle || chat.contact?.pushname || chat.contact?.name || '').toLowerCase();
            const isComm = Boolean(chat.isParentGroup || chat.isCommunity || (chat.groupMetadata && chat.groupMetadata.isParentGroup) || nameStr.includes('community'));
            const isCommAnnounce = Boolean(
                chat.isCommunityAnnounce ||
                chat.isDefaultSubgroup ||
                (chat.groupMetadata && chat.groupMetadata.isCommunityAnnounce) ||
                ((chat.isGroup || idStr.includes('@g.us')) && (nameStr.includes('announcement') || nameStr.includes('announcements')))
            );

            chat.isParentGroup = isComm;
            chat.isCommunity = isComm;
            chat.isCommunityAnnounce = isCommAnnounce;
            chat.isNewsletter = idStr.includes('@newsletter');

            const readTime = sessionData.readChats?.get(idStr);
            const msgTime = chat.lastMessage?.timestamp || chat.lastMessage?.t || chat.t || chat.timestamp || 0;
            if (readTime && msgTime <= readTime) {
                chat.unreadCount = 0;
            }

            return chat;
        }));

        res.json({ success: true, chats: enrichedChats });
    } catch (error) {
        console.error(`[${session}] Fetch chats Error:`, error);
        res.status(500).json({ success: false, error: error.message, stack: error.stack });
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

// Get profile picture (supports individual contacts, groups, communities, and newsletters)
app.get('/api/:session/profile-pic/:contactId', async (req, res) => {
    const { session, contactId } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        let profilePic = null;

        // 1. In-browser evaluate via WPP functions (safely handles @c.us, @g.us, @newsletter)
        if (sessionData.client.page && !sessionData.client.page.isClosed()) {
            try {
                profilePic = await sessionData.client.page.evaluate(async (id) => {
                    try {
                        // A. Try WPP.contact.getProfilePictureUrl (supports contact, group, newsletter)
                        if (window.WPP?.contact?.getProfilePictureUrl) {
                            const url = await window.WPP.contact.getProfilePictureUrl(id);
                            if (url) return url;
                        }
                        // B. Check WPP.chat or Store.Chat models
                        const chat = window.WPP?.chat?.get ? window.WPP.chat.get(id) : window.Store?.Chat?.get(id);
                        if (chat) {
                            if (chat.profilePicThumbObj?.eurl) return chat.profilePicThumbObj.eurl;
                            if (chat.profilePicThumbObj?.img) return chat.profilePicThumbObj.img;
                            if (chat.contact?.profilePicThumbObj?.eurl) return chat.contact.profilePicThumbObj.eurl;
                            if (chat.contact?.profilePicThumbObj?.img) return chat.contact.profilePicThumbObj.img;
                            if (chat.groupMetadata?.icon) return chat.groupMetadata.icon;
                            if (chat.newsletterMetadata?.icon) return chat.newsletterMetadata.icon;
                        }
                        // C. Check Contact store
                        const contact = window.WPP?.contact?.get ? window.WPP.contact.get(id) : window.Store?.Contact?.get(id);
                        if (contact) {
                            if (contact.profilePicThumbObj?.eurl) return contact.profilePicThumbObj.eurl;
                            if (contact.profilePicThumbObj?.img) return contact.profilePicThumbObj.img;
                        }
                    } catch {
                        // ignore inside evaluate
                    }
                    return null;
                }, contactId);
            } catch {
                // ignore evaluate errors
            }
        }

        // 2. Fallback to client.getProfilePicFromServer if evaluate did not return
        if (!profilePic && typeof sessionData.client.getProfilePicFromServer === 'function') {
            try {
                profilePic = await sessionData.client.getProfilePicFromServer(contactId);
            } catch {
                // ignore
            }
        }

        res.json({ success: true, profilePic });
    } catch (error) {
        res.json({ success: true, profilePic: null });
    }
});

// Download media from message
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
        let base64Content = null;
        let downloadErr = null;

        try {
            base64Content = await sessionData.client.downloadMedia(messageId);
        } catch (err) {
            downloadErr = err;
        }

        // Secondary fallback: if client.downloadMedia threw, check if page is alive and try evaluate
        if (!base64Content && sessionData.client.page && !sessionData.client.page.isClosed()) {
            try {
                base64Content = await sessionData.client.page.evaluate(async (id) => {
                    try {
                        if (window.WPP?.chat?.downloadMedia) {
                            const blob = await window.WPP.chat.downloadMedia(id);
                            if (blob && window.WPP?.util?.blobToBase64) {
                                return await window.WPP.util.blobToBase64(blob);
                            }
                        }
                    } catch {
                        // ignore inside browser evaluate
                    }
                    return null;
                }, messageId);
            } catch {
                // ignore fallback error
            }
        }

        if (!base64Content) {
            const reason = downloadErr?.message || 'Media not found or expired on WhatsApp';
            console.log(`[${session}] Media unavailable for message ${messageId}: ${reason}`);
            return res.status(404).json({ success: false, error: reason });
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
            return res.status(404).json({ success: false, error: 'Unknown media format' });
        }

        res.json({ success: true, mediaUrl: dataUri, mimetype });
    } catch (error) {
        const errorMsg = error?.message || 'Failed to download media';
        console.warn(`[${session}] Download media error:`, errorMsg);
        res.status(404).json({ success: false, error: errorMsg });
    }
});

// Send image (supports base64, data URI, or URL)
app.post('/api/:session/send-image', async (req, res) => {
    const { session } = req.params;
    const { phone, base64, imageUrl, filename, caption } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const to = phone.includes('@') ? phone : `${phone}@c.us`;
        const content = base64 || imageUrl;
        if (!content) {
            return res.status(400).json({ success: false, error: 'base64 or imageUrl is required' });
        }
        const result = await sessionData.client.sendImage(to, content, filename || 'image.jpg', caption || '');
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
        let result;
        if (ptt) {
            if (typeof base64 === 'string' && (base64.startsWith('data:') || /^[A-Za-z0-9+/=]{50,}$/.test(base64.trim()))) {
                result = await sessionData.client.sendPttFromBase64(phone, base64, 'voice.oga');
            } else if (typeof sessionData.client.sendPtt === 'function') {
                result = await sessionData.client.sendPtt(phone, base64);
            } else {
                result = await sessionData.client.sendPttFromBase64(phone, base64, 'voice.oga');
            }
        } else {
            result = await sessionData.client.sendFile(phone, base64, 'audio.mp3', '');
        }
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

// Mark chat as read (supports both POST body and URL param)
app.post(['/api/:session/mark-as-read', '/api/:session/mark-as-read/:chatId'], async (req, res) => {
    const { session } = req.params;
    const chatId = req.params.chatId || req.body?.chatId;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    if (!chatId) {
        return res.status(400).json({ success: false, error: 'chatId is required' });
    }

    try {
        if (!sessionData.readChats) sessionData.readChats = new Map();
        sessionData.readChats.set(chatId, Date.now() / 1000);

        if (sessionData.client.page && !sessionData.client.page.isClosed()) {
            await sessionData.client.page.evaluate(async (id) => {
                try {
                    if (window.WPP?.chat?.sendSeen) {
                        await window.WPP.chat.sendSeen(id);
                    }
                    if (window.WPP?.chat?.markIsRead) {
                        await window.WPP.chat.markIsRead(id);
                    }
                    if (window.WPP?.chat?.openChatBottom) {
                        await window.WPP.chat.openChatBottom(id);
                    }
                    const chat = window.WPP?.chat?.get ? window.WPP.chat.get(id) : window.Store?.Chat?.get(id);
                    if (chat) {
                        chat.unreadCount = 0;
                        chat.markedUnread = false;
                        if (chat.msgUnreadCnt !== undefined) chat.msgUnreadCnt = 0;
                    }
                } catch { /* ignore in-browser error */ }
            }, chatId);
        }
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
        await sessionData.client.archiveChat(chatId, !!archive);
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
        let starred = [];
        if (sessionData.client.page && !sessionData.client.page.isClosed()) {
            starred = await sessionData.client.page.evaluate(async () => {
                try {
                    if (window.WPP?.chat?.getStarredMessages) {
                        return await window.WPP.chat.getStarredMessages();
                    }
                    if (window.Store?.Msg?.models) {
                        return window.Store.Msg.models.filter(m => m.star).map(m => ({
                            id: m.id?._serialized || m.id,
                            from: m.from?._serialized || m.from,
                            to: m.to?._serialized || m.to,
                            body: m.body || '',
                            timestamp: m.t || m.timestamp || 0
                        }));
                    }
                } catch { /* ignore */ }
                return [];
            }).catch(() => []);
        }
        res.json({ success: true, messages: starred || [] });
    } catch (error) {
        res.json({ success: true, messages: [] });
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
        let groupInfo = null;
        if (sessionData.client.page && !sessionData.client.page.isClosed()) {
            groupInfo = await sessionData.client.page.evaluate(async (id) => {
                try {
                    if (window.WPP?.group?.getGroupMetadata) {
                        return await window.WPP.group.getGroupMetadata(id);
                    }
                    const chat = window.Store?.Chat?.get(id);
                    if (chat) {
                        return {
                            id: chat.id?._serialized || chat.id,
                            name: chat.name,
                            description: chat.groupMetadata?.desc,
                            participants: chat.groupMetadata?.participants?.map(p => ({
                                id: p.id?._serialized || p.id,
                                isAdmin: p.isAdmin,
                                isSuperAdmin: p.isSuperAdmin
                            }))
                        };
                    }
                } catch { /* ignore */ }
                return null;
            }, groupId).catch(() => null);
        }
        if (!groupInfo) {
            const members = await sessionData.client.getGroupMembers(groupId).catch(() => []);
            const admins = await sessionData.client.getGroupAdmins(groupId).catch(() => []);
            groupInfo = {
                id: groupId,
                participants: members,
                admins: admins
            };
        }
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
        const ids = Array.isArray(productIds) ? productIds : [productIds].filter(Boolean);
        const result = await sessionData.client.delProducts(ids);
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
    const { base64, imageUrl, caption } = req.body;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const content = base64 || imageUrl;
        if (!content) {
            return res.status(400).json({ success: false, error: 'base64 or imageUrl is required' });
        }
        const result = await sessionData.client.sendImageStatus(content, { caption });
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
        let result;
        if (typeof sessionData.client.sendReactionToMessage === 'function') {
            result = await sessionData.client.sendReactionToMessage(messageId, reaction || '');
        } else if (sessionData.client.page && !sessionData.client.page.isClosed()) {
            result = await sessionData.client.page.evaluate(async ({ id, emoji }) => {
                if (window.WPP?.chat?.sendReactionToMessage) {
                    return await window.WPP.chat.sendReactionToMessage(id, emoji || '');
                }
            }, { id: messageId, emoji: reaction });
        }
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

// Get unread messages (supports both /unread-messages and /all-unread-messages)
app.get(['/api/:session/unread-messages', '/api/:session/all-unread-messages'], async (req, res) => {
    const { session } = req.params;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        const messages = await sessionData.client.getUnreadMessages();
        res.json({ success: true, messages: messages || [] });
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
        let chats = [];
        if (typeof sessionData.client.listChats === 'function') {
            chats = await sessionData.client.listChats({ only: 'archived' }).catch(() => []);
        }
        if (!Array.isArray(chats) || chats.length === 0) {
            if (sessionData.client.page && !sessionData.client.page.isClosed()) {
                chats = await sessionData.client.page.evaluate(async () => {
                    if (window.WPP?.chat?.list) {
                        return await window.WPP.chat.list({ only: 'archived' });
                    }
                    return [];
                }).catch(() => []);
            }
        }
        res.json({ success: true, chats: chats || [] });
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
        let result;
        if (typeof sessionData.client.sendMute === 'function') {
            result = await sessionData.client.sendMute(chatId, duration || 8, 'hours');
        } else if (sessionData.client.page && !sessionData.client.page.isClosed()) {
            result = await sessionData.client.page.evaluate(async ({ id, time }) => {
                if (window.WPP?.chat?.mute) {
                    return await window.WPP.chat.mute(id, { expiration: time });
                }
            }, { id: chatId, time: duration });
        }
        res.json({ success: true, result });
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
        const product = await sessionData.client.getProductById(productId);
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
        // CatalogLayer signature: createProduct(name, image, description, price, isHidden, url, retailerId, currency)
        const result = await sessionData.client.createProduct(
            name,
            image, // base64
            description || '',
            price,
            isHidden || false,
            url || '',
            retailerId || '',
            currency || 'INR'
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
        let chats = [];
        if (sessionData.client.page && !sessionData.client.page.isClosed()) {
            chats = await sessionData.client.page.evaluate(async (id) => {
                if (window.WPP?.labels?.getChatsByLabel) {
                    return await window.WPP.labels.getChatsByLabel(id);
                }
                const label = window.Store?.Label?.get(id);
                if (label?.chatIds) {
                    return label.chatIds;
                }
                return [];
            }, labelId).catch(() => []);
        }
        res.json({ success: true, chats: chats || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==============================
// BUSINESS PROFILE ENDPOINTS
// ==============================

app.get('/api/:session/business-profile', async (req, res) => {
    const { session } = req.params;
    const { chatId } = req.query;
    const sessionData = sessions.get(session);

    if (!sessionData || !sessionData.client) {
        return res.status(404).json({ success: false, error: 'Session not connected' });
    }

    try {
        let targetChatId = chatId;
        if (!targetChatId) {
            if (sessionData.connectedNumber) {
                targetChatId = `${sessionData.connectedNumber.replace(/\D/g, '')}@c.us`;
            } else if (sessionData.client.getWid) {
                const wid = await sessionData.client.getWid().catch(() => null);
                const u = wid?.user || (typeof wid === 'string' ? wid.split('@')[0].split(':')[0] : null);
                if (u) {
                    sessionData.connectedNumber = u;
                    targetChatId = `${u.replace(/\D/g, '')}@c.us`;
                }
            }
        }
        const profile = targetChatId
            ? await sessionData.client.getBusinessProfile(targetChatId)
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


// Auto-restore saved sessions on startup
async function autoRestoreSavedSessions() {
    try {
        if (!fs.existsSync(TOKENS_BASE_DIR)) return;
        const entries = fs.readdirSync(TOKENS_BASE_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && SESSION_NAME.test(entry.name)) {
                const sessionName = entry.name;
                // Ignore legacy _phone dirs if primary session exists
                if (sessionName.endsWith('_phone') && fs.existsSync(path.join(TOKENS_BASE_DIR, sessionName.replace('_phone', '')))) {
                    continue;
                }
                const tokenPath = path.join(TOKENS_BASE_DIR, sessionName);
                const idbPath = path.join(tokenPath, 'Default', 'IndexedDB', 'https_web.whatsapp.com_0.indexeddb.leveldb');
                if (fs.existsSync(idbPath)) {
                    console.log(`[${sessionName}] Found existing session profile on disk, auto-restoring...`);
                    const sessionData = newSessionData();
                    sessions.set(sessionName, sessionData);
                    bootSession({ session: sessionName, sessionData }).catch(err => {
                        console.warn(`[${sessionName}] Auto-restore failed:`, err?.message || err);
                    });
                }
            }
        }
    } catch (e) {
        console.error('Error auto-restoring sessions:', e.message);
    }
}

process.on('SIGTERM', () => process.emit('SIGINT'));

// Start server
server.listen(PORT, '127.0.0.1', () => {
    console.log(`WPPConnect Sidecar running on http://127.0.0.1:${PORT}`);
    console.log('Health check: /health');
    console.log('API docs: /api/status');
    autoRestoreSavedSessions();
});
