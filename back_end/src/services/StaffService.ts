import bcrypt from 'bcrypt';
import { Op } from 'sequelize';
import { User } from '../models';
import { getWhatsappLookupCandidates, normalizeWhatsappNumber } from '../utils/whatsappNumber';

const STAFF_ROLES = ['admin_gudang', 'checker_gudang', 'admin_finance', 'kasir', 'driver'] as const;

export class StaffService {
    static normalizeText = (value: unknown): string => {
        if (typeof value !== 'string') return '';
        return value.trim();
    };

    static normalizeEmail = (value: unknown): string | null => {
        const raw = StaffService.normalizeText(value);
        if (!raw) return null;
        return raw.toLowerCase();
    };

    static normalizeParamId = (value: unknown): string => {
        if (Array.isArray(value)) {
            return StaffService.normalizeText(value[0]);
        }
        return StaffService.normalizeText(value);
    };

    static async getStaff() {
        return User.findAll({
            where: {
                role: { [Op.in]: STAFF_ROLES as unknown as string[] }
            },
            attributes: ['id', 'name', 'email', 'whatsapp_number', 'role', 'status', 'createdAt', 'updatedAt'],
            order: [['createdAt', 'DESC']]
        });
    }

    static async getStaffById(paramId: unknown) {
        const id = StaffService.normalizeParamId(paramId);
        if (!id) {
            throw new Error('ID staf tidak valid');
        }

        const staff = await User.findOne({
            where: {
                id,
                role: { [Op.in]: STAFF_ROLES as unknown as string[] }
            },
            attributes: ['id', 'name', 'email', 'whatsapp_number', 'role', 'status', 'createdAt', 'updatedAt']
        });

        if (!staff) {
            throw new Error('Staf tidak ditemukan');
        }

        return staff;
    }

    static async createStaff(payload: any) {
        const name = StaffService.normalizeText(payload?.name);
        const email = StaffService.normalizeEmail(payload?.email);
        const whatsappNumber = normalizeWhatsappNumber(payload?.whatsapp_number);
        const role = StaffService.normalizeText(payload?.role) as (typeof STAFF_ROLES)[number];
        const rawPassword = StaffService.normalizeText(payload?.password);

        if (!name || !role || !STAFF_ROLES.includes(role)) {
            throw new Error('Field wajib: name dan role (admin_gudang/checker_gudang/admin_finance/kasir/driver)');
        }
        if (!whatsappNumber) {
            throw new Error('Nomor WhatsApp wajib dan harus valid');
        }

        if (!rawPassword || rawPassword.length < 6) {
            throw new Error('Password minimal 6 karakter');
        }

        const whatsappCandidates = getWhatsappLookupCandidates(whatsappNumber);
        const conflictConditions: Array<Record<string, unknown>> = [
            { whatsapp_number: { [Op.in]: whatsappCandidates } }
        ];
        if (email) {
            conflictConditions.push({ email });
        }

        const existing = await User.findOne({
            where: { [Op.or]: conflictConditions }
        });
        if (existing) {
            throw new Error('Email atau nomor WhatsApp sudah dipakai user lain');
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

        return {
            id: created.id,
            name: created.name,
            email: created.email,
            whatsapp_number: created.whatsapp_number,
            role: created.role,
            status: created.status,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt
        };
    }

    static async updateStaff(paramId: unknown, payload: any) {
        const id = StaffService.normalizeParamId(paramId);
        if (!id) {
            throw new Error('ID staf tidak valid');
        }
        const target = await User.findByPk(id);
        if (!target) {
            throw new Error('Staf tidak ditemukan');
        }

        if (!STAFF_ROLES.includes(target.role as (typeof STAFF_ROLES)[number])) {
            throw new Error('User ini bukan staf operasional');
        }

        const updates: Record<string, unknown> = {};

        const name = StaffService.normalizeText(payload?.name);
        if (typeof payload?.name === 'string') {
            if (!name) throw new Error('Nama tidak boleh kosong');
            updates.name = name;
        }

        if (typeof payload?.email === 'string') {
            updates.email = StaffService.normalizeEmail(payload?.email);
        }

        if (typeof payload?.whatsapp_number === 'string') {
            const whatsappNumber = normalizeWhatsappNumber(payload?.whatsapp_number);
            if (!whatsappNumber) throw new Error('Nomor WhatsApp tidak valid');
            updates.whatsapp_number = whatsappNumber;
        }

        if (typeof payload?.role === 'string') {
            const role = StaffService.normalizeText(payload?.role);
            if (!STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number])) {
                throw new Error('Role staf tidak valid');
            }
            updates.role = role;
        }

        if (typeof payload?.status === 'string') {
            const status = StaffService.normalizeText(payload?.status);
            if (!['active', 'banned'].includes(status)) {
                throw new Error('Status harus active atau banned');
            }
            updates.status = status;
        }

        if (typeof payload?.password === 'string') {
            const rawPassword = StaffService.normalizeText(payload?.password);
            if (rawPassword) {
                if (rawPassword.length < 6) {
                    throw new Error('Password minimal 6 karakter');
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
        const nextWhatsappCandidates = getWhatsappLookupCandidates(nextWhatsapp);

        const conflictConditions: Array<Record<string, unknown>> = [
            { whatsapp_number: { [Op.in]: nextWhatsappCandidates } }
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
            throw new Error('Email atau nomor WhatsApp sudah dipakai user lain');
        }

        await target.update(updates);

        return {
            id: target.id,
            name: target.name,
            email: target.email,
            whatsapp_number: target.whatsapp_number,
            role: target.role,
            status: target.status,
            createdAt: target.createdAt,
            updatedAt: target.updatedAt
        };
    }

    static async deactivateStaff(paramId: unknown) {
        const id = StaffService.normalizeParamId(paramId);
        if (!id) {
            throw new Error('ID staf tidak valid');
        }
        const target = await User.findByPk(id);
        if (!target) {
            throw new Error('Staf tidak ditemukan');
        }

        if (!STAFF_ROLES.includes(target.role as (typeof STAFF_ROLES)[number])) {
            throw new Error('User ini bukan staf operasional');
        }

        await target.update({ status: 'banned' });

        return { message: 'Staf dinonaktifkan' };
    }
}
