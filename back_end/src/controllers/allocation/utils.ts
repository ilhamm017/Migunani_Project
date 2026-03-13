import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, OrderAllocation, Product, sequelize, User, OrderIssue, Backorder, InvoiceItem } from '../../models';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders } from '../../utils/invoiceLookup';


export const REALLOCATABLE_STATUSES = ['pending', 'waiting_invoice', 'allocated', 'hold'] as const;
export const TERMINAL_ORDER_STATUSES = ['completed', 'canceled', 'expired'] as const;
export const ALLOCATION_EDITABLE_STATUSES = ['pending', 'waiting_invoice', 'allocated', 'hold'] as const;

export const isAllocationEditableStatus = (statusRaw: unknown): boolean =>
    (ALLOCATION_EDITABLE_STATUSES as readonly string[]).includes(String(statusRaw || '').trim().toLowerCase());

export const isReallocatableStatus = (statusRaw: unknown): boolean =>
    (REALLOCATABLE_STATUSES as readonly string[]).includes(String(statusRaw || '').trim().toLowerCase());

export const buildShortageSummary = (orderItemsRaw: any[], allocationsRaw: any[]) => {
    const orderItems = Array.isArray(orderItemsRaw) ? orderItemsRaw : [];
    const allocations = Array.isArray(allocationsRaw) ? allocationsRaw : [];

    const orderedByProduct = new Map<string, number>();
    const productNameByProduct = new Map<string, string>();
    const productDetailsByProduct = new Map<string, any>();
    orderItems.forEach((item: any) => {
        const key = String(item?.product_id || '');
        if (!key) return;
        const prev = orderedByProduct.get(key) || 0;
        orderedByProduct.set(key, prev + Number(item?.qty || 0));
        if (!productNameByProduct.has(key)) {
            productNameByProduct.set(key, String(item?.Product?.name || 'Produk'));
        }
        // Store product details
        const details = {
            sku: item?.Product?.sku,
            base_price: item?.Product?.base_price,
            stock_quantity: item?.Product?.stock_quantity
        };
        if (!productDetailsByProduct.has(key)) {
            productDetailsByProduct.set(key, details);
        }
    });

    const allocatedByProduct = new Map<string, number>();
    allocations.forEach((allocation: any) => {
        const key = String(allocation?.product_id || '');
        if (!key) return;
        const prev = allocatedByProduct.get(key) || 0;
        allocatedByProduct.set(key, prev + Number(allocation?.allocated_qty || 0));
    });

    let orderedTotal = 0;
    let allocatedTotal = 0;
    let shortageTotal = 0;

    const shortageItems = Array.from(orderedByProduct.entries())
        .map(([productId, orderedQty]) => {
            const allocatedQty = Number(allocatedByProduct.get(productId) || 0);
            const shortageQty = Math.max(0, Number(orderedQty || 0) - allocatedQty);

            orderedTotal += Number(orderedQty || 0);
            allocatedTotal += Math.min(Number(orderedQty || 0), allocatedQty);
            shortageTotal += shortageQty;

            if (shortageQty <= 0) return null;
            const details = productDetailsByProduct.get(productId) || {};
            return {
                product_id: productId,
                product_name: productNameByProduct.get(productId) || 'Produk',
                sku: details.sku,
                base_price: details.base_price,
                stock_quantity: details.stock_quantity,
                ordered_qty: Number(orderedQty || 0),
                allocated_qty: allocatedQty,
                shortage_qty: shortageQty,
            };
        })
        .filter(Boolean);

    return {
        orderedTotal,
        allocatedTotal,
        shortageTotal,
        shortageItems,
    };
};



