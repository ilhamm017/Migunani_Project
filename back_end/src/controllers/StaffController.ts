import { Request, Response } from 'express';
import { StaffService } from '../services/StaffService';

export const getStaff = async (_req: Request, res: Response) => {
    try {
        const staff = await StaffService.getStaff();
        return res.json({ staff });
    } catch (error) {
        return res.status(500).json({ message: 'Gagal memuat data staf', error });
    }
};

export const getStaffById = async (req: Request, res: Response) => {
    try {
        const staff = await StaffService.getStaffById(req.params?.id);
        return res.json({ staff });
    } catch (error: any) {
        if (error.message === 'ID staf tidak valid') {
            return res.status(400).json({ message: error.message });
        }
        if (error.message === 'Staf tidak ditemukan') {
            return res.status(404).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal memuat detail staf', error });
    }
};

export const createStaff = async (req: Request, res: Response) => {
    try {
        const staff = await StaffService.createStaff(req.body);
        return res.status(201).json({
            message: 'Staf berhasil ditambahkan',
            staff
        });
    } catch (error: any) {
        if (error.message === 'Email atau nomor WhatsApp sudah dipakai user lain') {
            return res.status(409).json({ message: error.message });
        }
        if (error.message && !error.message.includes('Gagal')) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal menambahkan staf', error });
    }
};

export const updateStaff = async (req: Request, res: Response) => {
    try {
        const staff = await StaffService.updateStaff(req.params?.id, req.body);
        return res.json({
            message: 'Staf berhasil diperbarui',
            staff
        });
    } catch (error: any) {
        if (error.message === 'Email atau nomor WhatsApp sudah dipakai user lain') {
            return res.status(409).json({ message: error.message });
        }
        if (error.message === 'Staf tidak ditemukan') {
            return res.status(404).json({ message: error.message });
        }
        if (error.message && !error.message.includes('Gagal')) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal update staf', error });
    }
};

export const deactivateStaff = async (req: Request, res: Response) => {
    try {
        const result = await StaffService.deactivateStaff(req.params?.id);
        return res.json(result);
    } catch (error: any) {
        if (error.message === 'ID staf tidak valid' || error.message === 'User ini bukan staf operasional') {
            return res.status(400).json({ message: error.message });
        }
        if (error.message === 'Staf tidak ditemukan') {
            return res.status(404).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Gagal menonaktifkan staf', error });
    }
};

