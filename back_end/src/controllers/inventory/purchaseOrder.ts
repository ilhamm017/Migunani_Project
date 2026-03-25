import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Product, Category, ProductCategory, StockMutation, PurchaseOrder, PurchaseOrderItem, Supplier, sequelize, SupplierInvoice, SupplierPayment, Account, Journal, JournalLine } from '../../models';
import { JournalService } from '../../services/JournalService';
import { Op, Transaction } from 'sequelize';
import { InventoryCostService } from '../../services/InventoryCostService';
import { TaxConfigService } from '../../services/TaxConfigService';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const createPurchaseOrder = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const supplierIdRaw = req.body?.supplier_id;
        const supplierId = Number.isFinite(Number(supplierIdRaw)) ? Number(supplierIdRaw) : null;

        const items = req.body?.items;
        if (!Array.isArray(items) || items.length <= 0) {
            await t.rollback();
            throw new CustomError('items wajib diisi (minimal 1 barang)', 400);
        }

        if (supplierId === null || !Number.isInteger(supplierId) || supplierId <= 0) {
            await t.rollback();
            throw new CustomError('supplier_id wajib diisi dan valid', 400);
        }
        const supplier = await Supplier.findByPk(supplierId, { transaction: t });
        if (!supplier) {
            await t.rollback();
            throw new CustomError('Supplier tidak ditemukan', 404);
        }

        const toMoney2 = (v: unknown) => {
            const n = Number(v || 0);
            if (!Number.isFinite(n)) return 0;
            return Math.round(n * 100) / 100;
        };

        let computedTotalCost = 0;
        for (const item of items) {
            const qty = Number(item?.qty);
            const productId = String(item?.product_id || '').trim();
            if (!productId) continue;
            if (!Number.isFinite(qty) || qty <= 0) continue;

            const product = await Product.findByPk(productId, { transaction: t });
            if (!product) {
                await t.rollback();
                throw new CustomError(`Produk tidak ditemukan: ${productId}`, 404);
            }

            const unitCostInput = Number(item?.unit_cost);
            const expectedUnitCost = toMoney2((product as any).base_price || 0);
            const normalizedUnitCost = Number.isFinite(unitCostInput) && unitCostInput >= 0
                ? toMoney2(unitCostInput)
                : expectedUnitCost;

            if (toMoney2(normalizedUnitCost) <= 0) {
                await t.rollback();
                throw new CustomError(`Modal/unit_cost wajib > 0 untuk produk ${String((product as any).sku || productId)}. Isi unit_cost saat inbound atau lengkapi base_price di master produk.`, 400);
            }

            const costNote = String(item?.cost_note ?? '').trim();
            if (toMoney2(normalizedUnitCost) !== toMoney2(expectedUnitCost) && !costNote) {
                await t.rollback();
                throw new CustomError(`Alasan selisih harga wajib diisi untuk produk ${String((product as any).sku || productId)}`, 400);
            }

            computedTotalCost += qty * normalizedUnitCost;
        }

        const po = await PurchaseOrder.create({
            supplier_id: supplier.id,
            status: 'pending',
            total_cost: Number(computedTotalCost || 0),
            created_by: req.user!.id
        }, { transaction: t });

        let createdCount = 0;
        for (const item of items) {
            const qty = Number(item?.qty);
            const productId = String(item?.product_id || '').trim();
            if (!productId) continue;
            if (!Number.isFinite(qty) || qty <= 0) continue;
            const product = await Product.findByPk(productId, { transaction: t });
            if (!product) {
                await t.rollback();
                throw new CustomError(`Produk tidak ditemukan: ${productId}`, 404);
            }

            const unitCostInput = Number(item?.unit_cost);
            const expectedUnitCost = toMoney2((product as any).base_price || 0);
            const normalizedUnitCost = Number.isFinite(unitCostInput) && unitCostInput >= 0
                ? toMoney2(unitCostInput)
                : expectedUnitCost;
            const costNoteRaw = String(item?.cost_note ?? '').trim();
            const costNote = costNoteRaw ? costNoteRaw : null;

            await PurchaseOrderItem.create({
                purchase_order_id: po.id,
                product_id: productId,
                qty: qty,
                expected_unit_cost: expectedUnitCost,
                unit_cost: normalizedUnitCost,
                total_cost: qty * normalizedUnitCost,
                received_qty: 0,
                cost_note: toMoney2(normalizedUnitCost) !== toMoney2(expectedUnitCost) ? costNote : null
            }, { transaction: t });
            createdCount += 1;
        }

        if (createdCount <= 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item valid untuk disimpan', 400);
        }

        await t.commit();
        res.status(201).json(po);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error creating PO', 500);
    }
});

