import { Op, Transaction } from 'sequelize';
import { Account, ClearancePromo, Invoice, InvoiceItem, Order, OrderItem, OrderAllocation, Product } from '../models';
import { JournalService } from './JournalService';
import { InventoryCostService } from './InventoryCostService';
import { InventoryReservationService } from './InventoryReservationService';
import { findLatestInvoiceByOrderId } from '../utils/invoiceLookup';
import { CustomError } from '../utils/CustomError';

const n = (v: unknown) => Number(v || 0);
const round2 = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const toSnapshot = (raw: unknown): Record<string, unknown> | null => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw as Record<string, unknown>;
    if (typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

const computeEmbeddedDiscountTotal = (items: any[]): number => {
    if (!Array.isArray(items)) return 0;
    return round2(items.reduce((acc, item) => {
        const qty = Math.max(0, Math.trunc(n(item?.qty)));
        const price = n(item?.price_at_purchase);
        const snapshot = toSnapshot(item?.pricing_snapshot);
        const basePriceRaw = snapshot ? snapshot['base_price'] : null;
        const basePrice = Number(basePriceRaw);
        const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : price;
        const embedded = Math.max(0, round2(Math.max(0, safeBase - price) * qty));
        return acc + embedded;
    }, 0));
};

const getAccount = async (code: string, t: Transaction) => Account.findOne({ where: { code }, transaction: t });

export class AccountingPostingService {
    static async postGoodsOutForOrder(orderId: string, actorId: string, t: Transaction, mode: 'non_cod' | 'cod') {
        const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) throw new CustomError('Order tidak ditemukan untuk proses goods out.', 404);
        if (order.goods_out_posted_at) return { revenue: 0, cogs: 0 };

        const invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
        if (!invoice) throw new CustomError('Invoice tidak ditemukan untuk proses goods out.', 409);

        const orderItems = await OrderItem.findAll({ where: { order_id: orderId }, transaction: t, lock: t.LOCK.UPDATE });
        const allocations = await OrderAllocation.findAll({ where: { order_id: orderId }, transaction: t });

        // Prefer posting based on invoice_items (what actually gets shipped/checked) to avoid consuming stock
        // for order items that are not part of the current invoice shipment.
        const invoiceItems = await InvoiceItem.findAll({
            where: { invoice_id: String(invoice.id) },
            attributes: ['order_item_id', 'qty'],
            transaction: t,
            lock: t.LOCK.UPDATE
        }) as any[];
        const invoiceQtyByOrderItemId = new Map<string, number>();
        for (const row of invoiceItems) {
            const orderItemId = String(row?.order_item_id || '').trim();
            if (!orderItemId) continue;
            const prev = Number(invoiceQtyByOrderItemId.get(orderItemId) || 0);
            invoiceQtyByOrderItemId.set(orderItemId, prev + n(row?.qty));
        }
        const hasInvoiceItemScope = invoiceQtyByOrderItemId.size > 0;

        const allocatedByProduct = new Map<string, number>();
        allocations.forEach((allocation: any) => {
            const productId = String(allocation?.product_id || '').trim();
            if (!productId) return;
            const prev = Number(allocatedByProduct.get(productId) || 0);
            allocatedByProduct.set(productId, prev + n(allocation?.allocated_qty));
        });

        const itemsByProduct = new Map<string, any[]>();
        (orderItems as any[]).forEach((item: any) => {
            const productId = String(item?.product_id || '').trim();
            if (!productId) return;
            const bucket = itemsByProduct.get(productId) || [];
            bucket.push(item);
            itemsByProduct.set(productId, bucket);
        });

        let cogs = 0;
        let didSyncReservations = false;
        for (const [productId, group] of itemsByProduct.entries()) {
            const sorted = [...group].sort((a: any, b: any) => {
                const aId = Number(a?.id);
                const bId = Number(b?.id);
                if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
                return String(a?.id || '').localeCompare(String(b?.id || ''));
            });

            const hasAllocation = allocatedByProduct.has(productId);
            let remainingAlloc = hasAllocation ? Math.max(0, n(allocatedByProduct.get(productId))) : 0;

            for (const item of sorted as any[]) {
                const invoiceQty = hasInvoiceItemScope ? Math.max(0, n(invoiceQtyByOrderItemId.get(String(item.id)) || 0)) : null;
                let qtyOut = Math.max(0, invoiceQty === null ? n(item?.qty) : invoiceQty);
                if (hasAllocation) {
                    qtyOut = Math.min(qtyOut, remainingAlloc);
                    remainingAlloc = Math.max(0, remainingAlloc - qtyOut);
                }
                if (qtyOut <= 0) continue;

	                const clearancePromoId = String(item?.clearance_promo_id || '').trim();
	                let valuation: { qty: number; unit_cost: number; total_cost: number } | null = null;

                try {
	                    valuation = await InventoryReservationService.consumeReservedForOrderItem({
	                        order_item_id: String(item.id),
	                        qty: qtyOut,
	                        reference_type: 'order_goods_out',
	                        reference_id: String(order.id),
	                        note: 'Goods out valuation (reserved)',
	                        transaction: t
	                    });
	                } catch (error: any) {
                    let message = String(error?.message || error || '');
                    let messageLower = message.toLowerCase();
                    const reservationMissing = () =>
                        message.includes('No inventory batch reservations')
                        || messageLower.includes('tidak ada reservasi batch inventory')
                        || messageLower.includes('no inventory batch reservation');
                    const reservationInsufficient = () =>
                        messageLower.includes('insufficient reserved')
                        || messageLower.includes('qty reservasi batch inventory tidak cukup');

                    let handled = false;
                    if ((reservationMissing() || reservationInsufficient()) && !didSyncReservations) {
                        await InventoryReservationService.syncReservationsForOrder({ order_id: String(order.id), transaction: t });
                        didSyncReservations = true;
                        try {
	                            valuation = await InventoryReservationService.consumeReservedForOrderItem({
	                                order_item_id: String(item.id),
	                                qty: qtyOut,
	                                reference_type: 'order_goods_out',
	                                reference_id: String(order.id),
	                                note: 'Goods out valuation (reserved after sync)',
	                                transaction: t
	                            });
	                            handled = true;
                        } catch (retryError: any) {
                            // If still missing reservations, fallback to legacy valuation below.
                            error = retryError;
                            message = String(retryError?.message || retryError || '');
                            messageLower = message.toLowerCase();
                        }
                    }

                    if (!handled && reservationMissing()) {
                        // Legacy fallback (no allocation/reservation) - still respects other orders' reservations via consumeFromBatches().
                        if (clearancePromoId) {
                            const promo = await ClearancePromo.findByPk(clearancePromoId, { transaction: t, lock: t.LOCK.SHARE });
                            const targetUnitCost = promo && String((promo as any).product_id) === String(item?.product_id)
                                ? Number((promo as any).target_unit_cost || 0)
                                : null;

	                            valuation = targetUnitCost !== null
	                                ? await InventoryCostService.consumeOutboundPreferUnitCost({
                                    product_id: String(item.product_id),
                                    qty: qtyOut,
                                    preferred_unit_cost: targetUnitCost,
                                    reference_type: 'order_goods_out',
                                    reference_id: String(order.id),
                                    order_item_id: String(item.id),
                                    note: 'Goods out valuation (legacy clearance promo)',
                                    transaction: t
                                })
                                : await InventoryCostService.consumeOutbound({
                                    product_id: String(item.product_id),
                                    qty: qtyOut,
                                    reference_type: 'order_goods_out',
                                    reference_id: String(order.id),
                                    order_item_id: String(item.id),
                                    note: 'Goods out valuation (legacy)',
                                    transaction: t
                                });
                        } else {
	                            valuation = await InventoryCostService.consumeOutbound({
	                                product_id: String(item.product_id),
	                                qty: qtyOut,
	                                reference_type: 'order_goods_out',
	                                reference_id: String(order.id),
	                                order_item_id: String(item.id),
	                                note: 'Goods out valuation (legacy)',
	                                transaction: t
	                            });
	                        }
	                        handled = true;
	                    }

                    if (!handled) {
                        // Normalize inventory posting failures into a user-facing error instead of 500.
                        if (error instanceof CustomError) throw error;
	                        throw new CustomError(
	                            message || 'Gagal memproses goods out (inventory/jurnal).',
	                            409
	                        );
	                    }
	                }

	                if (!valuation) {
	                    throw new CustomError('Gagal menentukan valuation goods out untuk item order.', 409);
	                }
	                cogs += n(valuation.total_cost);

	                await item.update({ cost_at_purchase: n(valuation.unit_cost) }, { transaction: t });
	                await InvoiceItem.update(
	                    { unit_cost: n(valuation.unit_cost) },
	                    {
	                        where: { invoice_id: String(invoice.id), order_item_id: String(item.id) },
	                        transaction: t
	                    }
	                );
            }
        }

        // NOTE:
        // - `price_at_purchase` already reflects tier/category/promo pricing (embedded discounts).
        // - `order.discount_amount` includes embedded discounts + possible voucher-style discounts.
        // - Only voucher-style discounts should reduce revenue below sum(price_at_purchase * qty).
        const revenueDpp = hasInvoiceItemScope
            ? Math.max(0, n((invoice as any).subtotal))
            : (() => {
                const orderSubtotal = round2(orderItems.reduce((sum, item) => sum + (n(item.price_at_purchase) * n(item.qty)), 0));
                const embeddedDiscount = computeEmbeddedDiscountTotal(orderItems as any[]);
                const externalDiscount = Math.max(0, round2(n(order.discount_amount) - embeddedDiscount));
                const orderShipping = n(order.shipping_fee);
                return Math.max(0, round2(orderSubtotal - externalDiscount + orderShipping));
            })();
        const outputVat = n(invoice.tax_mode_snapshot === 'pkp' ? invoice.tax_amount : 0) * (n(invoice.total) > 0 ? (revenueDpp / n(invoice.total)) : 0);

        if (mode === 'non_cod') {
            const deferredRevenueAcc = await getAccount('2300', t);
            const revenueAcc = await getAccount('4100', t);
            if (deferredRevenueAcc && revenueAcc && revenueDpp > 0) {
                await JournalService.createEntry({
                    description: `Pengakuan pendapatan barang keluar Order #${order.id}`,
                    reference_type: 'order_goods_out',
                    reference_id: String(order.id),
                    created_by: actorId,
                    idempotency_key: `goods_out_revenue_${order.id}`,
                    lines: [
                        { account_id: deferredRevenueAcc.id, debit: revenueDpp, credit: 0 },
                        { account_id: revenueAcc.id, debit: 0, credit: revenueDpp }
                    ]
                }, t);
            }
        } else {
            const piutangDriverAcc = await getAccount('1104', t);
            const revenueAcc = await getAccount('4100', t);
            const ppnOutputAcc = await getAccount('2201', t);
            const lines = [];
            if (piutangDriverAcc && revenueAcc && revenueDpp > 0) {
                lines.push({ account_id: piutangDriverAcc.id, debit: revenueDpp + outputVat, credit: 0 });
                lines.push({ account_id: revenueAcc.id, debit: 0, credit: revenueDpp });
                if (outputVat > 0 && ppnOutputAcc) {
                    lines.push({ account_id: ppnOutputAcc.id, debit: 0, credit: outputVat });
                }
                await JournalService.createEntry({
                    description: `Penjualan COD barang keluar Order #${order.id}`,
                    reference_type: 'order_goods_out_cod',
                    reference_id: String(order.id),
                    created_by: actorId,
                    idempotency_key: `goods_out_cod_revenue_${order.id}`,
                    lines
                }, t);
            }
        }

        if (cogs > 0) {
            const hppAcc = await getAccount('5100', t);
            const inventoryAcc = await getAccount('1300', t);
            if (hppAcc && inventoryAcc) {
                await JournalService.createEntry({
                    description: `HPP barang keluar Order #${order.id}`,
                    reference_type: 'order_goods_out_cogs',
                    reference_id: String(order.id),
                    created_by: actorId,
                    idempotency_key: `goods_out_cogs_${order.id}`,
                    lines: [
                        { account_id: hppAcc.id, debit: cogs, credit: 0 },
                        { account_id: inventoryAcc.id, debit: 0, credit: cogs }
                    ]
                }, t);
            }
        }

        const openAllocations = await OrderAllocation.findAll({
            where: {
                order_id: orderId,
                status: { [Op.in]: ['pending', 'picked'] },
                allocated_qty: { [Op.gt]: 0 }
            },
            transaction: t,
            lock: t.LOCK.UPDATE
        }) as any[];

        if (openAllocations.length > 0) {
            const now = new Date();
            const shippedQtyByProductId = new Map<string, number>();

            for (const alloc of openAllocations) {
                const productId = String(alloc?.product_id || '').trim();
                const qty = Math.max(0, Math.trunc(n(alloc?.allocated_qty)));
                if (!productId || qty <= 0) continue;

                shippedQtyByProductId.set(productId, Number(shippedQtyByProductId.get(productId) || 0) + qty);

                await alloc.update({
                    status: 'shipped',
                    shipped_at: now,
                    picked_at: alloc?.picked_at ? new Date(alloc.picked_at) : now,
                }, { transaction: t });
            }

            const productIdsToUpdate = Array.from(shippedQtyByProductId.keys());
            if (productIdsToUpdate.length > 0) {
                const products = await Product.findAll({
                    where: { id: { [Op.in]: productIdsToUpdate } },
                    transaction: t,
                    lock: t.LOCK.UPDATE
                }) as any[];

                for (const product of products) {
                    const productId = String(product?.id || '').trim();
                    const dec = Number(shippedQtyByProductId.get(productId) || 0);
                    if (!productId || dec <= 0) continue;
                    const currentAllocated = Number(product?.allocated_quantity || 0);
                    await product.update({
                        allocated_quantity: Math.max(0, currentAllocated - dec),
                    }, { transaction: t });
                }
            }
        }

        await order.update({
            goods_out_posted_at: new Date(),
            goods_out_posted_by: actorId
        }, { transaction: t });

        return { revenue: revenueDpp, cogs };
    }
}
