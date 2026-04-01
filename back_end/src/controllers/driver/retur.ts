import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem, ReturHandover, ReturHandoverItem } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findDriverInvoiceContextByOrderOrInvoiceId, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getAssignedReturs = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const returs = await Retur.findAll({
            where: {
                courier_id: userId,
                retur_type: 'customer_request',
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

export const getAssignedDeliveryReturs = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const returs = await Retur.findAll({
            where: {
                courier_id: userId,
                retur_type: { [Op.in]: ['delivery_refusal', 'delivery_damage'] },
                // Driver is physically carrying these goods and must return them to the warehouse.
                status: 'picked_up'
            },
            include: [
                { model: Product, attributes: ['name', 'sku'] },
                { model: Order, attributes: ['id', 'status'] }
            ],
            order: [['updatedAt', 'DESC']]
        });

        const plainReturs = (returs as any[]).map((row: any) => row?.get ? row.get({ plain: true }) : row);
        const orderIds = Array.from(new Set(
            plainReturs.map((row: any) => String(row?.order_id || row?.Order?.id || '').trim()).filter(Boolean)
        ));

        const invoiceByOrderId = new Map<string, { id: string; invoice_number: string; created_at_ms: number }>();
        if (orderIds.length > 0) {
            const orderItems = await OrderItem.findAll({
                where: { order_id: { [Op.in]: orderIds } },
                attributes: ['id', 'order_id']
            });
            const orderItemIds = (orderItems as any[]).map((row: any) => String(row?.id || '').trim()).filter(Boolean);
            const orderItemToOrderId = new Map<string, string>();
            (orderItems as any[]).forEach((row: any) => {
                const orderItemId = String(row?.id || '').trim();
                const orderId = String(row?.order_id || '').trim();
                if (orderItemId && orderId) orderItemToOrderId.set(orderItemId, orderId);
            });

            if (orderItemIds.length > 0) {
                const invoiceItems = await InvoiceItem.findAll({
                    where: { order_item_id: { [Op.in]: orderItemIds } },
                    attributes: ['order_item_id'],
                    include: [{ model: Invoice, attributes: ['id', 'invoice_number', 'createdAt'] }]
                });

                (invoiceItems as any[]).forEach((row: any) => {
                    const orderItemId = String(row?.order_item_id || '').trim();
                    const orderId = orderItemToOrderId.get(orderItemId) || '';
                    const inv = row?.Invoice;
                    const invId = String(inv?.id || '').trim();
                    if (!orderId || !invId) return;
                    const invNumber = String(inv?.invoice_number || '').trim();
                    const createdAtMs = Date.parse(String(inv?.createdAt || ''));
                    const createdAtSafe = Number.isFinite(createdAtMs) ? createdAtMs : 0;
                    const prev = invoiceByOrderId.get(orderId);
                    if (!prev || createdAtSafe >= prev.created_at_ms) {
                        invoiceByOrderId.set(orderId, { id: invId, invoice_number: invNumber, created_at_ms: createdAtSafe });
                    }
                });
            }
        }

        res.json(
            plainReturs.map((row: any) => {
                const orderId = String(row?.order_id || row?.Order?.id || '').trim();
                const invoice = orderId ? invoiceByOrderId.get(orderId) : undefined;
                return {
                    ...row,
                    invoice_id: invoice?.id || null,
                    invoice_number: invoice?.invoice_number || null,
                };
            })
        );
    } catch (error) {
        throw new CustomError('Error fetching assigned delivery returns', 500);
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
                courier_id: userId,
                retur_type: 'customer_request',
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
                courier_id: userId,
                retur_type: 'customer_request',
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

export const createReturHandover = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const driverId = String(req.user!.id || '').trim();
        const invoiceId = String(req.body?.invoice_id || '').trim();
        const note = typeof req.body?.note === 'string' ? req.body.note.trim() : null;

        if (!invoiceId) {
            await t.rollback();
            throw new CustomError('invoice_id wajib diisi', 400);
        }

        const context = await findDriverInvoiceContextByOrderOrInvoiceId(invoiceId, driverId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const invoice = context.invoice;
        const orders = context.orders;
        if (!invoice || orders.length === 0) {
            await t.rollback();
            throw new CustomError('Invoice tidak ditemukan atau bukan tugas Anda.', 404);
        }

        const existing = await ReturHandover.findOne({
            where: { invoice_id: String(invoice.id) },
            attributes: ['id', 'invoice_id'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (existing) {
            await t.rollback();
            throw new CustomError('Serah-terima retur untuk invoice ini sudah dibuat.', 409);
        }

        const orderIds = orders.map((o: any) => String(o.id)).filter(Boolean);
        const returs = await Retur.findAll({
            where: {
                order_id: { [Op.in]: orderIds },
                retur_type: { [Op.in]: ['delivery_refusal', 'delivery_damage'] },
                status: 'picked_up',
                courier_id: driverId
            },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (returs.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada retur delivery yang siap diserahkan (status picked_up).', 409);
        }

        const handover = await ReturHandover.create({
            invoice_id: String(invoice.id),
            driver_id: driverId,
            status: 'submitted',
            note
        }, { transaction: t });

        await ReturHandoverItem.bulkCreate(
            returs.map((r: any) => ({
                handover_id: handover.id,
                retur_id: String(r.id)
            })),
            { transaction: t }
        );

        for (const retur of returs as any[]) {
            const previousStatus = String(retur.status || '');
            await retur.update({ status: 'handed_to_warehouse' }, { transaction: t });
            await emitReturStatusChanged({
                retur_id: String(retur.id),
                order_id: String(retur.order_id),
                from_status: previousStatus || null,
                to_status: 'handed_to_warehouse',
                courier_id: driverId,
                triggered_by_role: String(req.user?.role || 'driver'),
                target_roles: ['driver', 'kasir', 'admin_gudang', 'admin_finance', 'customer', 'super_admin'],
                target_user_ids: [driverId],
            }, {
                transaction: t,
                requestContext: 'driver_submit_retur_handover'
            });
        }

        await t.commit();
        return res.status(201).json({
            message: 'Serah-terima retur berhasil dicatat dan menunggu penerimaan gudang.',
            handover
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Gagal membuat serah-terima retur', 500);
    }
});
