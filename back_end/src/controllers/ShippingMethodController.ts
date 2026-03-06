import { Request, Response } from 'express';
import { ShippingMethodService } from '../services/ShippingMethodService';

export const getShippingMethods = async (req: Request, res: Response) => {
    try {
        const activeOnly = String(req.query.active_only || '').trim() === 'true';
        const rows = await ShippingMethodService.getShippingMethods(activeOnly);
        return res.json({ shipping_methods: rows });
    } catch (error) {
        return res.status(500).json({ message: 'Gagal memuat metode pengiriman', error });
    }
};

export const createShippingMethod = async (req: Request, res: Response) => {
    try {
        const saved = await ShippingMethodService.createShippingMethod(req.body);
        return res.status(201).json({
            message: 'Metode pengiriman berhasil ditambahkan.',
            shipping_methods: saved
        });
    } catch (error: any) {
        if (error.message && !error.message.includes('Gagal')) {
            if (error.message.includes('sudah digunakan')) {
                return res.status(409).json({ message: error.message });
            }
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal menambahkan metode pengiriman', error });
    }
};

export const updateShippingMethod = async (req: Request, res: Response) => {
    try {
        const saved = await ShippingMethodService.updateShippingMethod(req.params.code as string, req.body);
        return res.json({
            message: 'Metode pengiriman berhasil diperbarui.',
            shipping_methods: saved
        });
    } catch (error: any) {
        if (error.message === 'Metode pengiriman tidak ditemukan.') {
            return res.status(404).json({ message: error.message });
        }
        if (error.message && !error.message.includes('Gagal')) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal memperbarui metode pengiriman', error });
    }
};

export const removeShippingMethod = async (req: Request, res: Response) => {
    try {
        const saved = await ShippingMethodService.removeShippingMethod(req.params.code as string);
        return res.json({
            message: 'Metode pengiriman berhasil dihapus.',
            shipping_methods: saved
        });
    } catch (error: any) {
        if (error.message === 'Metode pengiriman tidak ditemukan.') {
            return res.status(404).json({ message: error.message });
        }
        if (error.message && !error.message.includes('Gagal')) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal menghapus metode pengiriman', error });
    }
};

export const resolveShippingMethodByCode = async (codeRaw: unknown) => {
    return ShippingMethodService.resolveShippingMethodByCode(codeRaw);
};

