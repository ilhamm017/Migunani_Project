import { Client, LocalAuth } from 'whatsapp-web.js';
import fs from 'fs/promises';
import path from 'path';
import { Setting } from '../models';

const protocolTimeout = Number(process.env.WA_PROTOCOL_TIMEOUT_MS || 120000);
const stuckInitTimeoutMs = Number(process.env.WA_INIT_STUCK_MS || 45000);
const chromeExecutablePath = process.env.WA_CHROME_PATH;
const autoReconnectEnabled = process.env.WA_AUTO_RECONNECT !== 'false';
const reconnectBaseDelayMs = Number(process.env.WA_RECONNECT_BASE_DELAY_MS || 5000);
const reconnectMaxDelayMs = Number(process.env.WA_RECONNECT_MAX_DELAY_MS || 60000);
const cleanProfileLocksBeforeInit = process.env.WA_CLEAN_PROFILE_LOCKS !== 'false';

const waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: process.env.WA_SESSION_PATH }),
    puppeteer: {
        headless: true,
        protocolTimeout,
        executablePath: chromeExecutablePath || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--no-first-run'
        ]
    }
});

let latestQr: string | null = null;
let clientStatus: string = 'STOPPED';
let initializePromise: Promise<void> | null = null;
let initializeStartedAt: number | null = null;
let lastInitializeError: string | null = null;
let initializeRunId = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let reconnectAt: number | null = null;
let lastDisconnectReason: string | null = null;
let autoReconnectBlockedUntil = 0;

export const getQr = () => latestQr;
export const getStatus = () => clientStatus;
export const isInitializing = () => initializePromise !== null;
export const getWhatsappDiagnostics = () => ({
    is_initializing: initializePromise !== null,
    has_qr: !!latestQr,
    initializing_for_ms: initializeStartedAt ? Date.now() - initializeStartedAt : 0,
    last_error: lastInitializeError,
    reconnect_attempts: reconnectAttempts,
    reconnect_in_ms: reconnectAt ? Math.max(0, reconnectAt - Date.now()) : 0,
    auto_reconnect_enabled: autoReconnectEnabled,
    auto_reconnect_blocked: Date.now() < autoReconnectBlockedUntil,
    last_disconnect_reason: lastDisconnectReason
});

const clearReconnectTimer = () => {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    reconnectAt = null;
};

export const blockAutoReconnect = (ms = 60000) => {
    autoReconnectBlockedUntil = Date.now() + Math.max(0, ms);
    clearReconnectTimer();
};

const unblockAutoReconnect = () => {
    autoReconnectBlockedUntil = 0;
};

const shouldSkipAutoReconnect = () => {
    if (!autoReconnectEnabled) return true;
    if (Date.now() < autoReconnectBlockedUntil) return true;
    if (clientStatus === 'READY' || clientStatus === 'INITIALIZING') return true;
    return false;
};

const scheduleAutoReconnect = (reason: string, options: { force?: boolean } = {}) => {
    if (shouldSkipAutoReconnect()) {
        return;
    }

    if (reconnectTimer) {
        return;
    }

    reconnectAttempts += 1;
    const attempt = reconnectAttempts;
    const delay = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * (2 ** Math.max(0, attempt - 1)));
    reconnectAt = Date.now() + delay;
    console.warn(`[WA] scheduling auto reconnect in ${delay}ms (attempt ${attempt}) reason=${reason}`);

    reconnectTimer = setTimeout(async () => {
        clearReconnectTimer();

        if (shouldSkipAutoReconnect()) {
            return;
        }

        try {
            await startWhatsappClient({ force: options.force === true });
        } catch (error) {
            console.error('[WA] auto reconnect failed to start:', error);
            scheduleAutoReconnect('auto_reconnect_start_failed');
        }
    }, delay);
};

const isInitializeStuck = () => {
    if (clientStatus !== 'INITIALIZING' || !initializeStartedAt || latestQr) {
        return false;
    }

    return (Date.now() - initializeStartedAt) > stuckInitTimeoutMs;
};

const getSessionDir = () => {
    const waSessionPath = process.env.WA_SESSION_PATH || './.wwebjs_auth';
    return path.resolve(process.cwd(), waSessionPath);
};

const removeFileIfExists = async (filePath: string) => {
    try {
        await fs.access(filePath);
    } catch {
        return false;
    }

    try {
        await fs.rm(filePath, { force: true });
        return true;
    } catch {
        return false;
    }
};

const clearChromiumProfileLocks = async () => {
    if (!cleanProfileLocksBeforeInit) return;

    const sessionDir = getSessionDir();
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];

    try {
        entries = await fs.readdir(sessionDir, { withFileTypes: true });
    } catch {
        return;
    }

    const lockFileNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    const removedPaths: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('session-')) continue;

        const profilePath = path.join(sessionDir, entry.name);
        for (const lockFileName of lockFileNames) {
            const target = path.join(profilePath, lockFileName);
            const removed = await removeFileIfExists(target);
            if (removed) removedPaths.push(target);
        }
    }

    if (removedPaths.length > 0) {
        console.warn(`[WA] removed ${removedPaths.length} stale chromium profile lock artifact(s)`);
    }
};

