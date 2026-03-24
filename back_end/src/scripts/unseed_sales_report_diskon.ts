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
import { salesReportDiskonSeedInvoices } from '../seeders/data/sales_report_diskon_2026_03_24';

const uniq = <T,>(values: T[]): T[] => Array.from(new Set(values));

async function main() {
    await sequelize.authenticate();

    const invoiceNumbers = uniq(
        salesReportDiskonSeedInvoices
            .map((row) => String(row?.invoice_no || '').trim())
            .filter(Boolean)
    );

    const importedNotes = invoiceNumbers.map((no) => `[Imported sales report] invoice=${no}`);
    const journalKeys = invoiceNumbers.map((no) => `seed_sales_report_${no}`);

    const t = await sequelize.transaction();
    try {
        const orders = await Order.findAll({
            where: { customer_note: { [Op.in]: importedNotes } },
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

        // Delete children first (FK-safe)
        if (orderItemIds.length) {
            await Backorder.destroy({ where: { order_item_id: { [Op.in]: orderItemIds } }, transaction: t });
            await InvoiceItem.destroy({ where: { order_item_id: { [Op.in]: orderItemIds } }, transaction: t });
        }

        if (orderIds.length) {
            await OrderAllocation.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
            await OrderIssue.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
            await OrderEvent.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
            await Retur.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
        }

        if (invoiceNumbers.length) {
            await Invoice.destroy({ where: { invoice_number: { [Op.in]: invoiceNumbers } }, transaction: t });
        }

        if (orderIds.length) {
            await OrderItem.destroy({ where: { order_id: { [Op.in]: orderIds } }, transaction: t });
            await Order.destroy({ where: { id: { [Op.in]: orderIds } }, transaction: t });
        }

        if (journalKeys.length) {
            // journal_lines will be removed via FK cascade (if configured) or via manual cleanup elsewhere.
            await Journal.destroy({ where: { idempotency_key: { [Op.in]: journalKeys } }, transaction: t });
        }

        await t.commit();

        console.log('[unseed:sales-report] deleted:', {
            invoiceNumbers: invoiceNumbers.length,
            orders: orderIds.length,
            orderItems: orderItemIds.length,
            journals: journalKeys.length
        });
        process.exit(0);
    } catch (error) {
        try { await t.rollback(); } catch { }
        console.error('[unseed:sales-report] failed:', error);
        process.exit(1);
    } finally {
        try { await sequelize.close(); } catch { }
    }
}

main();
