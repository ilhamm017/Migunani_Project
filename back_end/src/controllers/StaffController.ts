import { Request, Response } from 'express';
import { StaffService } from '../services/StaffService';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

export const getStaff = asyncWrapper(async (_req: Request, res: Response) => {
    try {
        const staff = await StaffService.getStaff();
        return res.json({ staff });
    } catch (error) {
        throw new CustomError('Gagal memuat data staf', 500);
    }
});

export const getStaffById = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const staff = await StaffService.getStaffById(req.params?.id);
        return res.json({ staff });
    } catch (error: any) {
        if (error.message === 'ID staf tidak valid') {
            throw new CustomError(error.message, 400);
        }
        if (error.message === 'Staf tidak ditemukan') {
            throw new CustomError(error.message, 404);
        }
        throw new CustomError('Gagal memuat detail staf', 500);
    }
});

export const createStaff = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const staff = await StaffService.createStaff(req.body);
        return res.status(201).json({
            message: 'Staf berhasil ditambahkan',
            staff
        });
    } catch (error: any) {
        if (error.message === 'Email atau nomor WhatsApp sudah dipakai user lain') {
            throw new CustomError(error.message, 409);
        }
        if (error.message && !error.message.includes('Gagal')) {
            throw new CustomError(error.message, 400);
        }
        throw new CustomError('Gagal menambahkan staf', 500);
    }
});

export const updateStaff = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const staff = await StaffService.updateStaff(req.params?.id, req.body);
        return res.json({
            message: 'Staf berhasil diperbarui',
            staff
        });
    } catch (error: any) {
        if (error.message === 'Email atau nomor WhatsApp sudah dipakai user lain') {
            throw new CustomError(error.message, 409);
        }
        if (error.message === 'Staf tidak ditemukan') {
            throw new CustomError(error.message, 404);
        }
        if (error.message && !error.message.includes('Gagal')) {
            throw new CustomError(error.message, 400);
        }
        throw new CustomError('Gagal update staf', 500);
    }
});

export const deactivateStaff = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const result = await StaffService.deactivateStaff(req.params?.id);
        return res.json(result);
    } catch (error: any) {
        if (error.message === 'ID staf tidak valid' || error.message === 'User ini bukan staf operasional') {
            throw new CustomError(error.message, 400);
        }
        if (error.message === 'Staf tidak ditemukan') {
            throw new CustomError(error.message, 404);
        }
        throw new CustomError('Gagal menonaktifkan staf', 500);
    }
});

