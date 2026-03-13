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

export const getSuppliers = asyncWrapper(async (_req: Request, res: Response) => {
    try {
        const suppliers = await Supplier.findAll({
            attributes: ['id', 'name', 'contact', 'address'],
            order: [['name', 'ASC']]
        });
        res.json({ suppliers });
    } catch (error) {
        throw new CustomError('Error fetching suppliers', 500);
    }
});

export const createSupplier = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const name = String(req.body?.name || '').trim();
        const contact = String(req.body?.contact || '').trim();
        const address = String(req.body?.address || '').trim();

        if (!name) {
            throw new CustomError('Nama supplier wajib diisi', 400);
        }

        const existingSupplier = await Supplier.findOne({ where: { name } });
        if (existingSupplier) {
            throw new CustomError('Nama supplier sudah digunakan', 400);
        }

        const supplier = await Supplier.create({
            name,
            contact: contact || null,
            address: address || null
        });

        res.status(201).json(supplier);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error creating supplier', 500);
    }
});

export const updateSupplier = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const supplierId = Number(req.params.id);
        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            throw new CustomError('ID supplier tidak valid', 400);
        }

        const supplier = await Supplier.findByPk(supplierId);
        if (!supplier) {
            throw new CustomError('Supplier tidak ditemukan', 404);
        }

        const updates: { name?: string; contact?: string | null; address?: string | null } = {};

        if (req.body?.name !== undefined) {
            const nextName = String(req.body.name).trim();
            if (!nextName) {
                throw new CustomError('Nama supplier wajib diisi', 400);
            }

            const duplicate = await Supplier.findOne({
                where: {
                    name: nextName,
                    id: { [Op.ne]: supplierId }
                }
            });
            if (duplicate) {
                throw new CustomError('Nama supplier sudah digunakan', 400);
            }
            updates.name = nextName;
        }

        if (req.body?.contact !== undefined) {
            const nextContact = String(req.body.contact || '').trim();
            updates.contact = nextContact || null;
        }

        if (req.body?.address !== undefined) {
            const nextAddress = String(req.body.address || '').trim();
            updates.address = nextAddress || null;
        }

        await supplier.update(updates);
        res.json(supplier);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error updating supplier', 500);
    }
});

export const deleteSupplier = asyncWrapper(async (req: Request, res: Response) => {
    const transaction = await sequelize.transaction();
    try {
        const supplierId = Number(req.params.id);
        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            await transaction.rollback();
            throw new CustomError('ID supplier tidak valid', 400);
        }

        const supplier = await Supplier.findByPk(supplierId, { transaction });
        if (!supplier) {
            await transaction.rollback();
            throw new CustomError('Supplier tidak ditemukan', 404);
        }

        const replacementIdRaw = req.body?.replacement_supplier_id;
        const hasReplacement = replacementIdRaw !== undefined && replacementIdRaw !== null && String(replacementIdRaw).trim() !== '';

        if (hasReplacement) {
            const replacementSupplierId = Number(replacementIdRaw);
            if (!Number.isInteger(replacementSupplierId) || replacementSupplierId <= 0) {
                await transaction.rollback();
                throw new CustomError('replacement_supplier_id tidak valid', 400);
            }
            if (replacementSupplierId === supplierId) {
                await transaction.rollback();
                throw new CustomError('Supplier pengganti tidak boleh sama', 400);
            }

            const replacementSupplier = await Supplier.findByPk(replacementSupplierId, { transaction });
            if (!replacementSupplier) {
                await transaction.rollback();
                throw new CustomError('Supplier pengganti tidak ditemukan', 404);
            }

            const [movedCount] = await PurchaseOrder.update(
                { supplier_id: replacementSupplierId },
                { where: { supplier_id: supplierId }, transaction }
            );

            await supplier.destroy({ transaction });
            await transaction.commit();
            return res.json({
                message: 'Supplier berhasil dihapus dan data purchase order dipindahkan',
                moved_purchase_orders: movedCount
            });
        }

        const totalPurchaseOrders = await PurchaseOrder.count({ where: { supplier_id: supplierId }, transaction });
        if (totalPurchaseOrders > 0) {
            await transaction.rollback();
            throw new CustomError(`Supplier masih dipakai ${totalPurchaseOrders} purchase order. Pilih replacement_supplier_id sebelum hapus.`, 400);
        }

        await supplier.destroy({ transaction });
        await transaction.commit();
        return res.json({ message: 'Supplier berhasil dihapus' });
    } catch (error) {
        try { await transaction.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error deleting supplier', 500);
    }
});
