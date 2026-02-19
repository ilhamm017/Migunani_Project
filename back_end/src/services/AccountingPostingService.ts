import { Transaction } from 'sequelize';
import { Account, Invoice, Order, OrderItem, OrderAllocation } from '../models';
import { JournalService } from './JournalService';
import { InventoryCostService } from './InventoryCostService';
import { findLatestInvoiceByOrderId } from '../utils/invoiceLookup';

const n = (v: unknown) => Number(v || 0);

const getAccount = async (code: string, t: Transaction) => Account.findOne({ where: { code }, transaction: t });

export class AccountingPostingService {
    static async postGoodsOutForOrder(orderId: string, actorId: string, t: Transaction, mode: 'non_cod' | 'cod') {
        const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) throw new Error('Order not found for goods out posting');
        if (order.goods_out_posted_at) return { revenue: 0, cogs: 0 };

        const invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
        if (!invoice) throw new Error('Invoice not found for goods out posting');

        const orderItems = await OrderItem.findAll({ where: { order_id: orderId }, transaction: t, lock: t.LOCK.UPDATE });
        const allocations = await OrderAllocation.findAll({ where: { order_id: orderId }, transaction: t });

        let cogs = 0;
        for (const item of orderItems) {
            let qtyOut = n(item.qty);
            const alloc = allocations.find((a) => a.product_id === item.product_id);
            if (alloc) qtyOut = Math.min(qtyOut, n(alloc.allocated_qty));
            if (qtyOut <= 0) continue;

            const valuation = await InventoryCostService.consumeOutbound({
                product_id: item.product_id,
                qty: qtyOut,
                reference_type: 'order',
                reference_id: String(order.id),
                note: 'Goods out valuation',
                transaction: t
            });
            cogs += n(valuation.total_cost);

            await item.update({ cost_at_purchase: n(valuation.unit_cost) }, { transaction: t });
        }

        const orderSubtotal = orderItems.reduce((sum, item) => sum + (n(item.price_at_purchase) * n(item.qty)), 0);
        const orderDiscount = n(order.discount_amount);
        const orderShipping = n(order.shipping_fee);
        const revenueDpp = Math.max(0, orderSubtotal - orderDiscount + orderShipping);
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

        await order.update({
            goods_out_posted_at: new Date(),
            goods_out_posted_by: actorId
        }, { transaction: t });

        return { revenue: revenueDpp, cogs };
    }
}
