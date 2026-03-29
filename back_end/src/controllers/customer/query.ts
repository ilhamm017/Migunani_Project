import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { Op } from 'sequelize';
import { User, CustomerProfile, Order, OrderItem, Product, sequelize, Backorder, InvoiceItem, Invoice, PosSale, PosSaleItem } from '../../models';
import { attachInvoicesToOrders } from '../../utils/invoiceLookup';
import { computeInvoiceNetTotalsBulk } from '../../utils/invoiceNetTotals';
import { OPEN_ORDER_STATUSES } from './types';
import { normalizeId, parsePositiveNumber, applyCustomerSearch, applyStatusFilter } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

const sanitizeExcelText = (value: unknown): string => {
    const text = String(value ?? '');
    if (!text) return '';
    return /^[=+\-@]/.test(text) ? `'${text}` : text;
};

export const searchCustomers = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { search, status = 'active', limit = 20 } = req.query;

        const whereClause: any = {
            role: 'customer',
        };
        applyStatusFilter(whereClause, status);
        applyCustomerSearch(whereClause, search);

        const customers = await User.findAll({
            where: whereClause,
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status', 'debt', 'createdAt'],
            include: [
                { model: CustomerProfile, attributes: ['tier', 'credit_limit', 'points'] }
            ],
            limit: parsePositiveNumber(limit, 20, 100),
            order: [['createdAt', 'DESC']]
        });

        res.json({ customers });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error searching customers', 500);
    }
});

export const getCustomers = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 20, search, status = 'all' } = req.query;
        const safePage = parsePositiveNumber(page, 1, 100000);
        const safeLimit = parsePositiveNumber(limit, 20, 100);
        const offset = (safePage - 1) * safeLimit;

        const whereClause: any = {
            role: 'customer',
        };
        applyStatusFilter(whereClause, status);
        applyCustomerSearch(whereClause, search);

        const customers = await User.findAndCountAll({
            where: whereClause,
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status', 'debt', 'createdAt', 'updatedAt'],
            include: [
                { model: CustomerProfile, attributes: ['tier', 'credit_limit', 'points'] }
            ],
            distinct: true,
            limit: safeLimit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const customerIds = customers.rows.map((item: any) => item.id);
        const openOrderRows = customerIds.length
            ? await Order.findAll({
                attributes: [
                    'customer_id',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'count']
                ],
                where: {
                    customer_id: { [Op.in]: customerIds },
                    status: { [Op.in]: OPEN_ORDER_STATUSES as unknown as string[] }
                },
                group: ['customer_id'],
                raw: true
            }) as unknown as Array<{ customer_id: string; count: number }>
            : [];

        const openOrderCountByCustomer = new Map<string, number>();
        for (const row of openOrderRows) {
            openOrderCountByCustomer.set(String(row.customer_id), Number(row.count || 0));
        }

        const rows = customers.rows.map((item: any) => {
            const plain = item.get({ plain: true }) as any;
            return {
                ...plain,
                open_order_count: openOrderCountByCustomer.get(item.id) || 0,
            };
        });

        res.json({
            total: customers.count,
            totalPages: Math.ceil(customers.count / safeLimit),
            currentPage: safePage,
            customers: rows,
        });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching customers', 500);
    }
});

export const getCustomerById = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = normalizeId(req.params?.id);
        if (!id) {
            throw new CustomError('ID customer tidak valid', 400);
        }

        const customer = await User.findOne({
            where: { id, role: 'customer' },
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status', 'debt', 'createdAt', 'updatedAt'],
            include: [
                { model: CustomerProfile, attributes: ['tier', 'credit_limit', 'points', 'saved_addresses'] }
            ]
        });

        if (!customer) {
            throw new CustomError('Customer tidak ditemukan', 404);
        }

        const orderCountRows = await Order.findAll({
            attributes: [
                'status',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            where: { customer_id: id },
            group: ['status'],
            raw: true,
        }) as unknown as Array<{ status: string; count: number }>;

        const statusCounts: Record<string, number> = {};
        let totalOrders = 0;
        let openOrders = 0;
        for (const row of orderCountRows) {
            const count = Number(row.count || 0);
            statusCounts[row.status] = count;
            totalOrders += count;
            if (OPEN_ORDER_STATUSES.includes(row.status as (typeof OPEN_ORDER_STATUSES)[number])) {
                openOrders += count;
            }
        }

        res.json({
            customer,
            summary: {
                total_orders: totalOrders,
                open_orders: openOrders,
                status_counts: statusCounts,
            }
        });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching customer detail', 500);
    }
});

