import { Request, Response } from 'express';
import { Account } from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

export const getAccounts = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const accounts = await Account.findAll({
            order: [['code', 'ASC']],
            include: [{ model: Account, as: 'Children' }]
        });
        res.json(accounts);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error fetching accounts', 500);
    }
});

export const createAccount = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { code, name, type, parent_id, is_active } = req.body;
        const normalizedCode = typeof code === 'string' ? code.trim() : '';
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        const normalizedType = typeof type === 'string' ? type.trim() : '';

        if (!normalizedCode) {
            throw new CustomError('code wajib diisi', 400);
        }
        if (!normalizedName) {
            throw new CustomError('name wajib diisi', 400);
        }
        if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(normalizedType)) {
            throw new CustomError('type account tidak valid', 400);
        }

        if (parent_id !== undefined && parent_id !== null && (!Number.isInteger(Number(parent_id)) || Number(parent_id) <= 0)) {
            throw new CustomError('parent_id tidak valid', 400);
        }

        const existing = await Account.findOne({ where: { code: normalizedCode } });
        if (existing) {
            throw new CustomError('code account sudah digunakan', 409);
        }

        const account = await Account.create({
            code: normalizedCode,
            name: normalizedName,
            type: normalizedType as any,
            parent_id: parent_id || null,
            is_active: is_active ?? true
        });

        res.status(201).json(account);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error creating account', 500);
    }
});

export const updateAccount = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, type, parent_id, is_active } = req.body;
        const accountId = Number(id);
        if (!Number.isInteger(accountId) || accountId <= 0) {
            throw new CustomError('ID account tidak valid', 400);
        }

        const account = await Account.findByPk(accountId);
        if (!account) {
            throw new CustomError('Account not found', 404);
        }

        if (parent_id !== undefined && parent_id !== null && (!Number.isInteger(Number(parent_id)) || Number(parent_id) <= 0)) {
            throw new CustomError('parent_id tidak valid', 400);
        }
        if (typeof name === 'string' && !name.trim()) {
            throw new CustomError('name wajib diisi', 400);
        }
        if (type !== undefined && !['asset', 'liability', 'equity', 'revenue', 'expense'].includes(String(type).trim())) {
            throw new CustomError('type account tidak valid', 400);
        }

        await account.update({
            name: typeof name === 'string' ? name.trim() : account.name,
            type: typeof type === 'string' ? type.trim() as any : account.type,
            parent_id: parent_id || null,
            is_active: is_active ?? account.is_active
        });

        res.json(account);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error updating account', 500);
    }
});

export const deleteAccount = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const accountId = Number(id);
        if (!Number.isInteger(accountId) || accountId <= 0) {
            throw new CustomError('ID account tidak valid', 400);
        }
        const account = await Account.findByPk(accountId);
        if (!account) {
            throw new CustomError('Account not found', 404);
        }

        // Check if has children
        const children = await Account.count({ where: { parent_id: accountId } });
        if (children > 0) {
            throw new CustomError('Cannot delete account with sub-accounts', 400);
        }

        await account.destroy();
        res.json({ message: 'Account deleted' });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error deleting account', 500);
    }
});
