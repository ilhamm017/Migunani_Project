import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { User, CustomerProfile, sequelize } from '../../models';
import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import waClient, { getStatus as getWhatsappStatus } from '../../services/whatsappClient';
import { getWhatsappLookupCandidates, normalizeWhatsappNumber } from '../../utils/whatsappNumber';
import { customerOtpMap, cleanupOtpSessions, normalizeTier, normalizeEmail, isValidEmail } from './utils';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const MIN_CUSTOMER_PASSWORD_LENGTH = 6;

export const sendCustomerOtp = async (req: Request, res: Response) => {
    try {
        cleanupOtpSessions();

        const normalizedWhatsapp = normalizeWhatsappNumber(req.body?.whatsapp_number);
        if (!normalizedWhatsapp) {
            return res.status(400).json({ message: 'Nomor WhatsApp tidak valid' });
        }

        const actorId = String(req.user?.id || '').trim();
        if (!actorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const existing = await User.findOne({
            where: { whatsapp_number: { [Op.in]: getWhatsappLookupCandidates(normalizedWhatsapp) } },
            attributes: ['id', 'role']
        });
        if (existing) {
            return res.status(409).json({ message: 'Nomor WhatsApp sudah terdaftar di sistem' });
        }

        const waStatus = getWhatsappStatus();
        if (waStatus !== 'READY') {
            return res.status(409).json({ message: 'WhatsApp bot belum terhubung. Silakan connect WhatsApp terlebih dahulu.' });
        }

        const now = Date.now();
        const previous = customerOtpMap.get(normalizedWhatsapp);
        if (previous && previous.expiresAt > now && previous.resendAvailableAt > now) {
            return res.status(429).json({
                message: 'OTP baru saja dikirim. Coba lagi sebentar.',
                retry_after_sec: Math.ceil((previous.resendAvailableAt - now) / 1000)
            });
        }

        const otpCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const waMessage =
            `Kode verifikasi Migunani Motor: ${otpCode}\n` +
            `Kode ini berlaku 5 menit. Jangan berikan kode ini kepada siapa pun.`;

        await waClient.sendMessage(`${normalizedWhatsapp}@c.us`, waMessage);

        customerOtpMap.set(normalizedWhatsapp, {
            code: otpCode,
            expiresAt: now + OTP_TTL_MS,
            resendAvailableAt: now + OTP_RESEND_COOLDOWN_MS,
            requestedBy: actorId,
            attempts: 0,
        });

        res.json({
            message: 'Kode OTP berhasil dikirim ke WhatsApp customer',
            expires_in_sec: Math.ceil(OTP_TTL_MS / 1000),
            resend_in_sec: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
        });
    } catch (error: any) {
        res.status(500).json({
            message: error?.message || 'Gagal mengirim OTP WhatsApp'
        });
    }
};

export const createCustomerByAdmin = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        cleanupOtpSessions();

        const actorId = String(req.user?.id || '').trim();
        if (!actorId) {
            await t.rollback();
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const normalizedWhatsapp = normalizeWhatsappNumber(req.body?.whatsapp_number);
        const otpCode = typeof req.body?.otp_code === 'string' ? req.body.otp_code.trim() : '';
        const email = normalizeEmail(req.body?.email);
        const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
        const tier = normalizeTier(req.body?.tier);
        const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';

        if (!name) {
            await t.rollback();
            return res.status(400).json({ message: 'Nama customer wajib diisi' });
        }
        if (!normalizedWhatsapp) {
            await t.rollback();
            return res.status(400).json({ message: 'Nomor WhatsApp tidak valid' });
        }
        if (!email) {
            await t.rollback();
            return res.status(400).json({ message: 'Email wajib diisi' });
        }
        if (!isValidEmail(email)) {
            await t.rollback();
            return res.status(400).json({ message: 'Format email tidak valid' });
        }
        if (!password || password.length < MIN_CUSTOMER_PASSWORD_LENGTH) {
            await t.rollback();
            return res.status(400).json({ message: `Password minimal ${MIN_CUSTOMER_PASSWORD_LENGTH} karakter` });
        }

        const whatsappCandidates = getWhatsappLookupCandidates(normalizedWhatsapp);
        const conflictConditions: Array<Record<string, unknown>> = [
            { whatsapp_number: { [Op.in]: whatsappCandidates } }
        ];
        if (email) {
            conflictConditions.push({ email });
        }

        const existing = await User.findOne({
            where: { [Op.or]: conflictConditions },
            transaction: t
        });
        if (existing) {
            await t.rollback();
            return res.status(409).json({ message: 'Email atau nomor WhatsApp sudah terdaftar' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            whatsapp_number: normalizedWhatsapp,
            role: 'customer',
            status: 'active',
            debt: 0
        }, { transaction: t });

        const saved_addresses = address ? [{
            label: 'Rumah Utama',
            address,
            isPrimary: true
        }] : [];

        await CustomerProfile.create({
            user_id: user.id,
            tier,
            credit_limit: 0,
            points: 0,
            saved_addresses
        }, { transaction: t });

        await t.commit();
        customerOtpMap.delete(normalizedWhatsapp);

        res.status(201).json({
            message: 'Customer berhasil ditambahkan',
            customer: {
                id: user.id,
                name: user.name,
                email: user.email,
                whatsapp_number: user.whatsapp_number,
                status: user.status,
                role: user.role,
                CustomerProfile: {
                    tier,
                    credit_limit: 0,
                    points: 0,
                }
            }
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Gagal menambahkan customer', error });
    }
};
