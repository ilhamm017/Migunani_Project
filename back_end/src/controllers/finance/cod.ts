import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, InvoiceItem, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod, CreditNote, CreditNoteLine, Setting, Backorder } from '../../models';
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
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { beginIdempotentRequest, clearIdempotentRequest, commitIdempotentRequest, getIdempotencyKey } from '../../utils/idempotency';
import { isOrderTransitionAllowed } from '../../utils/orderTransitions';
import { calculateDriverCodExposure } from '../../utils/codExposure';
import { computeInvoiceNetTotalsBulk } from '../../utils/invoiceNetTotals';
import { recordOrderStatusChanged } from '../../utils/orderEvent';

// --- Driver COD Deposit ---

export const getDriverCodList = asyncWrapper(async (req: Request, res: Response) => {
    try {
        // 1. Get drivers with debt > 0
        const debtors = await User.findAll({
            where: {
                role: 'driver',
                debt: { [Op.gt]: 0 }
            },
            attributes: ['id', 'name', 'whatsapp_number', 'debt']
        });

        // 2. Only keep the latest invoice per order. Older COD invoices must not
        // stay visible in settlement once a newer invoice for the same order exists.
        const invoiceItems = await InvoiceItem.findAll({
            include: [{
                model: Invoice,
                required: true
            }, {
                model: OrderItem,
                attributes: ['order_id'],
                required: true
            }]
        });

        const latestInvoiceByOrderId = new Map<string, any>();
        invoiceItems.forEach((item: any) => {
            const orderId = item?.OrderItem?.order_id ? String(item.OrderItem.order_id) : '';
            const invoice = item.Invoice;
            if (!orderId || !invoice) return;

            const existing = latestInvoiceByOrderId.get(orderId);
            const invoiceTime = new Date(String(invoice.createdAt || 0)).getTime();
            const existingTime = existing ? new Date(String(existing.createdAt || 0)).getTime() : -1;
            if (!existing || invoiceTime > existingTime) {
                latestInvoiceByOrderId.set(orderId, invoice);
            }
        });

        const orderInvoicesMap = new Map<string, Set<string>>();
        const invoiceDataMap = new Map<string, any>();
        latestInvoiceByOrderId.forEach((invoice, orderId) => {
            if (String(invoice.payment_method || '') !== 'cod' || String(invoice.payment_status || '') !== 'cod_pending') {
                return;
            }

            const invId = String(invoice.id);
            invoiceDataMap.set(invId, invoice);
            orderInvoicesMap.set(orderId, new Set<string>([invId]));
        });

        const orderIds = Array.from(orderInvoicesMap.keys());
        const invoiceIdsForTotals = Array.from(new Set(Array.from(invoiceDataMap.keys()).map((x) => String(x || '').trim()).filter(Boolean)));
        const netTotalsByInvoiceId = invoiceIdsForTotals.length > 0
            ? await computeInvoiceNetTotalsBulk(invoiceIdsForTotals)
            : new Map<string, any>();
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

        // 3. Get all pending COD collections for these drivers to calculate dynamic debt
        const pendingCollections = await CodCollection.findAll({
            where: {
                status: 'collected'
            }
        });

        const driverCollectionDebtMap = new Map<string, number>();
        pendingCollections.forEach(c => {
            const dId = String(c.driver_id);
            const amt = Number(c.amount || 0);
            driverCollectionDebtMap.set(dId, (driverCollectionDebtMap.get(dId) || 0) + amt);
        });

        const grouped: Record<string, any> = {};
        const driverInvoiceTotals = new Map<string, Map<string, number>>();

        // Initialize from debtors
        debtors.forEach(driver => {
            const dynamicDebt = driverCollectionDebtMap.get(String(driver.id)) || 0;
            grouped[driver.id] = {
                driver: {
                    id: driver.id,
                    name: driver.name,
                    whatsapp_number: driver.whatsapp_number,
                    debt: Math.max(Number(driver.debt || 0), dynamicDebt)
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

            const invIds = orderInvoicesMap.get(String(order.id));
            if (!invIds) return;

            if (!grouped[courier.id]) {
                const dynamicDebt = driverCollectionDebtMap.get(String(courier.id)) || 0;
                grouped[courier.id] = {
                    driver: {
                        id: courier.id,
                        name: courier.name,
                        whatsapp_number: courier.whatsapp_number,
                        debt: Math.max(Number(courier.debt || 0), dynamicDebt)
                    },
                    orders: [],
                    total_pending: 0
                };
                driverInvoiceTotals.set(String(courier.id), new Map<string, number>());
            }

            invIds.forEach(invId => {
                const inv = invoiceDataMap.get(invId);
                if (!inv) return;

                const invoiceNumber = String((inv as any).invoice_number || '');
                const amountPaid = Number((inv as any).amount_paid || 0);
                const net = netTotalsByInvoiceId.get(String(invId))?.net_total;
                const computedNet = Number(net);
                const invoiceGrossTotalRaw = Number((inv as any).total);
                const invoiceGrossTotal = Number.isFinite(invoiceGrossTotalRaw) ? invoiceGrossTotalRaw : 0;
                const invoiceCollectible = (Number.isFinite(amountPaid) && amountPaid > 0)
                    ? amountPaid
                    : (Number.isFinite(computedNet) && computedNet >= 0 ? computedNet : invoiceGrossTotal);

                grouped[courier.id].orders.push({
                    id: order.id,
                    order_number: order.id,
                    customer_name: (order as any).Customer?.name || 'Customer',
                    total_amount: invoiceCollectible,
                    invoice_id: invId || null,
                    invoice_number: invoiceNumber || null,
                    invoice_total: invoiceCollectible,
                    invoice_total_gross: invoiceGrossTotal,
                    invoice_total_net: (Number.isFinite(computedNet) && computedNet >= 0) ? computedNet : null,
                    created_at: order.createdAt
                });

                const driverInvoiceMap = driverInvoiceTotals.get(String(courier.id)) || new Map<string, number>();
                const invoiceKey = invId || `order-${String(order.id)}`;
                if (!driverInvoiceMap.has(invoiceKey)) {
                    driverInvoiceMap.set(invoiceKey, invoiceCollectible);
                }
                driverInvoiceTotals.set(String(courier.id), driverInvoiceMap);
            });
        });

        Object.keys(grouped).forEach((driverId) => {
            const driverInvoiceMap = driverInvoiceTotals.get(String(driverId));
            const totalPending = driverInvoiceMap
                ? Array.from(driverInvoiceMap.values()).reduce((sum, value) => sum + Number(value || 0), 0)
                : 0;
            grouped[driverId].total_pending = totalPending;

            // Ensure the displayed debt is at least equal to the total of pending invoices
            // This fixes cases where CodCollection record might be missing but invoice is cod_pending
            if (totalPending > Number(grouped[driverId].driver.debt || 0)) {
                grouped[driverId].driver.debt = totalPending;
            }
        });

        res.json(Object.values(grouped));
    } catch (error) {
        throw new CustomError('Error fetching driver COD list', 500);
    }
});

export const verifyDriverCod = asyncWrapper(async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    const scopeBase = `verify_driver_cod:${String(req.user?.id || '')}:${String(req.body?.driver_id || '')}`;
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, scopeBase);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan verifikasi COD duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const { driver_id, order_ids = [], amount_received } = req.body;
        const selectedOrderIds = Array.isArray(order_ids)
            ? order_ids.map((value: unknown) => String(value)).filter(Boolean)
            : [];
        const verifierId = req.user!.id;

        if (!driver_id) {
            await t.rollback();
            throw new CustomError('Driver ID required', 400);
        }

        const received = Number(amount_received);
        if (isNaN(received) || received < 0) {
            await t.rollback();
            throw new CustomError('Jumlah uang tidak valid', 400);
        }

        if (selectedOrderIds.length === 0 && received === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada order dipilih dan tidak ada pembayaran.', 400);
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
        let finalizedOrderResults: Array<{
            orderId: string;
            previousStatus: string;
            nextStatus: 'partially_fulfilled' | 'completed';
        }> = [];

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
                throw new CustomError('Beberapa pesanan tidak ditemukan atau bukan milik driver ini.', 409);
            }

            const orderItems = await OrderItem.findAll({
                where: { order_id: { [Op.in]: selectedOrderIds } },
                attributes: ['id', 'order_id'],
                transaction: t
            });
            const orderItemIds = orderItems.map((item: any) => String(item.id));
            if (orderItemIds.length === 0) {
                await t.rollback();
                throw new CustomError('Order tidak memiliki item untuk ditagihkan.', 409);
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
                throw new CustomError('Invoice COD pending tidak ditemukan untuk order yang dipilih.', 409);
            }

            const invoiceIdsFromMap = Array.from(invoiceMap.keys());
            const allInvoiceItems = await InvoiceItem.findAll({
                where: { invoice_id: { [Op.in]: invoiceIdsFromMap } },
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
                        throw new CustomError('Invoice COD gabungan hanya bisa diselesaikan oleh driver yang sama.', 409);
                    }
                    if (!selectedOrderIds.includes(orderId)) {
                        await t.rollback();
                        throw new CustomError('Pilih semua order dalam invoice COD gabungan.', 409);
                    }
                }
            }

            invoices = Array.from(invoiceMap.values());
            const invoiceIds = invoices.map((inv: any) => String(inv?.id || '').trim()).filter(Boolean);
            const netTotals = invoiceIds.length > 0 ? await computeInvoiceNetTotalsBulk(invoiceIds, { transaction: t }) : new Map<string, any>();
            totalExpected = invoices.reduce((sum, invoice: any) => {
                const invId = String(invoice?.id || '').trim();
                const amountPaid = Number(invoice?.amount_paid || 0);
                if (Number.isFinite(amountPaid) && amountPaid > 0) return sum + amountPaid;
                const computedNet = Number(netTotals.get(invId)?.net_total);
                if (Number.isFinite(computedNet) && computedNet >= 0) return sum + computedNet;
                const invoiceGross = Number(invoice?.total);
                return sum + (Number.isFinite(invoiceGross) ? invoiceGross : 0);
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
        // Driver debt already includes COD collected by the driver.
        // Settlement must reduce existing debt by the cash handed to finance,
        // not add the invoice total a second time.

        const driver = await User.findByPk(driver_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!driver) {
            await t.rollback();
            throw new CustomError('Driver tidak ditemukan', 404);
        }

        const previousDebt = Number(driver.debt || 0);

        let settlementRow: any = null;
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
                total_expected: totalExpected,
                diff_amount: diff,
                driver_debt_before: previousDebt,
                invoice_ids_json: JSON.stringify(invoiceIds.map((value) => String(value))),
                received_by: verifierId,
                settled_at: new Date()
            }, { transaction: t });
            settlementRow = settlement;
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

            const targetOrderIds = affectedOrderIds.length > 0 ? affectedOrderIds : selectedOrderIds;
            const targetOrders = await Order.findAll({
                where: { id: { [Op.in]: targetOrderIds } },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            const targetOrderMap = new Map<string, any>();
            targetOrders.forEach((row: any) => targetOrderMap.set(String(row.id), row));

            for (const orderId of targetOrderIds) {
                const currentStatus = String(previousOrderStatusById[orderId] || targetOrderMap.get(orderId)?.status || '').toLowerCase();
                if (!currentStatus) continue;

                const orderItems = await OrderItem.findAll({
                    where: { order_id: orderId },
                    attributes: ['id'],
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
                const orderItemIds = orderItems.map((row: any) => String(row.id)).filter(Boolean);
                const openBackorderCount = orderItemIds.length > 0
                    ? await Backorder.count({
                        where: {
                            order_item_id: { [Op.in]: orderItemIds },
                            qty_pending: { [Op.gt]: 0 },
                            status: { [Op.notIn]: ['fulfilled', 'canceled'] }
                        },
                        transaction: t
                    })
                    : 0;

                const nextStatus: 'partially_fulfilled' | 'completed' =
                    openBackorderCount > 0 ? 'partially_fulfilled' : 'completed';
                if (currentStatus === nextStatus) continue;
                if (!isOrderTransitionAllowed(currentStatus, nextStatus)) {
                    await t.rollback();
                    throw new CustomError(`Transisi status tidak diizinkan: '${currentStatus}' -> '${nextStatus}'`, 409);
                }
                finalizedOrderResults.push({
                    orderId,
                    previousStatus: currentStatus,
                    nextStatus
                });
            }
            await Invoice.update({
                payment_status: 'paid',
                verified_at: new Date(),
                verified_by: verifierId
            }, {
                where: { id: { [Op.in]: invoiceIds } },
                transaction: t
            });

            for (const result of finalizedOrderResults) {
                await Order.update({
                    status: result.nextStatus
                }, {
                    where: { id: result.orderId },
                    transaction: t
                });
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

        const exposure = await calculateDriverCodExposure(String(driver_id), { transaction: t });
        const newDebt = exposure.exposure;
        await driver.update({ debt: newDebt }, { transaction: t });
        if (settlementRow) {
            await settlementRow.update({ driver_debt_after: newDebt }, { transaction: t });
        }

        if (finalizedOrderResults.length > 0) {
            for (const result of finalizedOrderResults) {
                const orderId = result.orderId;
                const inv = orderToInvoiceMap.get(orderId);
                const orderData = orderById.get(orderId);
                const courierId = String(orderData?.courier_id || '');
                await recordOrderStatusChanged({
                    transaction: t,
                    order_id: orderId,
                    invoice_id: (inv as any)?.id ? String((inv as any).id) : null,
                    from_status: result.previousStatus || null,
                    to_status: result.nextStatus,
                    actor_user_id: verifierId,
                    actor_role: String(req.user?.role || ''),
                    reason: 'finance_verify_cod',
                });
                await emitOrderStatusChanged({
                    order_id: orderId,
                    from_status: result.previousStatus || null,
                    to_status: result.nextStatus,
                    source: String(orderData?.source || ''),
                    payment_method: String((inv as any)?.payment_method || ''),
                    courier_id: courierId || null,
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: result.nextStatus === 'completed'
                        ? ['admin_finance', 'driver', 'customer']
                        : ['admin_finance', 'driver', 'customer', 'kasir', 'admin_gudang'],
                    target_user_ids: courierId ? [courierId] : [],
                }, {
                    transaction: t,
                    requestContext: 'finance_verify_cod_status_changed'
                });
            }
        }

        await emitCodSettlementUpdated({
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
        }, {
            transaction: t,
            requestContext: 'finance_verify_cod_settlement_updated'
        });

        await t.commit();

        const responsePayload = {
            message: 'Setoran COD berhasil dikonfirmasi',
            summary: {
                total_expected: totalExpected,
                received: received,
                shortage: diff < 0 ? Math.abs(diff) : 0,
                surplus: diff > 0 ? diff : 0,
                driver_debt_before: previousDebt,
                driver_debt_after: newDebt
            },
            settlement: settlementId ? 'created' : 'skipped',
            settlement_id: settlementId
        };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, scopeBase, 200, responsePayload);
        }
        res.json(responsePayload);

    } catch (error) {
        try { await t.rollback(); } catch { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, scopeBase);
        }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error verifying driver COD', 500);
    }
});
