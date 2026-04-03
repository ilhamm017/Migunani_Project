import { Client, LocalAuth } from 'whatsapp-web.js';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { Setting } from '../models';

const protocolTimeout = Number(process.env.WA_PROTOCOL_TIMEOUT_MS || 120000);
const stuckInitTimeoutMs = Number(process.env.WA_INIT_STUCK_MS || 45000);
const authTimeoutMsRaw = Number(process.env.WA_AUTH_TIMEOUT_MS || 120000);
const authTimeoutMs = Number.isFinite(authTimeoutMsRaw) && authTimeoutMsRaw >= 0 ? authTimeoutMsRaw : 120000;
const chromeExecutablePath = process.env.WA_CHROME_PATH;
const autoReconnectEnabled = process.env.WA_AUTO_RECONNECT !== 'false';
const reconnectBaseDelayMs = Number(process.env.WA_RECONNECT_BASE_DELAY_MS || 5000);
const reconnectMaxDelayMs = Number(process.env.WA_RECONNECT_MAX_DELAY_MS || 60000);
const cleanProfileLocksBeforeInit = process.env.WA_CLEAN_PROFILE_LOCKS !== 'false';
const persistStatusToDb = process.env.WA_PERSIST_STATUS_TO_DB !== 'false';
const dumpBrowserIo = String(process.env.WA_DUMPIO || '').trim().toLowerCase() === 'true';

const waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: process.env.WA_SESSION_PATH }),
    authTimeoutMs,
    puppeteer: {
        headless: true,
        protocolTimeout,
        executablePath: chromeExecutablePath || undefined,
        dumpio: dumpBrowserIo,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--metrics-recording-only',
            '--disable-default-apps',
            '--mute-audio'
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
        // Use lstat so broken symlinks (Chromium singleton artifacts) still count as existing.
        await fs.lstat(filePath);
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

const tryKillPid = (pid: number, reason: string) => {
    if (!Number.isFinite(pid) || pid <= 1) return false;
    try {
        process.kill(pid, 'SIGKILL');
        console.warn(`[WA] killed pid=${pid} (${reason})`);
        return true;
    } catch (error) {
        console.warn(`[WA] failed to kill pid=${pid} (${reason}):`, error);
        return false;
    }
};

const extractPidFromMessage = (message: string): number | null => {
    const text = String(message || '');
    const patterns = [
        /\bChromium process\s*\((\d+)\)\b/i,
        /\bprocess\s*\((\d+)\)\b/i,
        /\bpid\s*[:=]\s*(\d+)\b/i,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (!m) continue;
        const pid = Number(m[1]);
        if (Number.isFinite(pid) && pid > 1) return pid;
    }
    return null;
};

const readPidFromSingletonCookie = async (cookiePath: string): Promise<number | null> => {
    try {
        const buf = await fs.readFile(cookiePath);
        // Best-effort: chromium's SingletonCookie often starts with "<pid> <hostname> ..."
        const head = buf.subarray(0, 128).toString('utf8');
        const m = head.match(/^\s*(\d+)\s+/);
        if (!m) return null;
        const pid = Number(m[1]);
        return Number.isFinite(pid) && pid > 1 ? pid : null;
    } catch {
        return null;
    }
};

const execFileText = async (file: string, args: string[]) => {
    return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) return reject(error);
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
};

const listChromiumPidsByUserDataRoot = async (rootDir: string): Promise<number[]> => {
    const root = path.resolve(rootDir);
    try {
        const { stdout } = await execFileText('ps', ['-eo', 'pid=,args=']);
        const pids: number[] = [];
        for (const line of stdout.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const m = trimmed.match(/^(\d+)\s+(.*)$/);
            if (!m) continue;
            const pid = Number(m[1]);
            const args = m[2] || '';
            if (!Number.isFinite(pid) || pid <= 1) continue;
            if (!/chrom(e|ium)/i.test(args)) continue;

            const ud = args.match(/--user-data-dir(?:=|\s+)([^\s]+)/);
            if (!ud) continue;
            const userDataDir = ud[1];
            if (!userDataDir) continue;

            const resolved = path.resolve(userDataDir);
            if (resolved === root || resolved.startsWith(root + path.sep)) {
                pids.push(pid);
            }
        }
        return Array.from(new Set(pids));
    } catch {
        return [];
    }
};