export const startWhatsappClient = async (options: { force?: boolean } = {}) => {
    const force = options.force === true;
    console.log(`[WA] connect requested force=${force} status=${clientStatus}`);
    unblockAutoReconnect();
    clearReconnectTimer();

    if (force) {
        await resetWhatsappSession();
    }

    if (clientStatus === 'READY') {
        return { status: clientStatus, message: 'WhatsApp client already connected' };
    }

    if (initializePromise) {
        if (isInitializeStuck()) {
            await resetWhatsappSession();
        } else {
            return {
                status: 'INITIALIZING',
                message: 'WhatsApp client is already initializing',
                ...getWhatsappDiagnostics()
            };
        }
    }

    if (initializePromise) {
        return {
            status: 'INITIALIZING',
            message: 'WhatsApp client is already initializing',
            ...getWhatsappDiagnostics()
        };
    }

    await clearChromiumProfileLocks();

    clientStatus = 'INITIALIZING';
    latestQr = null;
    initializeStartedAt = Date.now();
    lastInitializeError = null;
    const runId = ++initializeRunId;

    initializePromise = waClient.initialize()
        .then(() => {
            console.log('[WA] initialize() resolved');
        })
        .catch((error) => {
            if (runId !== initializeRunId) {
                return;
            }

            clientStatus = 'ERROR';
            lastInitializeError = error instanceof Error ? error.message : String(error);
            console.error('WhatsApp initialize error:', error);
            scheduleAutoReconnect('initialize_error');
        })
        .finally(() => {
            if (runId !== initializeRunId) {
                return;
            }

            initializePromise = null;
            initializeStartedAt = null;
        });

    return {
        status: clientStatus,
        message: 'WhatsApp client initialization started',
        ...getWhatsappDiagnostics()
    };
};

export const resetWhatsappSession = async () => {
    initializeRunId += 1;
    clearReconnectTimer();

    try {
        await waClient.destroy();
    } catch (error) {
        console.warn('WhatsApp destroy skipped:', error);
    }

    const sessionDir = getSessionDir();
    await fs.rm(sessionDir, { recursive: true, force: true });

    latestQr = null;
    clientStatus = 'STOPPED';
    initializePromise = null;
    initializeStartedAt = null;
    lastInitializeError = null;
    reconnectAttempts = 0;
    lastDisconnectReason = null;

    return { status: clientStatus, message: 'WhatsApp session reset completed' };
};

// We can attach internal listeners to update state
waClient.on('qr', (qr) => {
    console.log('[WA] QR received');
    latestQr = qr;
    clientStatus = 'QR_RECEIVED';
    lastInitializeError = null;
    initializeStartedAt = null;
    reconnectAttempts = 0;
    clearReconnectTimer();
});

waClient.on('ready', async () => {
    console.log('[WA] ready');
    latestQr = null;
    clientStatus = 'READY';
    lastInitializeError = null;
    initializeStartedAt = null;
    reconnectAttempts = 0;
    lastDisconnectReason = null;
    clearReconnectTimer();

    // Save info to DB
    try {
        const info = waClient.info;
        await Setting.upsert({
            key: 'whatsapp_session',
            value: {
                status: 'CONNECTED',
                wid: info.wid,
                pushname: info.pushname,
                platform: info.platform,
                connectedAt: new Date()
            },
            description: 'WhatsApp Connection Status'
        });
        console.log('WhatsApp Session Saved to DB');
    } catch (error) {
        console.error('Error saving WhatsApp session:', error);
    }
});

waClient.on('authenticated', () => {
    console.log('[WA] authenticated');
    clientStatus = 'AUTHENTICATED';
    lastInitializeError = null;
    initializeStartedAt = null;
    reconnectAttempts = 0;
});

waClient.on('auth_failure', (message) => {
    console.error('[WA] auth failure:', message);
    clientStatus = 'AUTH_FAILURE';
    lastInitializeError = message || 'Authentication failed';
    initializeStartedAt = null;
    lastDisconnectReason = 'AUTH_FAILURE';
    scheduleAutoReconnect('auth_failure', { force: true });
});

waClient.on('disconnected', async (reason: string) => {
    console.warn('[WA] disconnected:', reason);
    clientStatus = 'DISCONNECTED';
    latestQr = null;
    initializeStartedAt = null;
    initializePromise = null;
    lastDisconnectReason = reason || 'UNKNOWN';

    const normalizedReason = String(reason || '').toUpperCase();
    const isManualLogout = normalizedReason.includes('LOGOUT');
    if (isManualLogout) {
        blockAutoReconnect(60000);
        reconnectAttempts = 0;
    } else {
        scheduleAutoReconnect('disconnected');
    }

    // Update DB
    try {
        await Setting.upsert({
            key: 'whatsapp_session',
            value: {
                status: 'DISCONNECTED',
                disconnectedAt: new Date()
            },
            description: 'WhatsApp Connection Status'
        });
    } catch (error) {
        console.error('Error updating WhatsApp session disconnect:', error);
    }
});

export default waClient;
