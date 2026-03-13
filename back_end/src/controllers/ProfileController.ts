import { Request, Response } from 'express';
import { User, CustomerProfile } from '../models';
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
