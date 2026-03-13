import { Request, Response } from 'express';
import { DiscountVoucherService } from '../services/DiscountVoucherService';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

export const getDiscountVouchers = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const activeOnly = String(req.query.active_only || '').trim() === 'true';
        const availableOnly = String(req.query.available_only || '').trim() === 'true';

        const payload = await DiscountVoucherService.getDiscountVouchers(activeOnly, availableOnly);
        return res.json({ discount_vouchers: payload });
    } catch (error) {
        throw new CustomError('Gagal memuat voucher diskon', 500);
    }
});

export const createDiscountVoucher = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const saved = await DiscountVoucherService.createDiscountVoucher(req.body);
        return res.status(201).json({
            message: 'Voucher diskon berhasil ditambahkan.',
            discount_vouchers: saved
        });
    } catch (error: any) {
        if (error.message && !error.message.includes('Gagal')) {
            throw new CustomError(error.message, 400);
        }
        throw new CustomError('Gagal menambahkan voucher diskon', 500);
    }
});

export const updateDiscountVoucher = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const saved = await DiscountVoucherService.updateDiscountVoucher(req.params.code as string, req.body);
        return res.json({
            message: 'Voucher diskon berhasil diperbarui.',
            discount_vouchers: saved
        });
    } catch (error: any) {
        if (error.message === 'Voucher diskon tidak ditemukan.') {
            throw new CustomError(error.message, 404);
        }
        if (error.message && !error.message.includes('Gagal')) {
            throw new CustomError(error.message, 400);
        }
        throw new CustomError('Gagal memperbarui voucher diskon', 500);
    }
});

export const removeDiscountVoucher = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const saved = await DiscountVoucherService.removeDiscountVoucher(req.params.code as string);
        return res.json({
            message: 'Voucher diskon berhasil dihapus.',
            discount_vouchers: saved
        });
    } catch (error: any) {
        if (error.message === 'Voucher diskon tidak ditemukan.') {
            throw new CustomError(error.message, 404);
        }
        if (error.message && !error.message.includes('Gagal')) {
            throw new CustomError(error.message, 400);
        }
        throw new CustomError('Gagal menghapus voucher diskon', 500);
    }
});
