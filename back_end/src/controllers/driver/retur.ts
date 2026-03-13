import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getAssignedReturs = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const returs = await Retur.findAll({
            where: {
                courier_id: userId,
                status: { [Op.in]: ['pickup_assigned', 'picked_up', 'handed_to_warehouse'] }
            },
            include: [
                { model: Product, attributes: ['name', 'sku'] },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['id', 'name', 'whatsapp_number'],
                    include: [{ model: CustomerProfile }]
                },
                { model: Order, attributes: ['id', 'status'] }
            ],
            order: [['updatedAt', 'DESC']]
        });
        res.json(returs);
    } catch (error) {
        throw new CustomError('Error fetching assigned returns', 500);
    }
});

export const getAssignedReturDetail = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const id = String(req.params.id || '');

        if (!id) {
            throw new CustomError('Retur ID wajib diisi', 400);
        }

        const retur = await Retur.findOne({
            where: {
                id,
                courier_id: userId
            },
            include: [
                { model: Product, attributes: ['id', 'name', 'sku'] },
                {
                    model: User,
                    as: 'Creator',
                    attributes: ['id', 'name', 'whatsapp_number'],
                    include: [{ model: CustomerProfile }]
                },
                { model: Order, attributes: ['id', 'status', 'total_amount'] },
                { model: User, as: 'Courier', attributes: ['id', 'name', 'whatsapp_number'] }
            ]
        });

        if (!retur) {
            throw new CustomError('Retur tidak ditemukan atau bukan tugas Anda', 404);
        }

        return res.json(retur);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching retur detail', 500);
    }
});

export const updateAssignedReturStatus = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    const safeRollback = async () => {
        if (!(t as any).finished) {
            await t.rollback();
        }
    };
    try {
        const driverAllowedStatuses = ['picked_up', 'handed_to_warehouse'] as const;
        type DriverAllowedReturStatus = (typeof driverAllowedStatuses)[number];
        const isDriverAllowedReturStatus = (value: string): value is DriverAllowedReturStatus =>
            (driverAllowedStatuses as readonly string[]).includes(value);

        const userId = req.user!.id;
        const id = String(req.params.id || '');
        const requestedStatus = String(req.body?.status || '').trim();

        if (!id || !requestedStatus) {
            await safeRollback();
            throw new CustomError('Retur ID dan status wajib diisi', 400);
        }

        if (!isDriverAllowedReturStatus(requestedStatus)) {
            await safeRollback();
            throw new CustomError('Status tidak valid untuk aksi driver', 400);
        }
        const nextStatus: DriverAllowedReturStatus = requestedStatus;

        const retur = await Retur.findOne({
            where: {
                id,
                courier_id: userId
            },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!retur) {
            await safeRollback();
            throw new CustomError('Retur tidak ditemukan atau bukan tugas Anda', 404);
        }

        if (nextStatus === 'picked_up' && retur.status !== 'pickup_assigned') {
            await safeRollback();
            throw new CustomError('Barang hanya bisa dipickup dari status pickup_assigned', 409);
        }

        if (nextStatus === 'handed_to_warehouse' && retur.status !== 'picked_up') {
            await safeRollback();
            throw new CustomError('Barang hanya bisa diserahkan ke kasir setelah pickup', 409);
        }

        const previousStatus = String(retur.status || '');
        await retur.update({ status: nextStatus }, { transaction: t });
        await emitReturStatusChanged({
            retur_id: String(retur.id),
            order_id: String(retur.order_id),
            from_status: previousStatus || null,
            to_status: nextStatus,
            courier_id: String(retur.courier_id || userId),
            triggered_by_role: String(req.user?.role || 'driver'),
            target_roles: ['driver', 'kasir', 'admin_finance', 'customer', 'super_admin'],
            target_user_ids: [String(userId)],
        }, {
            transaction: t,
            requestContext: 'driver_retur_status_changed'
        });

        await t.commit();

        return res.json({
            message: nextStatus === 'picked_up'
                ? 'Pickup barang retur berhasil dikonfirmasi'
                : 'Penyerahan barang ke kasir berhasil dikonfirmasi',
            retur
        });
    } catch (error) {
        await safeRollback();
        const err: any = error;
        const detail = String(err?.original?.sqlMessage || err?.message || '');
        const enumMismatch = detail.includes("Data truncated for column 'status'")
            || detail.includes("Incorrect enum value")
            || detail.includes("Unknown column 'status'")
            || detail.includes("Column 'status'");
        if (enumMismatch) {
            throw new CustomError(`Status retur belum sinkron di database. Restart backend untuk sinkronisasi enum status retur. Detail: ${detail}`, 409);
        }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error updating retur task status', 500);
    }
});
