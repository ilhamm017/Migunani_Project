import { Request, Response } from 'express';
import { ReturService } from '../services/ReturService';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

// --- Customer Endpoints ---

export const requestRetur = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const userRole = req.user!.role;
        const { order_id, product_id, qty, reason } = req.body;
        const file = req.file;

        await ReturService.requestRetur({
            userId,
            order_id,
            product_id,
            qty,
            reason,
            filePath: file ? file.path : undefined,
            userRole,
        });

        return res.status(201).json({ message: 'Return request submitted successfully' });
    } catch (error: any) {
        if (error instanceof CustomError) {
            throw error;
        }
        const message = typeof error?.message === 'string' ? error.message : '';
        if (message && !message.includes('Error')) {
            if (message === 'Order not found') {
                throw new CustomError(message, 404);
            }
            throw new CustomError(message, 400);
        }
        throw new CustomError('Error submitting return request', 500);
    }
});

export const getMyReturs = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const returs = await ReturService.getMyReturs(userId);
        return res.json(returs);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching returns', 500);
    }
});

// --- Admin Endpoints ---

export const getAllReturs = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const status = req.query.status as string | undefined;
        const returs = await ReturService.getAllReturs(status);
        return res.json(returs);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching returns', 500);
    }
});

export const updateReturStatus = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const user = { id: req.user!.id, role: req.user!.role };

        const { retur, nextStatus } = await ReturService.updateReturStatus(id, req.body, user);
        return res.json({ message: `Retur status updated to ${nextStatus}`, retur });
    } catch (error: any) {
        if (error instanceof CustomError) {
            throw error;
        }
        const message = typeof error?.message === 'string' ? error.message : '';
        if (message && !message.includes('Error')) {
            if (message === 'Retur request not found') {
                throw new CustomError(message, 404);
            }
            if (message.includes('Hanya Kasir atau Super Admin')) {
                throw new CustomError(message, 403);
            }
            if (message.includes('Transisi status tidak diizinkan')) {
                throw new CustomError(message, 409);
            }
            throw new CustomError(message, 400);
        }
        throw new CustomError('Error updating return status', 500);
    }
});

// --- Finance Endpoints ---

export const disburseRefund = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const { note } = req.body;
        const user = { id: req.user!.id, role: req.user!.role };

        const retur = await ReturService.disburseRefund(id, note, user);
        return res.json({ message: 'Dana refund berhasil dicairkan dan tercatat di pengeluaran', retur });
    } catch (error: any) {
        if (error instanceof CustomError) {
            throw error;
        }
        const message = typeof error?.message === 'string' ? error.message : '';
        if (message && !message.includes('Error')) {
            if (message === 'Retur request not found') {
                throw new CustomError(message, 404);
            }
            if (message.includes('Hanya Admin Finance atau Super Admin')) {
                throw new CustomError(message, 403);
            }
            throw new CustomError(message, 400);
        }
        throw new CustomError('Error disbursing refund', 500);
    }
});
