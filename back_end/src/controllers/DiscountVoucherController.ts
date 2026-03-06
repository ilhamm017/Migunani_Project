import { Request, Response } from 'express';
import { DiscountVoucherService } from '../services/DiscountVoucherService';

export const getDiscountVouchers = async (req: Request, res: Response) => {
    try {
        const activeOnly = String(req.query.active_only || '').trim() === 'true';
        const availableOnly = String(req.query.available_only || '').trim() === 'true';

        const payload = await DiscountVoucherService.getDiscountVouchers(activeOnly, availableOnly);
        return res.json({ discount_vouchers: payload });
    } catch (error) {
        return res.status(500).json({ message: 'Gagal memuat voucher diskon', error });
    }
};

export const createDiscountVoucher = async (req: Request, res: Response) => {
    try {
        const saved = await DiscountVoucherService.createDiscountVoucher(req.body);
        return res.status(201).json({
            message: 'Voucher diskon berhasil ditambahkan.',
            discount_vouchers: saved
        });
    } catch (error: any) {
        if (error.message && !error.message.includes('Gagal')) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal menambahkan voucher diskon', error });
    }
};

export const updateDiscountVoucher = async (req: Request, res: Response) => {
    try {
        const saved = await DiscountVoucherService.updateDiscountVoucher(req.params.code as string, req.body);
        return res.json({
            message: 'Voucher diskon berhasil diperbarui.',
            discount_vouchers: saved
        });
    } catch (error: any) {
        if (error.message === 'Voucher diskon tidak ditemukan.') {
            return res.status(404).json({ message: error.message });
        }
        if (error.message && !error.message.includes('Gagal')) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal memperbarui voucher diskon', error });
    }
};

export const removeDiscountVoucher = async (req: Request, res: Response) => {
    try {
        const saved = await DiscountVoucherService.removeDiscountVoucher(req.params.code as string);
        return res.json({
            message: 'Voucher diskon berhasil dihapus.',
            discount_vouchers: saved
        });
    } catch (error: any) {
        if (error.message === 'Voucher diskon tidak ditemukan.') {
            return res.status(404).json({ message: error.message });
        }
        if (error.message && !error.message.includes('Gagal')) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal menghapus voucher diskon', error });
    }
};
