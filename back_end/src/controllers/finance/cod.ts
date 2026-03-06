import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, InvoiceItem, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod, CreditNote, CreditNoteLine, Setting } from '../../models';
import { Op } from 'sequelize';
import { JournalService } from '../../services/JournalService';
import { TaxConfigService, computeInvoiceTax } from '../../services/TaxConfigService';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitCodSettlementUpdated, emitOrderStatusChanged } from '../../utils/orderNotification';
import { generateInvoiceNumber } from '../../utils/invoice';
import { findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';


import {
  toSafeText, normalizeExpenseDetails, parseExpenseNote, buildExpenseNote, ensureDefaultExpenseLabels,
  genCreditNoteNumber, normalizeTaxNumber, buildAccountsReceivableInclude, buildAccountsReceivableContext, mapAccountsReceivableRows,
} from './utils';

// --- Driver COD Deposit ---

export const getDriverCodList = async (req: Request, res: Response) => {
    try {
        // 1. Get drivers with debt > 0
        const debtors = await User.findAll({
            where: {
                role: 'driver',
                debt: { [Op.gt]: 0 }
            },
            attributes: ['id', 'name', 'whatsapp_number', 'debt']
        });

        // 2. Get pending COD invoices linked to orders
        const invoiceItems = await InvoiceItem.findAll({
            include: [{
                model: Invoice,
                where: { payment_status: 'cod_pending' },
                required: true
            }, {
                model: OrderItem,
                attributes: ['order_id'],
                required: true
            }]
        });

        const orderInvoiceMap = new Map<string, any>();
        invoiceItems.forEach((item: any) => {
            const orderId = item?.OrderItem?.order_id ? String(item.OrderItem.order_id) : '';
            const invoice = item.Invoice;
            if (!orderId || !invoice) return;
            const existing = orderInvoiceMap.get(orderId);
            if (!existing) {
                orderInvoiceMap.set(orderId, invoice);
                return;
            }
            const existingTime = new Date(existing.createdAt || 0).getTime();
            const nextTime = new Date(invoice.createdAt || 0).getTime();
            if (nextTime > existingTime) {
                orderInvoiceMap.set(orderId, invoice);
            }
        });

        const orderIds = Array.from(orderInvoiceMap.keys());
        const orders = orderIds.length > 0
            ? await Order.findAll({
                where: { id: { [Op.in]: orderIds } },
                include: [{
                    model: User,
                    as: 'Courier',
                    attributes: ['id', 'name', 'whatsapp_number', 'debt']
                }, {
                    model: User,
                    as: 'Customer',
                    attributes: ['id', 'name']
                }]
            })
            : [];

        const grouped: Record<string, any> = {};
        const driverInvoiceTotals = new Map<string, Map<string, number>>();

        // Initialize from debtors
        debtors.forEach(driver => {
            grouped[driver.id] = {
                driver: {
                    id: driver.id,
                    name: driver.name,
                    whatsapp_number: driver.whatsapp_number,
                    debt: Number(driver.debt || 0)
                },
                orders: [],
                total_pending: 0
            };
            driverInvoiceTotals.set(String(driver.id), new Map<string, number>());
        });

        // Merge/Add from invoices
        orders.forEach((order) => {
            const courier = (order as any).Courier;
            if (!courier) return;
            const inv = orderInvoiceMap.get(String(order.id));
            if (!inv) return;

            if (!grouped[courier.id]) {
                grouped[courier.id] = {
                    driver: {
                        id: courier.id,
                        name: courier.name,
                        whatsapp_number: courier.whatsapp_number,
                        debt: Number(courier.debt || 0)
                    },
                    orders: [],
                    total_pending: 0
                };
                driverInvoiceTotals.set(String(courier.id), new Map<string, number>());
            }

            const invoiceId = String((inv as any).id || '');
            const invoiceNumber = String((inv as any).invoice_number || '');
            const invoiceTotalRaw = Number((inv as any).total);
            const invoiceTotal = Number.isFinite(invoiceTotalRaw) ? invoiceTotalRaw : 0;
            grouped[courier.id].orders.push({
                id: order.id,
                order_number: order.id,
                customer_name: (order as any).Customer?.name || 'Customer',
                total_amount: invoiceTotal,
                invoice_id: invoiceId || null,
                invoice_number: invoiceNumber || null,
                invoice_total: invoiceTotal,
                created_at: order.createdAt
            });

            const driverInvoiceMap = driverInvoiceTotals.get(String(courier.id)) || new Map<string, number>();
            const invoiceKey = invoiceId || `order-${String(order.id)}`;
            if (!driverInvoiceMap.has(invoiceKey)) {
                driverInvoiceMap.set(invoiceKey, invoiceTotal);
            }
            driverInvoiceTotals.set(String(courier.id), driverInvoiceMap);
        });

        Object.keys(grouped).forEach((driverId) => {
            const driverInvoiceMap = driverInvoiceTotals.get(String(driverId));
            const totalPending = driverInvoiceMap
                ? Array.from(driverInvoiceMap.values()).reduce((sum, value) => sum + Number(value || 0), 0)
                : 0;
            grouped[driverId].total_pending = totalPending;
        });

        res.json(Object.values(grouped));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching driver COD list', error });
    }
};

export const verifyDriverCod = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { driver_id, order_ids = [], amount_received } = req.body;
        const selectedOrderIds = Array.isArray(order_ids)
            ? order_ids.map((value: unknown) => String(value)).filter(Boolean)
            : [];
        const verifierId = req.user!.id;

        if (!driver_id) {
            await t.rollback();
            return res.status(400).json({ message: 'Driver ID required' });
        }

        const received = Number(amount_received);
        if (isNaN(received) || received < 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Jumlah uang tidak valid' });
        }

        if (selectedOrderIds.length === 0 && received === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada order dipilih dan tidak ada pembayaran.' });
        }

        let invoices: any[] = [];
        let totalExpected = 0;
        const previousOrderStatusById: Record<string, string> = {};
        const orderToInvoiceMap = new Map<string, any>();
        const orderById = new Map<string, any>();
        let affectedOrderIds: string[] = [];
        let settlementId: string | null = null;
        let settledAtIso: string | null = null;
        let settledInvoiceIds: string[] = [];
        let completedOrderIds: string[] = [];

        if (selectedOrderIds.length > 0) {
            const selectedOrders = await Order.findAll({
                where: {
                    id: { [Op.in]: selectedOrderIds },
                    courier_id: driver_id
                },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (selectedOrders.length !== selectedOrderIds.length) {
                await t.rollback();
                return res.status(409).json({ message: 'Beberapa pesanan tidak ditemukan atau bukan milik driver ini.' });
            }

            const orderItems = await OrderItem.findAll({
                where: { order_id: { [Op.in]: selectedOrderIds } },
                attributes: ['id', 'order_id'],
                transaction: t
            });
            const orderItemIds = orderItems.map((item: any) => String(item.id));
            if (orderItemIds.length === 0) {
                await t.rollback();
                return res.status(409).json({ message: 'Order tidak memiliki item untuk ditagihkan.' });
            }

            const invoiceItems = await InvoiceItem.findAll({
                where: { order_item_id: { [Op.in]: orderItemIds } },
                include: [{
                    model: Invoice,
                    where: { payment_status: 'cod_pending' },
                    required: true
                }, {
                    model: OrderItem,
                    attributes: ['order_id'],
                    required: true
                }],
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            const invoiceMap = new Map<string, any>();
            invoiceItems.forEach((item: any) => {
                const invoice = item.Invoice;
                if (!invoice) return;
                invoiceMap.set(String(invoice.id), invoice);
            });

            if (invoiceMap.size === 0) {
                await t.rollback();
                return res.status(409).json({ message: 'Invoice COD pending tidak ditemukan untuk order yang dipilih.' });
            }

            const invoiceIds = Array.from(invoiceMap.keys());
            const allInvoiceItems = await InvoiceItem.findAll({
                where: { invoice_id: { [Op.in]: invoiceIds } },
                include: [{
                    model: OrderItem,
                    attributes: ['order_id'],
                    required: true
                }],
                transaction: t
            });

            const invoiceOrderIdsMap = new Map<string, Set<string>>();
            allInvoiceItems.forEach((item: any) => {
                const invoiceId = String(item.invoice_id);
                const orderId = item?.OrderItem?.order_id ? String(item.OrderItem.order_id) : '';
                if (!orderId) return;
                const set = invoiceOrderIdsMap.get(invoiceId) || new Set<string>();
                set.add(orderId);
                invoiceOrderIdsMap.set(invoiceId, set);
            });

            const allOrderIds = Array.from(new Set(
                Array.from(invoiceOrderIdsMap.values()).flatMap((set) => Array.from(set))
            ));
            const allOrders = await Order.findAll({
                where: { id: { [Op.in]: allOrderIds } },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            allOrders.forEach((order) => {
                orderById.set(String(order.id), order);
            });

            for (const [invoiceId, orderSet] of invoiceOrderIdsMap.entries()) {
                for (const orderId of orderSet) {
                    const order = orderById.get(orderId);
                    if (!order || String(order.courier_id || '') !== String(driver_id)) {
                        await t.rollback();
                        return res.status(409).json({ message: 'Invoice COD gabungan hanya bisa diselesaikan oleh driver yang sama.' });
                    }
                    if (!selectedOrderIds.includes(orderId)) {
                        await t.rollback();
                        return res.status(409).json({ message: 'Pilih semua order dalam invoice COD gabungan.' });
                    }
                }
            }

            invoices = Array.from(invoiceMap.values());
            totalExpected = invoices.reduce((sum, invoice: any) => {
                const invoiceTotal = Number(invoice?.total);
                return sum + (Number.isFinite(invoiceTotal) ? invoiceTotal : 0);
            }, 0);

            affectedOrderIds = allOrderIds;
            allOrders.forEach((order: any) => {
                previousOrderStatusById[String(order.id)] = String(order.status || '');
            });

            invoiceOrderIdsMap.forEach((orderSet, invId) => {
                const inv = invoiceMap.get(invId);
                if (!inv) return;
                orderSet.forEach((orderId) => {
                    orderToInvoiceMap.set(orderId, inv);
                });
            });
        }

        const diff = received - totalExpected;
        // diff < 0 : Shortage -> Driver Debt increases
        // diff > 0 : Surplus -> Driver Debt decreases (pay off)

        const driver = await User.findByPk(driver_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!driver) {
            await t.rollback();
            return res.status(404).json({ message: 'Driver tidak ditemukan' });
        }

        const previousDebt = Number(driver.debt || 0);
        const newDebt = Math.max(0, previousDebt + totalExpected - received);

        await driver.update({ debt: newDebt }, { transaction: t });

        if (invoices.length > 0) {
            // New logic: Find pending CodCollections for these invoices
            const invoiceIds = invoices.map(i => i.id);
            const collections = await CodCollection.findAll({
                where: {
                    invoice_id: { [Op.in]: invoiceIds },
                    driver_id: driver_id,
                    status: 'collected'
                },
                transaction: t
            });

            const collectionSum = collections.reduce((acc, c) => acc + Number(c.amount), 0);

            // Create Settlement
            const settlement = await CodSettlement.create({
                driver_id: driver_id,
                total_amount: received,
                received_by: verifierId,
                settled_at: new Date()
            }, { transaction: t });
            settlementId = String(settlement.id);
            settledAtIso = settlement.settled_at ? new Date(settlement.settled_at).toISOString() : new Date().toISOString();
            settledInvoiceIds = invoiceIds.map((value) => String(value));

            // Mark collections as settled
            if (collections.length > 0) {
                await CodCollection.update({
                    status: 'settled',
                    settlement_id: settlement.id
                }, {
                    where: { id: { [Op.in]: collections.map(c => c.id) } },
                    transaction: t
                });
            }

            const fullySettled = received >= totalExpected;
            if (fullySettled) {
                await Invoice.update({
                    payment_status: 'paid',
                    verified_at: new Date(),
                    verified_by: verifierId
                }, {
                    where: { id: { [Op.in]: invoiceIds } },
                    transaction: t
                });

                await Order.update({
                    status: 'completed'
                }, {
                    where: { id: { [Op.in]: affectedOrderIds.length > 0 ? affectedOrderIds : selectedOrderIds } },
                    transaction: t
                });
                completedOrderIds = [...(affectedOrderIds.length > 0 ? affectedOrderIds : selectedOrderIds)];
            }

            // --- Journal Entry for Settlement (Cash vs Piutang Driver) ---
            if (totalExpected > 0 || received > 0) {
                const cashAcc = await Account.findOne({ where: { code: '1101' }, transaction: t });
                const piutangDriverAcc = await Account.findOne({ where: { code: '1104' }, transaction: t });

                if (cashAcc && piutangDriverAcc) {
                    const journalLines: any[] = [];

                    // a. Cash Received
                    if (received > 0) {
                        journalLines.push({ account_id: cashAcc.id, debit: received, credit: 0 });

                        // b. Reduce Driver Receivable
                        journalLines.push({ account_id: piutangDriverAcc.id, debit: 0, credit: received });
                    }

                    if (journalLines.length >= 2) {
                        await JournalService.createEntry({
                            description: `Setoran COD Settlement #${settlement.id} (Driver: ${driver.name})`,
                            reference_type: 'cod_settlement',
                            reference_id: settlement.id.toString(),
                            created_by: verifierId,
                            lines: journalLines
                        }, t);
                    }
                }
            }
        }

        await t.commit();
        if (completedOrderIds.length > 0) {
            for (const orderId of completedOrderIds) {
                const inv = orderToInvoiceMap.get(orderId);
                const orderData = orderById.get(orderId);
                const previousStatus = previousOrderStatusById[orderId] || String(orderData?.status || '');
                if (previousStatus === 'completed') continue;
                const courierId = String(orderData?.courier_id || '');
                emitOrderStatusChanged({
                    order_id: orderId,
                    from_status: previousStatus || null,
                    to_status: 'completed',
                    source: String(orderData?.source || ''),
                    payment_method: String((inv as any)?.payment_method || ''),
                    courier_id: courierId || null,
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: ['admin_finance', 'driver', 'customer'],
                    target_user_ids: courierId ? [courierId] : [],
                });
            }
        }

        emitCodSettlementUpdated({
            driver_id: String(driver_id),
            order_ids: affectedOrderIds.length > 0 ? affectedOrderIds : selectedOrderIds,
            invoice_ids: settledInvoiceIds,
            total_expected: totalExpected,
            amount_received: received,
            driver_debt_before: previousDebt,
            driver_debt_after: newDebt,
            settled_at: settledAtIso || new Date().toISOString(),
            triggered_by_role: String(req.user?.role || ''),
            target_roles: ['admin_finance', 'driver'],
            target_user_ids: [String(driver_id)],
        });

        res.json({
            message: 'Setoran COD berhasil dikonfirmasi',
            summary: {
                total_expected: totalExpected,
                received: received,
                shortage: diff < 0 ? Math.abs(diff) : 0,
                surplus: diff > 0 ? diff : 0,
                driver_debt_before: previousDebt,
                driver_debt_after: newDebt
            },
            settlement: settlementId ? 'created' : 'skipped'
        });

    } catch (error) {
        try { await t.rollback(); } catch { }
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ message: 'Error verifying driver COD', error: errMsg });
    }
};

