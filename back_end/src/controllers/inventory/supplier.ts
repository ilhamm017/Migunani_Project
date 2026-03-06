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
export const getSuppliers = async (_req: Request, res: Response) => {
    try {
        const suppliers = await Supplier.findAll({
            attributes: ['id', 'name', 'contact', 'address'],
            order: [['name', 'ASC']]
        });
        res.json({ suppliers });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching suppliers', error });
    }
};

export const createSupplier = async (req: Request, res: Response) => {
    try {
        const name = String(req.body?.name || '').trim();
        const contact = String(req.body?.contact || '').trim();
        const address = String(req.body?.address || '').trim();

        if (!name) {
            return res.status(400).json({ message: 'Nama supplier wajib diisi' });
        }

        const existingSupplier = await Supplier.findOne({ where: { name } });
        if (existingSupplier) {
            return res.status(400).json({ message: 'Nama supplier sudah digunakan' });
        }

        const supplier = await Supplier.create({
            name,
            contact: contact || null,
            address: address || null
        });

        res.status(201).json(supplier);
    } catch (error) {
        res.status(500).json({ message: 'Error creating supplier', error });
    }
};

export const updateSupplier = async (req: Request, res: Response) => {
    try {
        const supplierId = Number(req.params.id);
        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            return res.status(400).json({ message: 'ID supplier tidak valid' });
        }

        const supplier = await Supplier.findByPk(supplierId);
        if (!supplier) {
            return res.status(404).json({ message: 'Supplier tidak ditemukan' });
        }

        const updates: { name?: string; contact?: string | null; address?: string | null } = {};

        if (req.body?.name !== undefined) {
            const nextName = String(req.body.name).trim();
            if (!nextName) {
                return res.status(400).json({ message: 'Nama supplier wajib diisi' });
            }

            const duplicate = await Supplier.findOne({
                where: {
                    name: nextName,
                    id: { [Op.ne]: supplierId }
                }
            });
            if (duplicate) {
                return res.status(400).json({ message: 'Nama supplier sudah digunakan' });
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
        res.status(500).json({ message: 'Error updating supplier', error });
    }
};

export const deleteSupplier = async (req: Request, res: Response) => {
    const transaction = await sequelize.transaction();
    try {
        const supplierId = Number(req.params.id);
        if (!Number.isInteger(supplierId) || supplierId <= 0) {
            await transaction.rollback();
            return res.status(400).json({ message: 'ID supplier tidak valid' });
        }

        const supplier = await Supplier.findByPk(supplierId, { transaction });
        if (!supplier) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Supplier tidak ditemukan' });
        }

        const replacementIdRaw = req.body?.replacement_supplier_id;
        const hasReplacement = replacementIdRaw !== undefined && replacementIdRaw !== null && String(replacementIdRaw).trim() !== '';

        if (hasReplacement) {
            const replacementSupplierId = Number(replacementIdRaw);
            if (!Number.isInteger(replacementSupplierId) || replacementSupplierId <= 0) {
                await transaction.rollback();
                return res.status(400).json({ message: 'replacement_supplier_id tidak valid' });
            }
            if (replacementSupplierId === supplierId) {
                await transaction.rollback();
                return res.status(400).json({ message: 'Supplier pengganti tidak boleh sama' });
            }

            const replacementSupplier = await Supplier.findByPk(replacementSupplierId, { transaction });
            if (!replacementSupplier) {
                await transaction.rollback();
                return res.status(404).json({ message: 'Supplier pengganti tidak ditemukan' });
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
            return res.status(400).json({
                message: `Supplier masih dipakai ${totalPurchaseOrders} purchase order. Pilih replacement_supplier_id sebelum hapus.`
            });
        }

        await supplier.destroy({ transaction });
        await transaction.commit();
        return res.json({ message: 'Supplier berhasil dihapus' });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ message: 'Error deleting supplier', error });
    }
};
