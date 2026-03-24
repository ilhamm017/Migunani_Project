import 'dotenv/config';
import { Op } from 'sequelize';
import {
    Backorder,
    Invoice,
    InvoiceItem,
    Journal,
    Order,
    OrderAllocation,
    OrderEvent,
    OrderIssue,
    OrderItem,
    Retur,
    sequelize
} from '../models';
import { salesReportBackorderSeedInvoices } from '../seeders/data/sales_report_backorder_2026_03_24';

const uniq = <T,>(values: T[]): T[] => Array.from(new Set(values));

async function main() {
    await sequelize.authenticate();

    const invoiceNumbers = uniq(
        salesReportBackorderSeedInvoices
            .map((row) => String(row?.invoice_no || '').trim())
            .filter(Boolean)
    );
    const importedNotePrefix = '[Imported sales backorder report] invoice=';
    const journalKeys = invoiceNumbers.map((no) => `seed_sales_report_backorder_${no}`);

    const t = await sequelize.transaction();
    try {
        const orders = await Order.findAll({
            where: { customer_note: { [Op.like]: `${importedNotePrefix}%` } },
            attributes: ['id'],
            transaction: t
        });
        const orderIds = orders.map((o: any) => String(o.id)).filter(Boolean);

        const orderItems = orderIds.length
            ? await OrderItem.findAll({
                where: { order_id: { [Op.in]: orderIds } },
                attributes: ['id'],
                transaction: t
            })
            : [];
        const orderItemIds = orderItems.map((oi: any) => String(oi.id)).filter(Boolean);

        const invoices = invoiceNumbers.length
            ? await Invoice.findAll({
                where: { invoice_number: { [Op.in]: invoiceNumbers } },
                attributes: ['id', 'order_id'],
                transaction: t
            })
            : [];
        const invoiceIds = invoices
            .filter((inv: any) => orderIds.includes(String(inv.order_id || '')))
            .map((inv: any) => String(inv.id))
            .filter(Boolean);

        // Delete children first (FK-safe)
        if (orderItemIds.length) {
            await Backorder.destroy({ where: { order_item_id: { [Op.in]: orderItemIds } }, transaction: t });
            await InvoiceItem.destroy({ where: { order_item_id: { [Op.in]: orderItemIds } }, transaction: t });
        }

        if (invoiceIds.length) {
            await InvoiceItem.destroy({ where: { invoice_id: { [Op.in]: invoiceIds } }, transaction: t });
        }

        if (orderIds.length) {
            await OrderAllocation.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
            await OrderIssue.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
            await OrderEvent.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
            await Retur.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
        }

        if (invoiceIds.length) {
            await Invoice.destroy({ where: { id: { [Op.in]: invoiceIds } }, transaction: t });
        }

        if (orderIds.length) {
            await OrderItem.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
            await Order.destroy({ where: { id: { [Op.in]: orderIds } }, transaction: t });
        }

        if (journalKeys.length) {
            await Journal.destroy({ where: { idempotency_key: { [Op.in]: journalKeys } }, transaction: t });
        }

        await t.commit();
        console.log('[unseed:sales-report-backorder] deleted:', {
            orders: orderIds.length,
            orderItems: orderItemIds.length,
            invoices: invoiceIds.length,
            journals: journalKeys.length
        });
        process.exit(0);
    } catch (error) {
        try { await t.rollback(); } catch { }
        console.error('[unseed:sales-report-backorder] failed:', error);
        process.exit(1);
    } finally {
        try { await sequelize.close(); } catch { }
    }
}

main();
