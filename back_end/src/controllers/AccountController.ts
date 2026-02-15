import { Request, Response } from 'express';
import { Account } from '../models';

export const getAccounts = async (req: Request, res: Response) => {
    try {
        const accounts = await Account.findAll({
            order: [['code', 'ASC']],
            include: [{ model: Account, as: 'Children' }]
        });
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching accounts', error });
    }
};

export const createAccount = async (req: Request, res: Response) => {
    try {
        const { code, name, type, parent_id, is_active } = req.body;

        const account = await Account.create({
            code,
            name,
            type,
            parent_id: parent_id || null,
            is_active: is_active ?? true
        });

        res.status(201).json(account);
    } catch (error) {
        res.status(500).json({ message: 'Error creating account', error });
    }
};

export const updateAccount = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, type, parent_id, is_active } = req.body;

        const account = await Account.findByPk(Number(id));
        if (!account) {
            return res.status(404).json({ message: 'Account not found' });
        }

        await account.update({
            name,
            type,
            parent_id: parent_id || null,
            is_active: is_active ?? account.is_active
        });

        res.json(account);
    } catch (error) {
        res.status(500).json({ message: 'Error updating account', error });
    }
};

export const deleteAccount = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const account = await Account.findByPk(Number(id));
        if (!account) {
            return res.status(404).json({ message: 'Account not found' });
        }

        // Check if has children
        const children = await Account.count({ where: { parent_id: Number(id) } });
        if (children > 0) {
            return res.status(400).json({ message: 'Cannot delete account with sub-accounts' });
        }

        await account.destroy();
        res.json({ message: 'Account deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting account', error });
    }
};
