import { Transaction } from 'sequelize';
import { Order } from '../models';
import { InventoryReservationService } from './InventoryReservationService';

const TERMINAL_ORDER_STATUSES = new Set(['completed', 'canceled', 'expired']);

const normalizeId = (value: unknown) => String(value || '').trim();

export class OrderTerminalizationService {
  static isTerminalStatus(status: unknown) {
    return TERMINAL_ORDER_STATUSES.has(String(status || '').trim().toLowerCase());
  }

  static async releaseReservationsForOrders(params: {
    order_ids: string[];
    transaction: Transaction;
    warn_if_completed_without_goods_out?: boolean;
    context?: string;
  }) {
    const t = params.transaction;
    const orderIds = Array.from(new Set((params.order_ids || []).map(normalizeId).filter(Boolean)));
    if (orderIds.length === 0) {
      return { order_ids: [], released_rows: 0, released_qty: 0 };
    }

    let releasedRows = 0;
    let releasedQty = 0;

    for (const orderId of orderIds) {
      if (params.warn_if_completed_without_goods_out) {
        const order = await Order.findByPk(orderId, {
          attributes: ['id', 'status', 'goods_out_posted_at'],
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (order) {
          const status = String((order as any).status || '').trim().toLowerCase();
          const missingGoodsOut = !(order as any).goods_out_posted_at;
          if (status === 'completed' && missingGoodsOut) {
            console.warn(
              `[OrderTerminalizationService] Order completed without goods_out_posted_at (order_id=${orderId}, context=${String(params.context || '')})`
            );
          }
        }
      }

      const result = await InventoryReservationService.releaseReservationsForOrder({ order_id: orderId, transaction: t });
      releasedRows += Number((result as any)?.released_rows || 0);
      releasedQty += Number((result as any)?.released_qty || 0);
    }

    return { order_ids: orderIds, released_rows: releasedRows, released_qty: releasedQty };
  }
}

