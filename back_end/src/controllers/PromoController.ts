import { Request, Response } from 'express';
import { Setting } from '../models';

const DISCOUNT_VOUCHERS_SETTING_KEY = 'discount_vouchers';

export const validatePromo = async (req: Request, res: Response) => {
    try {
        const { code } = req.params;
        if (!code) {
            return res.status(400).json({ message: 'Kode promo wajib diisi' });
        }

        const normalizedCode = String(code).trim().toUpperCase();
        const settings = await Setting.findByPk(DISCOUNT_VOUCHERS_SETTING_KEY);
        const vouchers = Array.isArray(settings?.value) ? settings.value : [];

        const voucher = vouchers.find((v: any) => v.code === normalizedCode);

        if (!voucher) {
            return res.status(404).json({ message: 'Kode promo tidak valid' });
        }

        if (!voucher.is_active) {
            return res.status(400).json({ message: 'Kode promo sudah tidak aktif' });
        }

        const now = new Date();
        const startsAt = new Date(voucher.starts_at);
        const expiresAt = new Date(voucher.expires_at);

        if (now < startsAt) {
            return res.status(400).json({ message: 'Kode promo belum bisa digunakan' });
        }

        if (now > expiresAt) {
            return res.status(400).json({ message: 'Kode promo sudah kedaluwarsa' });
        }

        if (voucher.usage_count >= voucher.usage_limit) {
            return res.status(400).json({ message: 'Kuota kode promo sudah habis' });
        }

        res.json({
            message: 'Kode promo valid',
            promo: {
                code: voucher.code,
                discount_pct: voucher.discount_pct,
                max_discount_rupiah: voucher.max_discount_rupiah
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error validating promo', error });
    }
};
