import { Request, Response } from 'express';
import { Product, Setting } from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

const DISCOUNT_VOUCHERS_SETTING_KEY = 'discount_vouchers';

export const validatePromo = asyncWrapper(async (req: Request, res: Response) => {
    const { code } = req.params;
    if (!code) {
        throw new CustomError('Kode promo wajib diisi', 400);
    }

    const normalizedCode = String(code).trim().toUpperCase();
    const settings = await Setting.findByPk(DISCOUNT_VOUCHERS_SETTING_KEY);
    const vouchers = Array.isArray(settings?.value) ? settings.value : [];

    const voucher = vouchers.find((v: any) => v.code === normalizedCode);

    if (!voucher) {
        throw new CustomError('Kode promo tidak valid', 404);
    }

    if (!voucher.is_active) {
        throw new CustomError('Kode promo sudah tidak aktif', 400);
    }

    const now = new Date();
    const startsAt = new Date(voucher.starts_at);
    const expiresAt = new Date(voucher.expires_at);

    if (now < startsAt) {
        throw new CustomError('Kode promo belum bisa digunakan', 400);
    }

    if (now > expiresAt) {
        throw new CustomError('Kode promo sudah kedaluwarsa', 400);
    }

    if (voucher.usage_count >= voucher.usage_limit) {
        throw new CustomError('Kuota kode promo sudah habis', 400);
    }

    const productId = typeof voucher.product_id === 'string' ? voucher.product_id.trim() : '';
    if (!productId) {
        throw new CustomError('Kode promo tidak valid untuk produk.', 400);
    }

    const product = await Product.findByPk(productId, { attributes: ['id', 'name', 'sku'] });
    if (!product) {
        throw new CustomError('Produk voucher tidak ditemukan', 404);
    }

    res.json({
        message: 'Kode promo valid',
        promo: {
            code: voucher.code,
            discount_pct: voucher.discount_pct,
            max_discount_rupiah: voucher.max_discount_rupiah,
            product_id: productId,
            product_name: product.name,
            product_sku: product.sku
        }
    });
});
