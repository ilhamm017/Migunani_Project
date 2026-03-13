import { Request, Response } from 'express';
import { StockOpnameService } from '../services/StockOpnameService';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

export const getAllOpnames = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const opnames = await StockOpnameService.getAllOpnames();
        return res.json(opnames);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        console.error('Error fetching opnames:', error);
        throw new CustomError('Internal server error', 500);
    }
});

export const getOpnameDetail = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const opname = await StockOpnameService.getOpnameDetail(id);

        if (!opname) throw new CustomError('Opname not found', 404);
        return res.json(opname);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        console.error('Error fetching opname detail:', error);
        throw new CustomError('Internal server error', 500);
    }
});

export const startOpname = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        const { notes } = req.body;

        const opname = await StockOpnameService.startOpname(userId, notes);
        return res.status(201).json(opname);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        console.error('Error starting opname:', error);
        throw new CustomError('Internal server error', 500);
    }
});

export const submitOpnameItem = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const { product_id, physical_qty } = req.body;

        const result = await StockOpnameService.submitOpnameItem(id, product_id, physical_qty);
        return res.json(result);
    } catch (error: any) {
        if (error instanceof CustomError) throw error;
        console.error('Error submitting opname item:', error);
        if (error.message === 'Opname not found or not open') {
            throw new CustomError(error.message, 400);
        }
        if (error.message === 'Product not found') {
            throw new CustomError(error.message, 404);
        }
        throw new CustomError('Internal server error', 500);
    }
});

export const finishOpname = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const userId = (req as any).user?.id;

        const opname = await StockOpnameService.finishOpname(id, userId);
        return res.json(opname);
    } catch (error: any) {
        if (error instanceof CustomError) throw error;
        console.error('Error finishing opname:', error);
        if (error.message === 'Opname not found or not open') {
            throw new CustomError(error.message, 400);
        }
        throw new CustomError('Internal server error', 500);
    }
});
