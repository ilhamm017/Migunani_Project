import { Request, Response } from 'express';
import { ReturService } from '../services/ReturService';

// --- Customer Endpoints ---

export const requestRetur = async (req: Request, res: Response) => {
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
        if (error.message && !error.message.includes('Error')) {
            if (error.message === 'Order not found') {
                return res.status(404).json({ message: error.message });
            }
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Error submitting return request', error });
    }
};

export const getMyReturs = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const returs = await ReturService.getMyReturs(userId);
        return res.json(returs);
    } catch (error) {
        return res.status(500).json({ message: 'Error fetching returns', error });
    }
};

// --- Admin Endpoints ---

export const getAllReturs = async (req: Request, res: Response) => {
    try {
        const status = req.query.status as string | undefined;
        const returs = await ReturService.getAllReturs(status);
        return res.json(returs);
    } catch (error) {
        return res.status(500).json({ message: 'Error fetching returns', error });
    }
};

export const updateReturStatus = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const user = { id: req.user!.id, role: req.user!.role };

        const { retur, nextStatus } = await ReturService.updateReturStatus(id, req.body, user);
        return res.json({ message: `Retur status updated to ${nextStatus}`, retur });
    } catch (error: any) {
        if (error.message && !error.message.includes('Error')) {
            if (error.message === 'Retur request not found') {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('Hanya Kasir atau Super Admin')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('Transisi status tidak diizinkan')) {
                return res.status(409).json({ message: error.message });
            }
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Error updating return status', error });
    }
};

// --- Finance Endpoints ---

export const disburseRefund = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const { note } = req.body;
        const user = { id: req.user!.id, role: req.user!.role };

        const retur = await ReturService.disburseRefund(id, note, user);
        return res.json({ message: 'Dana refund berhasil dicairkan dan tercatat di pengeluaran', retur });
    } catch (error: any) {
        if (error.message && !error.message.includes('Error')) {
            if (error.message === 'Retur request not found') {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('Hanya Admin Finance atau Super Admin')) {
                return res.status(403).json({ message: error.message });
            }
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Error disbursing refund', error });
    }
};