export const verifyInboundStep1 = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = req.params.id as string;

        const po = await PurchaseOrder.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!po) {
            await t.rollback();
            throw new CustomError('Purchase Order not found', 404);
        }

        if (po.status === 'received' || po.status === 'canceled') {
            await t.rollback();
            throw new CustomError(`Tidak bisa verifikasi untuk status ${po.status}`, 400);
        }

        if (po.verified1_at) {
            await t.rollback();
            throw new CustomError('Verifikasi langkah 1 sudah dilakukan', 409);
        }

        await po.update({
            status: 'partially_received',
            verified1_by: req.user!.id,
            verified1_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Verifikasi langkah 1 OK', status: po.status });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error verify inbound step 1', 500);
    }
});

export const verifyInboundStep2AndPost = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = req.params.id as string;
        const po = await PurchaseOrder.findByPk(id, {
            include: [{ model: PurchaseOrderItem, as: 'Items' }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!po) {
            await t.rollback();
            throw new CustomError('Purchase Order not found', 404);
        }

        if (po.status === 'received') {
            await t.rollback();
            throw new CustomError('Inbound sudah diposting ke gudang', 409);
        }
        if (po.status === 'canceled') {
            await t.rollback();
            throw new CustomError('Inbound dibatalkan', 400);
        }

        if (!po.verified1_at || !po.verified1_by || po.status !== 'partially_received') {
            await t.rollback();
            throw new CustomError('Wajib Verifikasi langkah 1 terlebih dahulu', 400);
        }

        if (po.verified2_at) {
            await t.rollback();
            throw new CustomError('Verifikasi langkah 2 sudah dilakukan', 409);
        }

        const items = ((po as any).Items || []) as any[];
        if (!Array.isArray(items) || items.length <= 0) {
            await t.rollback();
            throw new CustomError('Inbound tidak memiliki item', 400);
        }

        let postedCount = 0;
        for (const poItem of items) {
            const qty = Number(poItem.qty || 0);
            const receivedQtyOld = Number(poItem.received_qty || 0);
            const delta = Math.max(0, qty - receivedQtyOld);
            if (delta <= 0) continue;

            const productId = String(poItem.product_id);
            const product = await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!product) {
                await t.rollback();
                throw new CustomError(`Produk tidak ditemukan: ${productId}`, 404);
            }

            await poItem.update({ received_qty: qty }, { transaction: t });

            await product.update({
                stock_quantity: Number(product.stock_quantity || 0) + delta
            }, { transaction: t });

            await InventoryCostService.recordInbound({
                product_id: productId,
                qty: delta,
                unit_cost: Number(poItem.unit_cost || product.base_price || 0),
                reference_type: 'inbound_post',
                reference_id: String(po.id),
                note: `Inbound verified #${po.id}`,
                transaction: t
            });

            const expectedUnitCost = Number((poItem as any)?.expected_unit_cost ?? product.base_price ?? 0);
            const actualUnitCost = Number(poItem.unit_cost || product.base_price || 0);
            const varianceNote = Number.isFinite(expectedUnitCost) && Number.isFinite(actualUnitCost) && Math.round(expectedUnitCost * 100) !== Math.round(actualUnitCost * 100)
                ? ` (cost ${actualUnitCost} vs exp ${expectedUnitCost})`
                : '';
            const costReason = String((poItem as any)?.cost_note || '').trim();

            await StockMutation.create({
                product_id: productId,
                type: 'in',
                qty: delta,
                reference_id: `INB-${po.id}`,
                note: `Inbound verified #${po.id}${varianceNote}${costReason ? ` - ${costReason}` : ''}`
            }, { transaction: t });

            postedCount += 1;
        }

        if (postedCount <= 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item yang bisa diposting (sudah diposting semua?)', 409);
        }

        await po.update({
            status: 'received',
            verified2_by: req.user!.id,
            verified2_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Verifikasi langkah 2 OK, stok masuk gudang', status: po.status });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error verify inbound step 2', 500);
    }
});