const killChromiumUsingUserDataRoot = async (rootDir: string, reason: string) => {
    const pids = await listChromiumPidsByUserDataRoot(rootDir);
    if (pids.length === 0) return 0;
    let killed = 0;
    for (const pid of pids) {
        if (tryKillPid(pid, reason)) killed += 1;
    }
    return killed;
};

const scanAndClearSingletonArtifacts = async (rootDir: string, maxDepth = 4) => {
    const lockFileNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    const removedPaths: string[] = [];

    const walk = async (dir: string, depth: number) => {
        if (depth > maxDepth) return;
        let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        // If this directory looks like a Chromium user data dir, try to kill lock holder via SingletonCookie.
        const cookiePath = path.join(dir, 'SingletonCookie');
        const cookiePid = await readPidFromSingletonCookie(cookiePath);
        if (cookiePid) {
            tryKillPid(cookiePid, 'singleton_cookie_scan');
        }

        for (const lockFileName of lockFileNames) {
            const target = path.join(dir, lockFileName);
            const removed = await removeFileIfExists(target);
            if (removed) removedPaths.push(target);
        }

        // Also remove DevToolsActivePort left by crashed/aborted launches.
        const devToolsPort = path.join(dir, 'DevToolsActivePort');
        const removedPort = await removeFileIfExists(devToolsPort);
        if (removedPort) removedPaths.push(devToolsPort);

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            // Avoid wandering too far; only walk within session-ish trees.
            if (!entry.name.startsWith('session')) continue;
            await walk(path.join(dir, entry.name), depth + 1);
        }
    };

    await walk(rootDir, 0);
    return removedPaths;
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

    const removedPaths: string[] = [];

    // Backward-compatible: LocalAuth can create "session", "session-<id>", etc.
    // We scan `sessionDir` and session* children to clear Chromium singleton artifacts.
    const scanRemoved = await scanAndClearSingletonArtifacts(sessionDir, 5);
    removedPaths.push(...scanRemoved);

    // Also scan direct children (in case userDataDir is deeper than expected).
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith('session')) continue;
        const scanChildRemoved = await scanAndClearSingletonArtifacts(path.join(sessionDir, entry.name), 5);
        removedPaths.push(...scanChildRemoved);
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
        .catch(async (error) => {
            if (runId !== initializeRunId) {
                return;
            }

            clientStatus = 'ERROR';
            const err = error as any;
            const message = error instanceof Error ? error.message : String(error);
            const stack = error instanceof Error ? error.stack : '';
            lastInitializeError = [message, stack].filter(Boolean).join('\n');
            console.error('WhatsApp initialize error:', error);

            // If Chromium says profile is in use, it usually means an orphan Chromium process is still alive.
            const pid = extractPidFromMessage(message);
            if (pid) {
                tryKillPid(pid, 'chromium_profile_in_use');
            }
            if (/profile appears to be in use/i.test(message) || /process_singleton_posix\.cc/i.test(message)) {
                const killed = await killChromiumUsingUserDataRoot(getSessionDir(), 'chromium_profile_in_use_scan');
                if (killed > 0) {
                    console.warn(`[WA] killed ${killed} chromium process(es) holding WA profile`);
                }
                await clearChromiumProfileLocks();
            }

            if (persistStatusToDb) {
                try {
                    await Setting.upsert({
                        key: 'whatsapp_session',
                        value: {
                            status: 'ERROR',
                            error: lastInitializeError,
                            updatedAt: new Date()
                        },
                        description: 'WhatsApp Connection Status'
                    });
                } catch (persistError) {
                    console.error('[WA] failed to persist error status:', persistError);
                }
            }
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
    if (!persistStatusToDb) {
        return;
    }
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
    if (!persistStatusToDb) {
        return;
    }
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
