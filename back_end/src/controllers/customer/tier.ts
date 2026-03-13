import { Request, Response } from 'express';
import { User, CustomerProfile } from '../../models';
import { ALLOWED_TIERS } from './types';
import { normalizeId } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const updateCustomerTier = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = normalizeId(req.params?.id);
        if (!id) {
            throw new CustomError('ID customer tidak valid', 400);
        }

        const requestedTier = typeof req.body?.tier === 'string' ? req.body.tier.trim().toLowerCase() : '';
        if (!ALLOWED_TIERS.includes(requestedTier as (typeof ALLOWED_TIERS)[number])) {
            throw new CustomError('Tier tidak valid. Gunakan regular/gold/platinum', 400);
        }

        const customer = await User.findOne({
            where: { id, role: 'customer' },
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status']
        });
        if (!customer) {
            throw new CustomError('Customer tidak ditemukan', 404);
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
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Gagal update tier customer', 500);
    }
});