export const getCustomerOrders = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const customerId = normalizeId(req.params?.id);
        if (!customerId) {
            throw new CustomError('ID customer tidak valid', 400);
        }

        const customer = await User.findOne({
            where: { id: customerId, role: 'customer' },
            attributes: ['id']
        });
        if (!customer) {
            throw new CustomError('Customer tidak ditemukan', 404);
        }

        const { page = 1, limit = 20, scope = 'all', status, startDate, endDate, include_collectible_total } = req.query;
        const safePage = parsePositiveNumber(page, 1, 100000);
        const safeLimit = parsePositiveNumber(limit, 20, 100);
        const offset = (safePage - 1) * safeLimit;
        const includeCollectibleTotals = String(include_collectible_total || '').trim().toLowerCase() === 'true';

        const whereClause: any = {
            customer_id: customerId,
        };

        const scopeParam = typeof scope === 'string' ? scope.trim().toLowerCase() : 'all';
        const statusParam = typeof status === 'string' ? status.trim() : '';

        if (scopeParam === 'open') {
            whereClause.status = { [Op.in]: OPEN_ORDER_STATUSES as unknown as string[] };
        } else if (statusParam && statusParam !== 'all') {
            whereClause.status = statusParam;
        }

        const createdAtRange: Record<symbol, Date> = {} as Record<symbol, Date>;
        if (typeof startDate === 'string' && startDate.trim()) {
            const parsedStart = new Date(startDate);
            if (!Number.isNaN(parsedStart.getTime())) {
                parsedStart.setHours(0, 0, 0, 0);
                createdAtRange[Op.gte] = parsedStart;
            }
        }
        if (typeof endDate === 'string' && endDate.trim()) {
            const parsedEnd = new Date(endDate);
            if (!Number.isNaN(parsedEnd.getTime())) {
                parsedEnd.setHours(23, 59, 59, 999);
                createdAtRange[Op.lte] = parsedEnd;
            }
        }
        if (Object.keys(createdAtRange).length > 0 || Object.getOwnPropertySymbols(createdAtRange).length > 0) {
            whereClause.createdAt = createdAtRange;
        }

        const orders = await Order.findAndCountAll({
            where: whereClause,
            distinct: true,
            limit: safeLimit,
            offset,
            include: [
                {
                    model: OrderItem,
                    include: [
                        { model: Product, attributes: ['id', 'name', 'sku'] },
                        { model: Backorder, attributes: ['id', 'qty_pending', 'status', 'notes'] },
                        {
                            model: InvoiceItem,
                            as: 'InvoiceItems',
                            attributes: ['id', 'invoice_id', 'order_item_id', 'qty', 'unit_price', 'line_total', 'createdAt'],
                            include: [{
                                model: Invoice,
                                attributes: ['id', 'invoice_number', 'payment_status', 'payment_method', 'createdAt']
                            }]
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        const plainOrders = orders.rows.map((row: any) => row.get({ plain: true }) as any);
        const ordersWithInvoices = await attachInvoicesToOrders(plainOrders);

        let enrichedOrders = ordersWithInvoices;
        if (includeCollectibleTotals) {
            const invoiceIds = new Set<string>();
            ordersWithInvoices.forEach((row: any) => {
                const inv = row?.Invoice;
                if (inv?.id) invoiceIds.add(String(inv.id));
                const list = Array.isArray(row?.Invoices) ? row.Invoices : [];
                list.forEach((i: any) => { if (i?.id) invoiceIds.add(String(i.id)); });

                const orderItems = Array.isArray(row?.OrderItems) ? row.OrderItems : [];
                orderItems.forEach((item: any) => {
                    const invoiceItems = Array.isArray(item?.InvoiceItems) ? item.InvoiceItems : [];
                    invoiceItems.forEach((invoiceItem: any) => {
                        const nestedInv = invoiceItem?.Invoice;
                        if (nestedInv?.id) invoiceIds.add(String(nestedInv.id));
                    });
                });
            });

            const ids = Array.from(invoiceIds).filter(Boolean);
            const totalsByInvoiceId = ids.length > 0 ? await computeInvoiceNetTotalsBulk(ids) : new Map<string, any>();

            const attach = (inv: any) => {
                if (!inv?.id) return inv;
                const computed = totalsByInvoiceId.get(String(inv.id));
                if (!computed) return inv;
                return {
                    ...inv,
                    collectible_total: Number(computed.net_total || 0),
                    delivery_return_summary: computed,
                };
            };

            enrichedOrders = ordersWithInvoices.map((row: any) => {
                const orderItems = Array.isArray(row?.OrderItems) ? row.OrderItems : [];
                const patchedItems = orderItems.map((item: any) => {
                    const invoiceItems = Array.isArray(item?.InvoiceItems) ? item.InvoiceItems : [];
                    const patchedInvoiceItems = invoiceItems.map((invoiceItem: any) => ({
                        ...invoiceItem,
                        Invoice: invoiceItem?.Invoice ? attach(invoiceItem.Invoice) : invoiceItem?.Invoice || null,
                    }));
                    return {
                        ...item,
                        InvoiceItems: patchedInvoiceItems,
                    };
                });

                return {
                    ...row,
                    Invoice: row?.Invoice ? attach(row.Invoice) : row?.Invoice || null,
                    Invoices: Array.isArray(row?.Invoices) ? row.Invoices.map((i: any) => attach(i)) : row?.Invoices || [],
                    OrderItems: patchedItems,
                };
            });
        }

        res.json({
            total: orders.count,
            totalPages: Math.ceil(orders.count / safeLimit),
            currentPage: safePage,
            orders: enrichedOrders,
        });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching customer orders', 500);
    }
});

export const exportCustomerOrdersXlsx = asyncWrapper(async (req: Request, res: Response) => {
    const customerId = normalizeId(req.params?.id);
    if (!customerId) {
        throw new CustomError('ID customer tidak valid', 400);
    }

    const customer = await User.findOne({
        where: { id: customerId, role: 'customer' },
        attributes: ['id', 'name']
    });
    if (!customer) {
        throw new CustomError('Customer tidak ditemukan', 404);
    }

    const { scope = 'all', status, startDate, endDate } = req.query;
    const orderLimit = parsePositiveNumber((req.query as any)?.limit, 5000, 5000);

    const whereClause: any = {
        customer_id: customerId,
    };

    const scopeParam = typeof scope === 'string' ? scope.trim().toLowerCase() : 'all';
    const statusParam = typeof status === 'string' ? status.trim() : '';
    if (scopeParam === 'open') {
        whereClause.status = { [Op.in]: OPEN_ORDER_STATUSES as unknown as string[] };
    } else if (statusParam && statusParam !== 'all') {
        whereClause.status = statusParam;
    }

    const createdAtRange: Record<symbol, Date> = {} as Record<symbol, Date>;
    const startDateText = typeof startDate === 'string' ? startDate.trim() : '';
    const endDateText = typeof endDate === 'string' ? endDate.trim() : '';
    if (startDateText) {
        const parsedStart = new Date(startDateText);
        if (!Number.isNaN(parsedStart.getTime())) {
            parsedStart.setHours(0, 0, 0, 0);
            createdAtRange[Op.gte] = parsedStart;
        }
    }
    if (endDateText) {
        const parsedEnd = new Date(endDateText);
        if (!Number.isNaN(parsedEnd.getTime())) {
            parsedEnd.setHours(23, 59, 59, 999);
            createdAtRange[Op.lte] = parsedEnd;
        }
    }
    if (Object.keys(createdAtRange).length > 0 || Object.getOwnPropertySymbols(createdAtRange).length > 0) {
        whereClause.createdAt = createdAtRange;
    }

    const orders = await Order.findAndCountAll({
        where: whereClause,
        distinct: true,
        limit: orderLimit,
        offset: 0,
        include: [
            {
                model: OrderItem,
                include: [
                    { model: Product, attributes: ['id', 'name', 'sku'] },
                    { model: Backorder, attributes: ['id', 'qty_pending', 'status', 'notes'] },
                    {
                        model: InvoiceItem,
                        as: 'InvoiceItems',
                        attributes: ['id', 'invoice_id', 'order_item_id', 'qty', 'createdAt'],
                        include: [{
                            model: Invoice,
                            attributes: ['id', 'invoice_number', 'payment_status', 'payment_method', 'createdAt']
                        }]
                    }
                ]
            }
        ],
        order: [['createdAt', 'DESC']]
    });

    if (orders.count > orderLimit) {
        throw new CustomError(`Terlalu banyak order (${orders.count}). Perkecil rentang tanggal atau batasi hasil.`, 400);
    }

    const plainOrders = orders.rows.map((row: any) => row.get({ plain: true }) as any);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Migunani System';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Customer Purchases');

    const customerName = sanitizeExcelText((customer as any)?.name || 'Customer');
    const headerRowIndex = 10;

    sheet.getRow(1).values = ['Customer Purchases (Per OrderId)'];
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(3).values = ['Customer', customerName || '-'];
    sheet.getRow(4).values = ['Customer ID', sanitizeExcelText(customerId)];
    sheet.getRow(5).values = ['Tanggal Mulai', sanitizeExcelText(startDateText || '-')];
    sheet.getRow(6).values = ['Tanggal Akhir', sanitizeExcelText(endDateText || '-')];
    sheet.getRow(7).values = ['Total Order', Number(plainOrders.length)];

    sheet.getRow(headerRowIndex).values = [
        'No',
        'Order ID',
        'Tanggal Order',
        'Status',
        'Order Total',
        'Order Item ID',
        'SKU',
        'Produk',
        'Qty Order',
        'Qty Tersuplai',
        'Qty Backorder',
        'Qty Cancel',
        'Qty Sisa',
        'Invoice (Order)',
        'Invoice Breakdown (Item)',
    ];
    sheet.getRow(headerRowIndex).font = { bold: true };

    let rowNo = 0;
    const startDataRow = headerRowIndex + 1;

    plainOrders.forEach((order: any) => {
        const orderId = String(order?.id || '').trim();
        const orderStatus = String(order?.status || '').trim();
        const isOrderCanceled = ['canceled', 'cancelled'].includes(orderStatus.toLowerCase());
        const orderCreatedAt = order?.createdAt ? new Date(order.createdAt) : null;
        const orderTotal = Number(order?.total_amount ?? order?.total ?? 0);

        const orderItems = Array.isArray(order?.OrderItems) ? order.OrderItems : [];
        const orderInvoiceSet = new Set<string>();
        orderItems.forEach((item: any) => {
            const invoiceItems = Array.isArray(item?.InvoiceItems) ? item.InvoiceItems : [];
            invoiceItems.forEach((invItem: any) => {
                const invoiceNumber = String(invItem?.Invoice?.invoice_number || '').trim();
                if (invoiceNumber) orderInvoiceSet.add(invoiceNumber);
            });
        });
        const orderInvoiceNumbers = Array.from(orderInvoiceSet.values()).join(', ');

        const writeRow = (payload: {
            orderItemId: string;
            sku: string;
            productName: string;
            orderedQty: number;
            suppliedQty: number;
            backorderQty: number;
            canceledQty: number;
            remainingQty: number;
            invoiceBreakdown: string;
        }) => {
            rowNo += 1;
            const excelRowIndex = startDataRow + (rowNo - 1);
            const rowValues: any[] = [
                rowNo,
                sanitizeExcelText(orderId),
                orderCreatedAt || '',
                sanitizeExcelText(orderStatus || '-'),
                Number.isFinite(orderTotal) ? orderTotal : 0,
                sanitizeExcelText(payload.orderItemId || ''),
                sanitizeExcelText(payload.sku || '-'),
                sanitizeExcelText(payload.productName || '-'),
                payload.orderedQty,
                payload.suppliedQty,
                payload.backorderQty,
                payload.canceledQty,
                payload.remainingQty,
                sanitizeExcelText(orderInvoiceNumbers || '-'),
                sanitizeExcelText(payload.invoiceBreakdown || '-'),
            ];

            sheet.getRow(excelRowIndex).values = rowValues;
            if (orderCreatedAt) {
                sheet.getRow(excelRowIndex).getCell(3).numFmt = 'yyyy-mm-dd hh:mm';
            }
            sheet.getRow(excelRowIndex).getCell(1).numFmt = '#,##0';
            sheet.getRow(excelRowIndex).getCell(5).numFmt = '#,##0';
            for (const col of [9, 10, 11, 12, 13]) {
                sheet.getRow(excelRowIndex).getCell(col).numFmt = '#,##0';
            }
        };

        if (orderItems.length === 0) {
            writeRow({
                orderItemId: '',
                sku: '-',
                productName: '-',
                orderedQty: 0,
                suppliedQty: 0,
                backorderQty: 0,
                canceledQty: 0,
                remainingQty: 0,
                invoiceBreakdown: '-',
            });
            return;
        }

        orderItems.forEach((item: any) => {
            const orderItemId = String(item?.id || '').trim();
            const sku = String(item?.Product?.sku || '').trim() || String(item?.Product?.id || '').trim() || '-';
            const productName = String(item?.Product?.name || '').trim() || 'Produk';

            const orderedQty = Math.max(
                0,
                Number(item?.ordered_qty_original ?? item?.qty ?? 0)
            );

            const invoiceItems = Array.isArray(item?.InvoiceItems) ? item.InvoiceItems : [];
            const invoiceQtyByNumber = new Map<string, number>();
            let suppliedQty = 0;
            invoiceItems.forEach((invItem: any) => {
                const qty = Math.max(0, Number(invItem?.qty || 0));
                suppliedQty += qty;
                const invNum = String(invItem?.Invoice?.invoice_number || '').trim();
                if (!invNum) return;
                invoiceQtyByNumber.set(invNum, Number(invoiceQtyByNumber.get(invNum) || 0) + qty);
            });
            const invoiceBreakdown = Array.from(invoiceQtyByNumber.entries())
                .map(([invNum, qty]) => `${invNum}:${qty}`)
                .join(' | ');

            const backorderStatus = String(item?.Backorder?.status || '').trim().toLowerCase();
            const backorderQty = backorderStatus && !['fulfilled', 'canceled', 'cancelled'].includes(backorderStatus)
                ? Math.max(0, Number(item?.Backorder?.qty_pending || 0))
                : 0;

            const canceledManualQty = Math.max(0, Number((item as any)?.qty_canceled_manual || 0));
            const canceledBackorderQty = Math.max(0, Number(item?.qty_canceled_backorder || 0));
            const currentQty = Math.max(0, Number(item?.qty ?? orderedQty));
            const canceledByOrderQty = isOrderCanceled ? Math.max(0, currentQty - suppliedQty) : 0;
            const canceledQty = Math.max(0, canceledManualQty + canceledBackorderQty + canceledByOrderQty);

            const remainingQty = Math.max(0, orderedQty - suppliedQty - canceledManualQty - canceledBackorderQty);

            writeRow({
                orderItemId,
                sku,
                productName,
                orderedQty,
                suppliedQty,
                backorderQty,
                canceledQty,
                remainingQty,
                invoiceBreakdown: invoiceBreakdown || '-',
            });
        });
    });

    sheet.columns = [
        { key: 'no', width: 6 },
        { key: 'order_id', width: 40 },
        { key: 'order_date', width: 18 },
        { key: 'status', width: 14 },
        { key: 'total', width: 14 },
        { key: 'order_item_id', width: 40 },
        { key: 'sku', width: 18 },
        { key: 'product', width: 44 },
        { key: 'ordered_qty', width: 12 },
        { key: 'supplied_qty', width: 12 },
        { key: 'backorder_qty', width: 12 },
        { key: 'canceled_qty', width: 12 },
        { key: 'remaining_qty', width: 12 },
        { key: 'order_invoices', width: 28 },
        { key: 'item_invoices', width: 44 },
    ];

    const safeName = (customerName || 'customer').replace(/[^a-z0-9_-]/gi, '_').slice(0, 48) || 'customer';
    const safeStart = (startDateText || '').replace(/[^0-9-]/g, '') || 'all';
    const safeEnd = (endDateText || '').replace(/[^0-9-]/g, '') || 'all';
    const timestamp = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
    const fileName = `customer-purchases-${safeName}-${safeStart}_${safeEnd}-${fileSuffix}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
});

export const getCustomerTopProducts = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const customerId = normalizeId(req.params?.id);
        if (!customerId) {
            throw new CustomError('ID customer tidak valid', 400);
        }

        const customer = await User.findOne({
            where: { id: customerId, role: 'customer' },
            attributes: ['id'],
        });
        if (!customer) {
            throw new CustomError('Customer tidak ditemukan', 404);
        }

        const limitNum = parsePositiveNumber(req.query.limit, 10, 50);
        const includeInactive = String(req.query.include_inactive || '').trim().toLowerCase() === 'true';

        const defaultEnd = new Date();
        const defaultStart = new Date(defaultEnd.getTime() - (365 * 24 * 60 * 60 * 1000));

        const startDateInput = typeof req.query.startDate === 'string' && req.query.startDate.trim()
            ? req.query.startDate.trim()
            : defaultStart.toISOString().slice(0, 10);
        const endDateInput = typeof req.query.endDate === 'string' && req.query.endDate.trim()
            ? req.query.endDate.trim()
            : defaultEnd.toISOString().slice(0, 10);

        const start = new Date(startDateInput);
        const end = new Date(endDateInput);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
            throw new CustomError('StartDate/EndDate tidak valid', 400);
        }
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        if (start > end) {
            throw new CustomError('Rentang tanggal tidak valid', 400);
        }

        const toNum = (value: unknown) => {
            const parsed = Number(value || 0);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const toIso = (value: unknown): string | null => {
            if (!value) return null;
            const ts = Date.parse(String(value));
            if (!Number.isFinite(ts)) return null;
            return new Date(ts).toISOString();
        };
        const toTs = (value: unknown): number => {
            const ts = Date.parse(String(value || ''));
            return Number.isFinite(ts) ? ts : 0;
        };

        type AggRow = {
            product_id: string;
            qty_total: unknown;
            tx_count: unknown;
            last_at: unknown;
        };

        const [invoiceRows, posRows] = await Promise.all([
            InvoiceItem.findAll({
                attributes: [
                    [sequelize.col('OrderItem.product_id'), 'product_id'],
                    [sequelize.fn('SUM', sequelize.col('InvoiceItem.qty')), 'qty_total'],
                    [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('InvoiceItem.invoice_id'))), 'tx_count'],
                    [sequelize.fn('MAX', sequelize.col('Invoice.verified_at')), 'last_at'],
                ],
                include: [
                    {
                        model: Invoice,
                        attributes: [],
                        where: {
                            customer_id: customerId,
                            payment_status: 'paid',
                            verified_at: { [Op.between]: [start, end] },
                        },
                    },
                    {
                        model: OrderItem,
                        attributes: [],
                    }
                ],
                group: [sequelize.col('OrderItem.product_id')],
                raw: true,
            }) as unknown as AggRow[],
            PosSaleItem.findAll({
                attributes: [
                    [sequelize.col('PosSaleItem.product_id'), 'product_id'],
                    [sequelize.fn('SUM', sequelize.col('PosSaleItem.qty')), 'qty_total'],
                    [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('PosSaleItem.pos_sale_id'))), 'tx_count'],
                    [sequelize.fn('MAX', sequelize.col('Sale.paid_at')), 'last_at'],
                ],
                include: [
                    {
                        model: PosSale,
                        as: 'Sale',
                        attributes: [],
                        where: {
                            customer_id: customerId,
                            status: 'paid',
                            paid_at: { [Op.between]: [start, end] },
                        }
                    }
                ],
                group: [sequelize.col('PosSaleItem.product_id')],
                raw: true,
            }) as unknown as AggRow[],
        ]);

        type PerSource = { tx_count: number; qty_total: number; last_at: string | null };
        type Bucket = {
            product_id: string;
            invoice: PerSource;
            pos: PerSource;
            order_count: number;
            qty_total: number;
            last_bought_at: string | null;
            last_bought_ts: number;
        };

        const byProduct = new Map<string, Bucket>();
        const ensureBucket = (productId: string) => {
            const existing = byProduct.get(productId);
            if (existing) return existing;
            const next: Bucket = {
                product_id: productId,
                invoice: { tx_count: 0, qty_total: 0, last_at: null },
                pos: { tx_count: 0, qty_total: 0, last_at: null },
                order_count: 0,
                qty_total: 0,
                last_bought_at: null,
                last_bought_ts: 0,
            };
            byProduct.set(productId, next);
            return next;
        };

        for (const row of invoiceRows) {
            const productId = String((row as any)?.product_id || '').trim();
            if (!productId) continue;
            const bucket = ensureBucket(productId);
            bucket.invoice.tx_count = Math.max(0, Math.trunc(toNum((row as any)?.tx_count)));
            bucket.invoice.qty_total = Math.max(0, toNum((row as any)?.qty_total));
            bucket.invoice.last_at = toIso((row as any)?.last_at);
        }
        for (const row of posRows) {
            const productId = String((row as any)?.product_id || '').trim();
            if (!productId) continue;
            const bucket = ensureBucket(productId);
            bucket.pos.tx_count = Math.max(0, Math.trunc(toNum((row as any)?.tx_count)));
            bucket.pos.qty_total = Math.max(0, toNum((row as any)?.qty_total));
            bucket.pos.last_at = toIso((row as any)?.last_at);
        }

        const merged = Array.from(byProduct.values()).map((bucket) => {
            bucket.order_count = Math.max(0, Math.trunc(bucket.invoice.tx_count + bucket.pos.tx_count));
            bucket.qty_total = Math.max(0, bucket.invoice.qty_total + bucket.pos.qty_total);
            const invoiceTs = toTs(bucket.invoice.last_at);
            const posTs = toTs(bucket.pos.last_at);
            const lastTs = Math.max(invoiceTs, posTs);
            bucket.last_bought_ts = lastTs;
            bucket.last_bought_at = lastTs > 0 ? new Date(lastTs).toISOString() : null;
            return bucket;
        });

        merged.sort((a, b) => {
            const orderDiff = (b.order_count || 0) - (a.order_count || 0);
            if (orderDiff !== 0) return orderDiff;
            const qtyDiff = (b.qty_total || 0) - (a.qty_total || 0);
            if (qtyDiff !== 0) return qtyDiff;
            return (b.last_bought_ts || 0) - (a.last_bought_ts || 0);
        });

        const candidateStats = merged.slice(0, Math.min(200, Math.max(limitNum * 5, limitNum)));
        const candidateIds = candidateStats.map((row) => row.product_id);

        const products = candidateIds.length > 0
            ? await Product.findAll({
                where: {
                    id: { [Op.in]: candidateIds },
                    ...(includeInactive ? {} : { status: 'active' }),
                } as any,
                attributes: ['id', 'sku', 'name', 'image_url', 'stock_quantity', 'price', 'base_price', 'varian_harga', 'unit', 'status'],
            })
            : [];

        const productById = new Map<string, any>();
        for (const product of products as any[]) {
            const plain = product?.get ? product.get({ plain: true }) : product;
            if (!plain?.id) continue;
            productById.set(String(plain.id), plain);
        }

        const rows = [];
        for (const stat of candidateStats) {
            const product = productById.get(String(stat.product_id));
            if (!product) continue;
            rows.push({
                product,
                stats: {
                    order_count: stat.order_count,
                    qty_total: stat.qty_total,
                    last_bought_at: stat.last_bought_at,
                    invoice: stat.invoice,
                    pos: stat.pos,
                }
            });
            if (rows.length >= limitNum) break;
        }

        res.json({
            period: { startDate: startDateInput, endDate: endDateInput },
            rows,
        });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching customer top products', 500);
    }
});