export const getPurchaseOrders = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, status, supplier_id, startDate, endDate } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const where: any = {};
        if (status) where.status = status;
        if (supplier_id) where.supplier_id = supplier_id;
        if (startDate && endDate) {
            where.createdAt = { [Op.between]: [new Date(String(startDate)), new Date(String(endDate))] };
        }

        const { count, rows } = await PurchaseOrder.findAndCountAll({
            where,
            include: [{ model: Supplier, attributes: ['id', 'name'] }],
            limit: Number(limit),
            offset: Number(offset),
            order: [['createdAt', 'DESC']]
        });

        res.json({
            total: count,
            totalPages: Math.ceil(count / Number(limit)),
            currentPage: Number(page),
            purchaseOrders: rows
        });
    } catch (error) {
        throw new CustomError('Error fetching POs', 500);
    }
});

export const getPurchaseOrderById = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const po = await PurchaseOrder.findByPk(id, {
            include: [
                { model: Supplier, attributes: ['id', 'name'] },
                {
                    model: PurchaseOrderItem,
                    as: 'Items',
                    include: [{ model: Product, attributes: ['id', 'sku', 'name', 'stock_quantity'] }]
                }
            ]
        });

        if (!po) {
            throw new CustomError('Purchase Order not found', 404);
        }

        res.json(po);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error fetching PO detail', 500);
    }
});

