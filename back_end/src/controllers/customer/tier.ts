import { Request, Response } from 'express';
import { User, CustomerProfile } from '../../models';
import { ALLOWED_TIERS } from './types';
import { normalizeId } from './utils';

export const updateCustomerTier = async (req: Request, res: Response) => {
    try {
        const id = normalizeId(req.params?.id);
        if (!id) {
            return res.status(400).json({ message: 'ID customer tidak valid' });
        }

        const requestedTier = typeof req.body?.tier === 'string' ? req.body.tier.trim().toLowerCase() : '';
        if (!ALLOWED_TIERS.includes(requestedTier as (typeof ALLOWED_TIERS)[number])) {
            return res.status(400).json({ message: 'Tier tidak valid. Gunakan regular/gold/platinum' });
        }

        const customer = await User.findOne({
            where: { id, role: 'customer' },
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status']
        });
        if (!customer) {
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }

        const [profile] = await CustomerProfile.findOrCreate({
            where: { user_id: customer.id },
            defaults: {
                user_id: customer.id,
                tier: requestedTier as (typeof ALLOWED_TIERS)[number],
                credit_limit: 0,
                points: 0,
                saved_addresses: []
            }
        });

        if (profile.tier !== requestedTier) {
            await profile.update({ tier: requestedTier as (typeof ALLOWED_TIERS)[number] });
        }

        res.json({
            message: 'Tier customer berhasil diperbarui',
            customer: {
                id: customer.id,
                name: customer.name,
                whatsapp_number: customer.whatsapp_number,
                status: customer.status,
                CustomerProfile: {
                    tier: requestedTier,
                    credit_limit: profile.credit_limit,
                    points: profile.points
                }
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal update tier customer', error });
    }
};
