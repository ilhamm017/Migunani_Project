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
        const supplierId = Number(req.body?.supplier_id);
        const totalCost = Number(req.body?.total_cost);

        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            await t.rollback();
            throw new CustomError('supplier_id tidak valid', 400);
        }
        if (!Number.isFinite(totalCost) || totalCost < 0) {
            await t.rollback();
            throw new CustomError('total_cost tidak valid', 400);
        }

        const supplier = await Supplier.findByPk(supplierId, { transaction: t });
        if (!supplier) {
            await t.rollback();
            throw new CustomError('Supplier tidak ditemukan', 404);
        }

        const po = await PurchaseOrder.create({
            supplier_id: supplierId,
            status: 'pending',
            total_cost: totalCost,
            created_by: req.user!.id
        }, { transaction: t });

        const items = req.body?.items;
        if (Array.isArray(items) && items.length > 0) {
            for (const item of items) {
                const qty = Number(item.qty);
                const unitCost = Number(item.unit_cost);
                if (qty > 0 && unitCost >= 0) {
                    await PurchaseOrderItem.create({
                        purchase_order_id: po.id,
                        product_id: item.product_id,
                        qty: qty,
                        unit_cost: unitCost,
                        total_cost: qty * unitCost,
                        received_qty: 0
                    }, { transaction: t });
                }
            }
        }

        await t.commit();
        res.status(201).json(po);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error creating PO', 500);
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
