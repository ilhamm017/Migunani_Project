import { Request, Response } from 'express';
import { StockOpnameService } from '../services/StockOpnameService';

export const getAllOpnames = async (req: Request, res: Response) => {
    try {
        const opnames = await StockOpnameService.getAllOpnames();
        return res.json(opnames);
    } catch (error) {
        console.error('Error fetching opnames:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getOpnameDetail = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const opname = await StockOpnameService.getOpnameDetail(id);

        if (!opname) return res.status(404).json({ message: 'Opname not found' });
        return res.json(opname);
    } catch (error) {
        console.error('Error fetching opname detail:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const startOpname = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        const { notes } = req.body;

        const opname = await StockOpnameService.startOpname(userId, notes);
        return res.status(201).json(opname);
    } catch (error) {
        console.error('Error starting opname:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const submitOpnameItem = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const { product_id, physical_qty } = req.body;

        const result = await StockOpnameService.submitOpnameItem(id, product_id, physical_qty);
        return res.json(result);
    } catch (error: any) {
        console.error('Error submitting opname item:', error);
        if (error.message === 'Opname not found or not open') {
            return res.status(400).json({ message: error.message });
        }
        if (error.message === 'Product not found') {
            return res.status(404).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const finishOpname = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const userId = (req as any).user?.id;

        const opname = await StockOpnameService.finishOpname(id, userId);
        return res.json(opname);
    } catch (error: any) {
        console.error('Error finishing opname:', error);
        if (error.message === 'Opname not found or not open') {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'Internal server error' });
    }
};

