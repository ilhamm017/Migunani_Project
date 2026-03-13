import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { AuditLog, User } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getAuditLogs = asyncWrapper(async (req: Request, res: Response) => {
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 100;
    const q = String(req.query.q || '').trim();
    const method = String(req.query.method || '').trim().toUpperCase();
    const actorRole = String(req.query.actor_role || '').trim();
    const statusGroup = String(req.query.status_group || '').trim().toLowerCase();

    const where: any = {};
    if (method) where.method = method;
    if (actorRole) where.actor_role = actorRole;
    if (statusGroup === 'success') where.status_code = { [Op.lt]: 400 };
    if (statusGroup === 'error') where.status_code = { [Op.gte]: 400 };
    if (q) {
        where[Op.or] = [
            { action: { [Op.like]: `%${q}%` } },
            { path: { [Op.like]: `%${q}%` } },
            { error_message: { [Op.like]: `%${q}%` } },
        ];
    }

    const rows = await AuditLog.findAll({
        where,
        include: [{
            model: User,
            as: 'Actor',
            attributes: ['id', 'name', 'email', 'role'],
            required: false
        }],
        order: [['createdAt', 'DESC']],
        limit
    });

    res.json(rows);
});

export const getAuditLogDetail = asyncWrapper(async (req: Request, res: Response) => {
    const id = Number(req.params.id || 0);
    if (!Number.isFinite(id) || id <= 0) {
        throw new CustomError('Audit log id tidak valid', 400);
    }

    const row = await AuditLog.findByPk(id, {
        include: [{
            model: User,
            as: 'Actor',
            attributes: ['id', 'name', 'email', 'role'],
            required: false
        }]
    });

    if (!row) {
        throw new CustomError('Audit log tidak ditemukan', 404);
    }

    res.json(row);
});
