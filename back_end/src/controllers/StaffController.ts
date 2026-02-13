import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { Op } from 'sequelize';
import { User } from '../models';

const STAFF_ROLES = ['admin_gudang', 'admin_finance', 'kasir', 'driver'] as const;

const normalizeText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const normalizeEmail = (value: unknown): string | null => {
    const raw = normalizeText(value);
    if (!raw) return null;
    return raw.toLowerCase();
};

const normalizeParamId = (value: unknown): string => {
    if (Array.isArray(value)) {
        return normalizeText(value[0]);
    }
    return normalizeText(value);
};

export const getStaff = async (_req: Request, res: Response) => {
    try {
        const staff = await User.findAll({
            where: {
                role: { [Op.in]: STAFF_ROLES as unknown as string[] }
            },
            attributes: ['id', 'name', 'email', 'whatsapp_number', 'role', 'status', 'createdAt', 'updatedAt'],
            order: [['createdAt', 'DESC']]
        });

        res.json({ staff });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat data staf', error });
    }
};

export const getStaffById = async (req: Request, res: Response) => {
    try {
        const id = normalizeParamId(req.params?.id);
        if (!id) {
            return res.status(400).json({ message: 'ID staf tidak valid' });
        }

        const staff = await User.findOne({
            where: {
                id,
                role: { [Op.in]: STAFF_ROLES as unknown as string[] }
            },
            attributes: ['id', 'name', 'email', 'whatsapp_number', 'role', 'status', 'createdAt', 'updatedAt']
        });

        if (!staff) {
            return res.status(404).json({ message: 'Staf tidak ditemukan' });
        }

        res.json({ staff });
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat detail staf', error });
    }
};

export const createStaff = async (req: Request, res: Response) => {
    try {
        const name = normalizeText(req.body?.name);
        const email = normalizeEmail(req.body?.email);
        const whatsappNumber = normalizeText(req.body?.whatsapp_number);
        const role = normalizeText(req.body?.role) as (typeof STAFF_ROLES)[number];
        const rawPassword = normalizeText(req.body?.password);

        if (!name || !whatsappNumber || !role || !STAFF_ROLES.includes(role)) {
            return res.status(400).json({
                message: 'Field wajib: name, whatsapp_number, dan role (admin_gudang/admin_finance/kasir/driver)'
            });
        }

        if (!rawPassword || rawPassword.length < 6) {
            return res.status(400).json({ message: 'Password minimal 6 karakter' });
        }

        const conflictConditions: Array<{ whatsapp_number: string } | { email: string }> = [
            { whatsapp_number: whatsappNumber }
        ];
        if (email) {
            conflictConditions.push({ email });
        }

        const existing = await User.findOne({
            where: { [Op.or]: conflictConditions }
        });
        if (existing) {
            return res.status(409).json({ message: 'Email atau nomor WhatsApp sudah dipakai user lain' });
        }

        const hashedPassword = await bcrypt.hash(rawPassword, 10);
        const created = await User.create({
            name,
            email,
            whatsapp_number: whatsappNumber,
            password: hashedPassword,
            role,
            status: 'active'
        });

        res.status(201).json({
            message: 'Staf berhasil ditambahkan',
            staff: {
                id: created.id,
                name: created.name,
                email: created.email,
                whatsapp_number: created.whatsapp_number,
                role: created.role,
                status: created.status,
                createdAt: created.createdAt,
                updatedAt: created.updatedAt
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menambahkan staf', error });
    }
};

export const updateStaff = async (req: Request, res: Response) => {
    try {
        const id = normalizeParamId(req.params?.id);
        if (!id) {
            return res.status(400).json({ message: 'ID staf tidak valid' });
        }
        const target = await User.findByPk(id);
        if (!target) {
            return res.status(404).json({ message: 'Staf tidak ditemukan' });
        }

        if (!STAFF_ROLES.includes(target.role as (typeof STAFF_ROLES)[number])) {
            return res.status(400).json({ message: 'User ini bukan staf operasional' });
        }

        const updates: Record<string, unknown> = {};

        const name = normalizeText(req.body?.name);
        if (typeof req.body?.name === 'string') {
            if (!name) return res.status(400).json({ message: 'Nama tidak boleh kosong' });
            updates.name = name;
        }

        if (typeof req.body?.email === 'string') {
            updates.email = normalizeEmail(req.body?.email);
        }

        if (typeof req.body?.whatsapp_number === 'string') {
            const whatsappNumber = normalizeText(req.body?.whatsapp_number);
            if (!whatsappNumber) return res.status(400).json({ message: 'Nomor WhatsApp tidak boleh kosong' });
            updates.whatsapp_number = whatsappNumber;
        }

        if (typeof req.body?.role === 'string') {
            const role = normalizeText(req.body?.role);
            if (!STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number])) {
                return res.status(400).json({ message: 'Role staf tidak valid' });
            }
            updates.role = role;
        }

        if (typeof req.body?.status === 'string') {
            const status = normalizeText(req.body?.status);
            if (!['active', 'banned'].includes(status)) {
                return res.status(400).json({ message: 'Status harus active atau banned' });
            }
            updates.status = status;
        }

        if (typeof req.body?.password === 'string') {
            const rawPassword = normalizeText(req.body?.password);
            if (rawPassword) {
                if (rawPassword.length < 6) {
                    return res.status(400).json({ message: 'Password minimal 6 karakter' });
                }
                updates.password = await bcrypt.hash(rawPassword, 10);
            }
        }

        const nextEmail = typeof updates.email === 'string'
            ? updates.email
            : (target.email ?? null);
        const nextWhatsapp = typeof updates.whatsapp_number === 'string'
            ? updates.whatsapp_number
            : target.whatsapp_number;

        const conflictConditions: Array<{ email: string } | { whatsapp_number: string }> = [
            { whatsapp_number: nextWhatsapp }
        ];
        if (nextEmail) {
            conflictConditions.push({ email: nextEmail });
        }

        const conflict = await User.findOne({
            where: {
                id: { [Op.ne]: id },
                [Op.or]: conflictConditions
            }
        });
        if (conflict) {
            return res.status(409).json({ message: 'Email atau nomor WhatsApp sudah dipakai user lain' });
        }

        await target.update(updates);

        res.json({
            message: 'Staf berhasil diperbarui',
            staff: {
                id: target.id,
                name: target.name,
                email: target.email,
                whatsapp_number: target.whatsapp_number,
                role: target.role,
                status: target.status,
                createdAt: target.createdAt,
                updatedAt: target.updatedAt
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal update staf', error });
    }
};

export const deactivateStaff = async (req: Request, res: Response) => {
    try {
        const id = normalizeParamId(req.params?.id);
        if (!id) {
            return res.status(400).json({ message: 'ID staf tidak valid' });
        }
        const target = await User.findByPk(id);
        if (!target) {
            return res.status(404).json({ message: 'Staf tidak ditemukan' });
        }

        if (!STAFF_ROLES.includes(target.role as (typeof STAFF_ROLES)[number])) {
            return res.status(400).json({ message: 'User ini bukan staf operasional' });
        }

        await target.update({ status: 'banned' });

        res.json({ message: 'Staf dinonaktifkan' });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menonaktifkan staf', error });
    }
};