export const exportPurchaseOrderExcel = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const po = await PurchaseOrder.findByPk(id, {
            include: [
                { model: Supplier, attributes: ['id', 'name'] },
                {
                    model: PurchaseOrderItem,
                    as: 'Items',
                    include: [{ model: Product, attributes: ['id', 'sku', 'name', 'stock_quantity'] }]
                }
            ]
        });

        if (!po) {
            throw new CustomError('Purchase Order not found', 404);
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Migunani System';
        workbook.created = new Date();

        const sheet = workbook.addWorksheet('Inbound');

        const toDateStr = (d: unknown) => {
            const date = d ? new Date(String(d)) : null;
            return date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19).replace('T', ' ') : '-';
        };

        const supplierName = (po as any)?.Supplier?.name || '-';
        const createdAtStr = toDateStr((po as any)?.createdAt);
        const verified1AtStr = toDateStr((po as any)?.verified1_at);
        const verified2AtStr = toDateStr((po as any)?.verified2_at);
        const status = String((po as any)?.status || '');

        sheet.getRow(1).values = ['Inbound / Purchase Order'];
        sheet.getRow(1).font = { bold: true, size: 14 };

        sheet.getRow(3).values = ['ID', String((po as any).id)];
        sheet.getRow(4).values = ['Supplier', supplierName];
        sheet.getRow(5).values = ['Tanggal Input', createdAtStr];
        sheet.getRow(6).values = ['Status', status];
        sheet.getRow(7).values = ['Verifikasi 1', verified1AtStr];
        sheet.getRow(8).values = ['Verifikasi 2 / Posting', verified2AtStr];
        sheet.getRow(9).values = ['Total Cost', Number((po as any)?.total_cost || 0)];
        sheet.getRow(9).getCell(2).numFmt = '#,##0';

        const headerRowIndex = 11;
        const headers = ['No', 'SKU', 'Produk', 'Qty Input', 'Posted', 'Sisa', 'Modal', 'Total'];
        sheet.getRow(headerRowIndex).values = headers;
        sheet.getRow(headerRowIndex).font = { bold: true };

        const items = Array.isArray((po as any)?.Items) ? ((po as any).Items as any[]) : [];
        items.forEach((item, idx) => {
            const excelRowIndex = headerRowIndex + 1 + idx;
            const qty = Number(item?.qty || 0);
            const receivedQty = Number(item?.received_qty || 0);
            const remaining = Math.max(0, qty - receivedQty);
            const unitCost = Number(item?.unit_cost || 0);
            const totalCost = Number(item?.total_cost || qty * unitCost);

            sheet.getRow(excelRowIndex).values = [
                idx + 1,
                item?.Product?.sku || item?.product_id || '-',
                item?.Product?.name || '-',
                qty,
                receivedQty,
                remaining,
                unitCost,
                totalCost,
            ];

            sheet.getRow(excelRowIndex).getCell(4).numFmt = '#,##0';
            sheet.getRow(excelRowIndex).getCell(5).numFmt = '#,##0';
            sheet.getRow(excelRowIndex).getCell(6).numFmt = '#,##0';
            sheet.getRow(excelRowIndex).getCell(7).numFmt = '#,##0';
            sheet.getRow(excelRowIndex).getCell(8).numFmt = '#,##0';
        });

        sheet.columns = [
            { key: 'no', width: 6 },
            { key: 'sku', width: 18 },
            { key: 'product', width: 44 },
            { key: 'qty', width: 12 },
            { key: 'posted', width: 12 },
            { key: 'remaining', width: 10 },
            { key: 'unit_cost', width: 14 },
            { key: 'total_cost', width: 16 },
        ];

        const timestamp = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
        const shortId = String((po as any).id || '').split('-')[0]?.toUpperCase() || 'INB';
        const fileName = `inbound-${shortId}-${fileSuffix}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error exporting inbound excel', 500);
    }
});

export const receivePurchaseOrder = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = req.params.id as string;
        const { items } = req.body; // Array of { product_id, received_qty, note }

        const po = await PurchaseOrder.findByPk(id, {
            include: [{ model: PurchaseOrderItem, as: 'Items' }],
            transaction: t
        });

        if (!po) {
            await t.rollback();
            throw new CustomError('Purchase Order not found', 404);
        }

        if (po.status === 'received' || po.status === 'canceled') {
            await t.rollback();
            throw new CustomError(`Cannot receive PO with status ${po.status}`, 400);
        }

        if (Array.isArray(items)) {
            for (const item of items) {
                const poItem = (po as any).Items.find((pi: any) => pi.product_id === item.product_id);
                if (!poItem) continue;

                const receivedQty = Number(item.received_qty);
                if (receivedQty <= 0) continue;

                // Update PO Item
                await poItem.update({
                    received_qty: Number(poItem.received_qty || 0) + receivedQty
                }, { transaction: t });

                // Update Product Stock
                const product = await Product.findByPk(item.product_id, { transaction: t });
                if (product) {
                    await product.update({
                        stock_quantity: Number(product.stock_quantity || 0) + receivedQty
                    }, { transaction: t });

                    await InventoryCostService.recordInbound({
                        product_id: item.product_id,
                        qty: receivedQty,
                        unit_cost: Number(poItem.unit_cost || product.base_price || 0),
                        reference_type: 'purchase_order_receive',
                        reference_id: String(po.id),
                        note: item.note || `Inbound PO #${po.id}`,
                        transaction: t
                    });
                }

                // Create Stock Mutation
                await StockMutation.create({
                    product_id: item.product_id,
                    type: 'in',
                    qty: receivedQty,
                    reference_id: `PO-${po.id}`,
                    note: item.note || `Received from PO #${po.id}`
                }, { transaction: t });
            }
        }

        // Update PO status
        const updatedPoItems = await PurchaseOrderItem.findAll({
            where: { purchase_order_id: po.id },
            transaction: t
        });

        const allReceived = updatedPoItems.every(item => Number(item.received_qty) >= Number(item.qty));
        const anyReceived = updatedPoItems.some(item => Number(item.received_qty) > 0);

        let newStatus: any = po.status;
        if (allReceived) {
            newStatus = 'received';
        } else if (anyReceived) {
            newStatus = 'partially_received';
        }

        await po.update({ status: newStatus }, { transaction: t });

        /**
         * KEBIJAKAN ALOKASI MANUAL:
         * Kedatangan stok (inbound PO) secara sengaja TIDAK memicu alokasi otomatis backorder/preorder.
         * Semua penyelesaian kekurangan stok (shortage) wajib melalui proses alokasi manual oleh admin 
         * di dashboard Order Allocation untuk menjaga kontrol penuh administrator.
         */
        await t.commit();
        res.json({ message: 'PO received successfully', status: newStatus });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error receiving PO', 500);
    }
});

