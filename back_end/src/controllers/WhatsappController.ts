import { Request, Response } from 'express';
import { getQr, getStatus, getWhatsappDiagnostics, startWhatsappClient } from '../services/whatsappClient';
import waClient from '../services/whatsappClient';
import {
    createScrapeSession,
    getScrapeCustomerDetail,
    getScrapeMedia as loadScrapeMedia,
    getScrapeSessionSummary,
    getScrapeSessionMessages,
    listWhatsappGroups,
} from '../services/WhatsappScrapeService';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

const setNoCacheHeaders = (res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
};

export const getQrCode = (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    const qr = getQr();
    const status = getStatus();
    const meta = getWhatsappDiagnostics();

    // If QR is available, always return it even when status races during init.
    if (qr) {
        return res.status(200).json({ status: 'SCAN_NEEDED', qr, meta });
    }

    if (status === 'STOPPED') {
        return res.status(200).json({
            status,
            message: 'WhatsApp belum dijalankan. Klik Connect WhatsApp terlebih dahulu.',
            qr: null,
            meta
        });
    }

    // If connected, no QR needed
    if (status === 'READY') {
        return res.status(200).json({ status: 'CONNECTED', message: 'Client is ready', qr: null, meta });
    }

    res.status(200).json({ status, message: 'Waiting for QR code generation...', qr: null, meta });
};

import { Setting } from '../models';

const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    let timer: NodeJS.Timeout | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), ms);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

export const getClientStatus = asyncWrapper(async (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    const status = getStatus();
    const meta = getWhatsappDiagnostics();
    let info = null;

    if (status === 'READY') {
        info = waClient.info;
    } else {
        // Fetch last known info from DB
        try {
            const setting = await withTimeout(Setting.findByPk('whatsapp_session'), 1500);
            if (setting) {
                info = setting.value;
            }
        } catch {
            // DB is slow/unavailable; keep endpoint responsive.
            info = null;
        }
    }

    res.json({ status, info, meta });
});

const ensureWaReady = () => {
    const status = getStatus();
    if (status !== 'READY') {
        throw new CustomError(
            `WhatsApp belum ready (status=${status}). Pastikan sudah connect dan tidak sedang QR/auth.`,
            409
        );
    }
};

const ensureScrapeEnabled = () => {
    const enabled = String(process.env.WA_SCRAPE_ENABLED || '').trim().toLowerCase() === 'true';
    if (!enabled) {
        // Hide feature when disabled.
        throw new CustomError('Not Found', 404);
    }
};

export const listGroups = asyncWrapper(async (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    ensureScrapeEnabled();
    ensureWaReady();

    const groups = await listWhatsappGroups();
    res.json({ groups });
});

export const scrapeCreateSession = asyncWrapper(async (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    ensureScrapeEnabled();
    ensureWaReady();

    const payload = await createScrapeSession({
        group_id: req.body?.group_id,
        date_from: req.body?.date_from,
        date_to: req.body?.date_to,
        timezone: req.body?.timezone,
        message_limit: req.body?.message_limit,
    });

    res.json(payload);
});

export const scrapeGetSession = asyncWrapper(async (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    ensureScrapeEnabled();
    ensureWaReady();
    const sessionId = String(req.params?.sessionId || '').trim();
    res.json(getScrapeSessionSummary(sessionId));
});

export const scrapeGetMessages = asyncWrapper(async (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    ensureScrapeEnabled();
    ensureWaReady();
    const sessionId = String(req.params?.sessionId || '').trim();
    res.json(getScrapeSessionMessages(sessionId));
});

export const scrapeGetCustomer = asyncWrapper(async (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    ensureScrapeEnabled();
    ensureWaReady();
    const sessionId = String(req.params?.sessionId || '').trim();
    const customerKey = String(req.params?.customerKey || '').trim();
    res.json(getScrapeCustomerDetail(sessionId, customerKey));
});

export const scrapeGetMedia = asyncWrapper(async (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    ensureScrapeEnabled();
    ensureWaReady();
    const sessionId = String(req.params?.sessionId || '').trim();
    const messageId = String(req.params?.messageId || '').trim();
    const media = await loadScrapeMedia(sessionId, messageId);
    res.setHeader('Content-Type', media.mimetype);
    res.setHeader('Cache-Control', 'no-store');
    res.send(media.buffer);
});

export const logout = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const status = getStatus();
        if (status === 'STOPPED') {
            throw new CustomError('WhatsApp belum dijalankan.', 409);
        }
        await waClient.logout();
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error logging out', 500);
    }
});

export const connect = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const force = req.body?.force === true;
        const result = await startWhatsappClient({ force });
        res.json(result);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error starting WhatsApp client', 500);
    }
});
