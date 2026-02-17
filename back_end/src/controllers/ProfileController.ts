import { Request, Response } from 'express';
import { User, CustomerProfile } from '../models';

export const getMe = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
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
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching profile', error });
    }
};

export const updateAddresses = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { saved_addresses } = req.body;
        if (!Array.isArray(saved_addresses)) {
            return res.status(400).json({ message: 'Invalid addresses format' });
        }

        const profile = await CustomerProfile.findOne({ where: { user_id: userId } });
        if (!profile) {
            return res.status(404).json({ message: 'Customer profile not found' });
        }

        await profile.update({ saved_addresses });

        res.json({ message: 'Addresses updated successfully', saved_addresses });
    } catch (error) {
        res.status(500).json({ message: 'Error updating addresses', error });
    }
};
