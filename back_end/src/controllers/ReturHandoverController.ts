import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { ReturHandover, ReturHandoverItem, Retur, Product, User, sequelize } from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';
import { ReturService } from '../services/ReturService';
import { calculateDriverCodExposure } from '../utils/codExposure';
import { findAllReturHandoversSafe, findReturHandoverByPkSafe, updateReturHandoverSafe } from '../utils/returHandoverSchemaCompat';
import { emitReturStatusChanged } from '../utils/orderNotification';

export const getReturHandovers = asyncWrapper(async (req: Request, res: Response) => {
    const status = typeof req.query?.status === 'string' ? req.query.status.trim().toLowerCase() : '';
    const where: any = {};
    if (status === 'submitted' || status === 'received') {
        where.status = status;
    }

    const rows = await findAllReturHandoversSafe({
        where,
        include: [
            { model: User, as: 'Driver', attributes: ['id', 'name', 'whatsapp_number'] },
            { model: User, as: 'Receiver', attributes: ['id', 'name', 'whatsapp_number'], required: false },
            {
                model: ReturHandoverItem,
                as: 'Items',
                include: [{
                    model: Retur,
                    as: 'Retur',
                    include: [{ model: Product, attributes: ['id', 'name', 'sku', 'unit'] }]
                }]
            }
        ],
        order: [['submitted_at', 'DESC'], ['id', 'DESC']]
    });

    return res.json(rows);
});

export const receiveReturHandover = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
        await t.rollback();
        throw new CustomError('handover id tidak valid', 400);
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
        await t.rollback();
        throw new CustomError('items wajib diisi', 400);
    }

    try {
        const handover = await findReturHandoverByPkSafe(id, {
            include: [{ model: ReturHandoverItem, as: 'Items', attributes: ['retur_id'] }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!handover) {
            await t.rollback();
            throw new CustomError('Handover tidak ditemukan', 404);
        }
        if (String(handover.status || '') !== 'submitted') {
            await t.rollback();
            throw new CustomError('Handover sudah diterima sebelumnya', 409);
        }

        const expectedReturIds = new Set<string>(
            (handover as any)?.Items?.map((row: any) => String(row?.retur_id || '').trim()).filter(Boolean) || []
        );
        if (expectedReturIds.size === 0) {
            await t.rollback();
            throw new CustomError('Handover tidak memiliki retur item', 409);
        }

        const qtyReceivedByReturId = new Map<string, number>();
        for (const row of items) {
            const returId = String(row?.retur_id || '').trim();
            const qtyReceived = Number(row?.qty_received);
            if (!returId) {
                await t.rollback();
                throw new CustomError('retur_id wajib diisi', 400);
            }
            if (!expectedReturIds.has(returId)) {
                await t.rollback();
                throw new CustomError('retur_id tidak termasuk handover ini', 409);
            }
            if (!Number.isFinite(qtyReceived) || qtyReceived < 0) {
                await t.rollback();
                throw new CustomError('qty_received tidak valid', 400);
            }
            qtyReceivedByReturId.set(returId, Math.trunc(qtyReceived));
        }
        if (qtyReceivedByReturId.size !== expectedReturIds.size) {
            await t.rollback();
            throw new CustomError('qty_received wajib diisi untuk semua retur dalam handover', 400);
        }

        // Backward-compatible: if driver doesn't create "serah-terima" ticket, returs may still be in `picked_up`.
        // Admin receiving the handover implies goods are physically handed over, so we move them to `handed_to_warehouse`
        // before applying the normal verification flow (`handed_to_warehouse` -> `received` -> `completed`).
        const expectedIds = Array.from(expectedReturIds);
        const returRows = await Retur.findAll({
            where: { id: { [Op.in]: expectedIds } },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const returById = new Map<string, any>();
        returRows.forEach((row: any) => returById.set(String(row?.id || '').trim(), row));
        for (const rid of expectedIds) {
            if (!returById.has(String(rid))) {
                await t.rollback();
                throw new CustomError('Retur item tidak ditemukan', 404);
            }
        }

        const actorRole = String(req.user?.role || '');
        for (const row of returRows as any[]) {
            const currentStatus = String(row?.status || '');
            if (currentStatus === 'picked_up') {
                await row.update({ status: 'handed_to_warehouse' }, { transaction: t });
                await emitReturStatusChanged({
                    retur_id: String(row.id),
                    order_id: String(row.order_id),
                    from_status: 'picked_up',
                    to_status: 'handed_to_warehouse',
                    courier_id: String(row.courier_id || ''),
                    triggered_by_role: actorRole || 'admin_gudang',
                    target_roles: ['driver', 'kasir', 'admin_gudang', 'admin_finance', 'customer', 'super_admin'],
                    target_user_ids: row.courier_id ? [String(row.courier_id)] : []
                }, {
                    transaction: t,
                    requestContext: 'admin_receive_retur_handover_auto_handover'
                });
            } else if (currentStatus !== 'handed_to_warehouse') {
                await t.rollback();
                throw new CustomError(`Status retur tidak valid untuk diterima gudang (${currentStatus}).`, 409);
            }
        }

        const actor = { id: String(req.user!.id), role: String(req.user!.role) };
        for (const returId of expectedReturIds) {
            const qtyReceived = qtyReceivedByReturId.get(returId) || 0;
            await ReturService.updateReturStatus(returId, {
                status: 'received',
                qty_received: qtyReceived
            } as any, actor, { transaction: t });
            await ReturService.updateReturStatus(returId, {
                status: 'completed',
                is_back_to_stock: true
            } as any, actor, { transaction: t });
        }

        const driverId = String((handover as any).driver_id || '').trim();
        const driver = driverId
            ? await User.findByPk(driverId, { transaction: t, lock: t.LOCK.UPDATE, attributes: ['id', 'debt'] })
            : null;
        const debtBefore = driver ? Number(driver.debt || 0) : 0;

        const exposure = driverId ? await calculateDriverCodExposure(driverId, { transaction: t }) : { exposure: debtBefore };
        const debtAfter = Number(exposure?.exposure || 0);
        if (driver) {
            await driver.update({ debt: debtAfter }, { transaction: t });
        }

        await updateReturHandoverSafe(handover, {
            status: 'received',
            received_at: new Date(),
            received_by: actor.id,
            note: typeof req.body?.note === 'string' ? req.body.note.trim() : handover.note || null,
            driver_debt_before: debtBefore,
            driver_debt_after: debtAfter,
        }, { transaction: t });

        await t.commit();
        return res.json({ message: 'Handover retur diterima', handover });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});
