import { Request, Response } from 'express';
import { User, CustomerProfile } from '../models';
import { CustomerBalanceService } from '../services/CustomerBalanceService';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

export const getMe = asyncWrapper(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
        throw new CustomError('Unauthorized', 401);
    }

    const user = await User.findByPk(userId, {
        attributes: ['id', 'name', 'email', 'whatsapp_number', 'role', 'status'],
        include: [
            {
                model: CustomerProfile,
                attributes: ['tier', 'credit_limit', 'points', 'saved_addresses']
            }
        ]
    });

    if (!user) {
        throw new CustomError('User not found', 404);
    }

    res.json({ user });
});

export const updateAddresses = asyncWrapper(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
        throw new CustomError('Unauthorized', 401);
    }

    const { saved_addresses } = req.body;
    if (!Array.isArray(saved_addresses)) {
        throw new CustomError('Invalid addresses format', 400);
    }

    const profile = await CustomerProfile.findOne({ where: { user_id: userId } });
    if (!profile) {
        throw new CustomError('Customer profile not found', 404);
    }

    await profile.update({ saved_addresses });

    res.json({ message: 'Addresses updated successfully', saved_addresses });
});

export const getBalance = asyncWrapper(async (req: Request, res: Response) => {
    const userId = String(req.user?.id || '').trim();
    if (!userId) {
        throw new CustomError('Unauthorized', 401);
    }

    const user = await User.findByPk(userId, {
        attributes: ['id', 'role']
    });
    if (!user) {
        throw new CustomError('User not found', 404);
    }
    if (String((user as any).role || '') !== 'customer') {
        throw new CustomError('Hanya customer yang memiliki saldo', 403);
    }

    const summary = await CustomerBalanceService.getSummary(userId);
    const list = await CustomerBalanceService.listEntries(userId, { limit: 20, offset: 0 });

    res.json({
        as_of: new Date().toISOString(),
        ...summary,
        entries: list.entries,
    });
});
