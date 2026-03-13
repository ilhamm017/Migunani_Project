import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { User, CustomerProfile, sequelize } from '../../models';
import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { getWhatsappLookupCandidates, normalizeWhatsappNumber } from '../../utils/whatsappNumber';
import { customerOtpMap, cleanupOtpSessions, normalizeTier, normalizeEmail, isValidEmail } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { sendWhatsappSafe } from '../../services/WhatsappSendService';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const MIN_CUSTOMER_PASSWORD_LENGTH = 6;

export const sendCustomerOtp = asyncWrapper(async (req: Request, res: Response) => {
    try {
        cleanupOtpSessions();

        const normalizedWhatsapp = normalizeWhatsappNumber(req.body?.whatsapp_number);
        if (!normalizedWhatsapp) {
            throw new CustomError('Nomor WhatsApp tidak valid', 400);
        }

        const actorId = String(req.user?.id || '').trim();
        if (!actorId) {
            throw new CustomError('Unauthorized', 401);
        }

        const existing = await User.findOne({
            where: { whatsapp_number: { [Op.in]: getWhatsappLookupCandidates(normalizedWhatsapp) } },
            attributes: ['id', 'role']
        });
        if (existing) {
            throw new CustomError('Nomor WhatsApp sudah terdaftar di sistem', 409);
        }

        const now = Date.now();
        const previous = customerOtpMap.get(normalizedWhatsapp);
        if (previous && previous.expiresAt > now && previous.resendAvailableAt > now) {
            throw new CustomError(
                `OTP baru saja dikirim. Coba lagi dalam ${Math.ceil((previous.resendAvailableAt - now) / 1000)} detik.`,
                429
            );
        }

        const otpCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const waMessage =
            `Kode verifikasi Migunani Motor: ${otpCode}\n` +
            `Kode ini berlaku 5 menit. Jangan berikan kode ini kepada siapa pun.`;
        const sendResult = await sendWhatsappSafe({
            target: normalizedWhatsapp,
            textBody: waMessage,
            requestContext: 'customer_otp_send'
        });
        if (sendResult.status === 'skipped_not_ready') {
            throw new CustomError('WhatsApp bot belum terhubung. Silakan connect WhatsApp terlebih dahulu.', 409);
        }
        if (sendResult.status !== 'sent') {
            throw new CustomError('Gagal mengirim OTP WhatsApp', 500);
        }

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
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Gagal mengirim OTP WhatsApp', 500);
    }
});

export const createCustomerByAdmin = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        cleanupOtpSessions();

        const actorId = String(req.user?.id || '').trim();
        if (!actorId) {
            await t.rollback();
            throw new CustomError('Unauthorized', 401);
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
            throw new CustomError('Nama customer wajib diisi', 400);
        }
        if (!normalizedWhatsapp) {
            await t.rollback();
            throw new CustomError('Nomor WhatsApp tidak valid', 400);
        }
        if (!email) {
            await t.rollback();
            throw new CustomError('Email wajib diisi', 400);
        }
        if (!isValidEmail(email)) {
            await t.rollback();
            throw new CustomError('Format email tidak valid', 400);
        }
        if (!password || password.length < MIN_CUSTOMER_PASSWORD_LENGTH) {
            await t.rollback();
            throw new CustomError(`Password minimal ${MIN_CUSTOMER_PASSWORD_LENGTH} karakter`, 400);
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
            throw new CustomError('Email atau nomor WhatsApp sudah terdaftar', 409);
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
        if (error instanceof CustomError) throw error;
        throw new CustomError('Gagal menambahkan customer', 500);
    }
});
