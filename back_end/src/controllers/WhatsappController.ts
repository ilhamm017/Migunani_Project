import { Request, Response } from 'express';
import { getQr, getStatus, startWhatsappClient } from '../services/whatsappClient';
import waClient from '../services/whatsappClient';

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

    if (status === 'STOPPED') {
        return res.status(200).json({
            status,
            message: 'WhatsApp belum dijalankan. Klik Connect WhatsApp terlebih dahulu.',
            qr: null
        });
    }

    // If connected, no QR needed
    if (status === 'READY') {
        return res.status(200).json({ status: 'CONNECTED', message: 'Client is ready', qr: null });
    }

    if (!qr) {
        return res.status(200).json({ status: status, message: 'Waiting for QR code generation...', qr: null });
    }

    res.json({ status: 'SCAN_NEEDED', qr });
};

import { Setting } from '../models';

export const getClientStatus = async (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    const status = getStatus();
    let info = null;

    if (status === 'READY') {
        info = waClient.info;
    } else {
        // Fetch last known info from DB
        const setting = await Setting.findByPk('whatsapp_session');
        if (setting) {
            info = setting.value;
        }
    }

    res.json({ status, info });
};

export const logout = async (req: Request, res: Response) => {
    try {
        await waClient.logout();
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error logging out', error });
    }
};

export const connect = async (req: Request, res: Response) => {
    try {
        const force = req.body?.force === true || req.body?.force === 'true';
        const result = await startWhatsappClient({ force });
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error starting WhatsApp client', error });
    }
};
