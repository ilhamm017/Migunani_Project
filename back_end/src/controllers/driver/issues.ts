import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';

export const reportIssue = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    let isCommitted = false;
    try {
        const { id } = req.params; // Order ID
        const noteRaw = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
        const checklistSnapshotRaw = typeof req.body?.checklist_snapshot === 'string'
            ? req.body.checklist_snapshot.trim()
            : '';
        const userId = req.user!.id;
        const evidence = req.file;

        if (noteRaw.length < 5) {
            await t.rollback();
            return res.status(400).json({ message: 'Catatan laporan wajib diisi minimal 5 karakter.' });
        }

        const order = await Order.findOne({
            where: { id, courier_id: userId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order tidak ditemukan atau bukan tugas Anda' });
        }

        if (!['ready_to_ship', 'shipped'].includes(String(order.status || '').toLowerCase())) {
            await t.rollback();
            return res.status(409).json({ message: 'Laporan kekurangan hanya bisa dibuat pada order yang masih aktif dikirim.' });
        }

        let finalNote = noteRaw;
        if (checklistSnapshotRaw) {
            let normalizedSnapshot = checklistSnapshotRaw;
            try {
                const parsed = JSON.parse(checklistSnapshotRaw);
                normalizedSnapshot = JSON.stringify(parsed);
            } catch {
                // Keep raw snapshot as-is when it is not valid JSON.
            }
            if (normalizedSnapshot.length > 1800) {
                normalizedSnapshot = `${normalizedSnapshot.slice(0, 1800)}...`;
            }
            finalNote = `${noteRaw}\n\n[CHECKLIST_SNAPSHOT] ${normalizedSnapshot}`;
        }

        const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const previousStatus = String(order.status || '');
        const existingIssue = await OrderIssue.findOne({
            where: {
                order_id: String(id),
                issue_type: 'shortage',
                status: 'open'
            },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (existingIssue) {
            await existingIssue.update({
                note: finalNote,
                due_at: dueAt,
                created_by: userId,
                evidence_url: evidence?.path || existingIssue.evidence_url || null,
                resolution_note: null,
            }, { transaction: t });
        } else {
            await OrderIssue.create({
                order_id: String(id),
                issue_type: 'shortage',
                status: 'open',
                note: finalNote,
                due_at: dueAt,
                created_by: userId,
                evidence_url: evidence?.path || null,
                resolution_note: null,
            }, { transaction: t });
        }

        await order.update({
            status: 'hold',
            courier_id: null as any,
        }, { transaction: t });

        await t.commit();
        isCommitted = true;

        let paymentMethod: string | null = null;
        try {
            const invoice = await findLatestInvoiceByOrderId(String(order.id));
            paymentMethod = typeof invoice?.payment_method === 'string'
                ? String(invoice.payment_method)
                : null;
        } catch (invoiceLookupError) {
            console.warn('[DriverController.reportIssue] Invoice lookup failed after commit', {
                order_id: String(order.id),
                driver_id: String(userId),
                error: invoiceLookupError instanceof Error ? invoiceLookupError.message : String(invoiceLookupError)
            });
        }

        emitOrderStatusChanged({
            order_id: String(order.id),
            from_status: previousStatus || null,
            to_status: 'hold',
            source: String(order.source || ''),
            payment_method: paymentMethod,
            courier_id: null,
            triggered_by_role: String(req.user?.role || 'driver'),
            target_roles: ['admin_gudang', 'super_admin'],
        });
        res.json({ message: 'Masalah berhasil dilaporkan' });
    } catch (error) {
        if (!isCommitted) {
            await t.rollback();
        }
        console.error('[DriverController.reportIssue] Failed to submit driver issue report', {
            order_id: String(req.params?.id || ''),
            driver_id: String(req.user?.id || ''),
            driver_role: String(req.user?.role || ''),
            error: error instanceof Error ? error.message : String(error)
        });
        res.status(500).json({ message: 'Gagal melaporkan masalah', error });
    }
};

