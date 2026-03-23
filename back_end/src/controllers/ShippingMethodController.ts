import { Request, Response } from 'express';
import { ShippingMethodService } from '../services/ShippingMethodService';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

export const getShippingMethods = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const activeOnly = String(req.query.active_only || '').trim() === 'true';
        const rows = await ShippingMethodService.getShippingMethods(activeOnly);
        return res.json({ shipping_methods: rows });
    } catch (error) {
        throw new CustomError('Gagal memuat metode pengiriman', 500);
    }
});

export const getPublicShippingMethods = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const raw = String(req.query.active_only ?? '').trim();
        const activeOnly = raw ? raw === 'true' : true;
        const rows = await ShippingMethodService.getShippingMethods(activeOnly);
        return res.json({ shipping_methods: rows });
    } catch (error) {
        throw new CustomError('Gagal memuat metode pengiriman', 500);
    }
});

export const createShippingMethod = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const saved = await ShippingMethodService.createShippingMethod(req.body);
        return res.status(201).json({
            message: 'Metode pengiriman berhasil ditambahkan.',
            shipping_methods: saved
        });
    } catch (error: any) {
        if (error.message && !error.message.includes('Gagal')) {
            if (error.message.includes('sudah digunakan')) {
                throw new CustomError(error.message, 409);
            }
            throw new CustomError(error.message, 400);
        }
        throw new CustomError('Gagal menambahkan metode pengiriman', 500);
    }
});

export const updateShippingMethod = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const saved = await ShippingMethodService.updateShippingMethod(req.params.code as string, req.body);
        return res.json({
            message: 'Metode pengiriman berhasil diperbarui.',
            shipping_methods: saved
        });
    } catch (error: any) {
        if (error.message === 'Metode pengiriman tidak ditemukan.') {
            throw new CustomError(error.message, 404);
        }
        if (error.message && !error.message.includes('Gagal')) {
            throw new CustomError(error.message, 400);
        }
        throw new CustomError('Gagal memperbarui metode pengiriman', 500);
    }
});

export const removeShippingMethod = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const saved = await ShippingMethodService.removeShippingMethod(req.params.code as string);
        return res.json({
            message: 'Metode pengiriman berhasil dihapus.',
            shipping_methods: saved
        });
    } catch (error: any) {
        if (error.message === 'Metode pengiriman tidak ditemukan.') {
            throw new CustomError(error.message, 404);
        }
        if (error.message && !error.message.includes('Gagal')) {
            throw new CustomError(error.message, 400);
        }
        throw new CustomError('Gagal menghapus metode pengiriman', 500);
    }
});

export const resolveShippingMethodByCode = async (codeRaw: unknown) => {
    return ShippingMethodService.resolveShippingMethodByCode(codeRaw);
};