export const updateInboundItemCosts = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = String(req.params.id || '').trim();
        const items = req.body?.items;
        if (!Array.isArray(items) || items.length <= 0) {
            await t.rollback();
            throw new CustomError('items wajib diisi (minimal 1 barang)', 400);
        }

        const po = await PurchaseOrder.findByPk(id, {
            include: [{ model: PurchaseOrderItem, as: 'Items' }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!po) {
            await t.rollback();
            throw new CustomError('Purchase Order not found', 404);
        }

        if (po.status !== 'pending' || po.verified1_at) {
            await t.rollback();
            throw new CustomError('Hanya draft inbound (sebelum Verifikasi 1) yang bisa diubah modalnya', 409);
        }

        const toMoney2 = (v: unknown) => {
            const n = Number(v || 0);
            if (!Number.isFinite(n)) return 0;
            return Math.round(n * 100) / 100;
        };

        const poItems = Array.isArray((po as any).Items) ? ((po as any).Items as any[]) : [];
        const itemByProduct = new Map<string, any>();
        poItems.forEach((it: any) => itemByProduct.set(String(it.product_id), it));

        for (const patchItem of items) {
            const productId = String(patchItem?.product_id ?? '').trim();
            if (!productId) continue;
            const poItem = itemByProduct.get(productId);
            if (!poItem) continue;

            const unitCostInput = Number(patchItem?.unit_cost);
            if (!Number.isFinite(unitCostInput) || unitCostInput <= 0) {
                await t.rollback();
                throw new CustomError(`unit_cost wajib > 0 untuk product_id ${productId}`, 400);
            }

            const normalizedUnitCost = toMoney2(unitCostInput);
            let expectedUnitCost = toMoney2((poItem as any)?.expected_unit_cost ?? 0);
            if (expectedUnitCost <= 0) {
                const product = await Product.findByPk(productId, { transaction: t });
                expectedUnitCost = toMoney2((product as any)?.base_price ?? 0);
                if (expectedUnitCost > 0) {
                    await poItem.update({ expected_unit_cost: expectedUnitCost }, { transaction: t });
                }
            }
            const costNoteRaw = String(patchItem?.cost_note ?? '').trim();
            if (toMoney2(normalizedUnitCost) !== toMoney2(expectedUnitCost) && !costNoteRaw) {
                await t.rollback();
                throw new CustomError(`Alasan selisih harga wajib diisi untuk product_id ${productId}`, 400);
            }

            await poItem.update({
                unit_cost: normalizedUnitCost,
                total_cost: Number(poItem.qty || 0) * normalizedUnitCost,
                cost_note: toMoney2(normalizedUnitCost) !== toMoney2(expectedUnitCost) ? costNoteRaw : null
            }, { transaction: t });
        }

        const updatedItems = await PurchaseOrderItem.findAll({ where: { purchase_order_id: po.id }, transaction: t });
        const newTotal = updatedItems.reduce((sum, it) => sum + (Number(it.total_cost || 0)), 0);
        await po.update({ total_cost: Number(toMoney2(newTotal)) }, { transaction: t });

        await t.commit();
        res.json({ message: 'Modal inbound berhasil diperbarui', total_cost: po.total_cost });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error updating inbound item costs', 500);
    }
});
