import cron from 'node-cron';
import { Op } from 'sequelize';
import { Order, ChatSession, Product, StockMutation } from '../models'; // Ensure models export types correctly
import { OrderTerminalizationService } from '../services/OrderTerminalizationService';
import sequelize from '../config/database';

// 1. The 30-Day Reaper
// Runs every day at midnight (00:00)
cron.schedule('0 0 * * *', async () => {
    console.log('Running The 30-Day Reaper...');
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const t = await sequelize.transaction();
        try {
            const candidates = await Order.findAll({
                where: {
                    status: { [Op.in]: ['pending', 'Pending'] as any },
                    createdAt: { [Op.lt]: thirtyDaysAgo }
                } as any,
                attributes: ['id'],
                transaction: t,
                lock: t.LOCK.UPDATE,
            });
            const orderIds = (candidates as any[])
                .map((row: any) => String(row?.id || '').trim())
                .filter(Boolean);

            if (orderIds.length > 0) {
                await Order.update(
                    { status: 'expired' },
                    { where: { id: { [Op.in]: orderIds } }, transaction: t }
                );
                await OrderTerminalizationService.releaseReservationsForOrders({
                    order_ids: orderIds,
                    transaction: t,
                    context: 'cron_30_day_reaper',
                });
            }

            await t.commit();
            console.log(`Expired ${orderIds.length} pending orders older than 30 days.`);
        } catch (error) {
            try { await t.rollback(); } catch { }
            throw error;
        }

        // Ideally, we should also restock products here if they were reserved.
        // However, the PRD says "stock_released = TRUE", implying a flag or separate logic.
        // If stock was decremented on order creation, we need to increment it back.
        // Technical Design point 4.A says "Mengembalikan stok yang tertahan... ke inventory aktif".
        // Since we don't have the order items readily available in a bulk update return, 
        // a more robust approach would be to fetch orders first, then loop through items to restore stock.
        // For now, following the simple update logic from the design doc query example, but noting this for future refinement.

    } catch (error) {
        console.error('Error running 30-Day Reaper:', error);
    }
});

// 1.5. The 24-Hour Payment Reaper
// Disabled: payment is handled by driver, no waiting_payment status.

// 2. Bot Session Timeout
// Runs every 5 minutes
cron.schedule('*/5 * * * *', async () => {
    console.log('Running Bot Session Timeout Check...');
    try {
        const twoHoursAgo = new Date();
        twoHoursAgo.setMinutes(twoHoursAgo.getMinutes() - 120);

        const result = await ChatSession.update(
            { is_bot_active: true },
            {
                where: {
                    is_bot_active: false,
                    last_message_at: {
                        [Op.lt]: twoHoursAgo
                    }
                }
            }
        );

        console.log(`Re-activated bot for ${result[0]} sessions inactive for > 120 mins.`);
    } catch (error) {
        console.error('Error running Bot Session Timeout:', error);
    }
});

export default cron;
