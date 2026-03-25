import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { Op } from 'sequelize';
import { Product, Supplier, SupplierPreorder, SupplierPreorderItem, sequelize } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

const parseIntOrNull = (value: unknown) => {
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
};

export const createSupplierPreorder = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const supplierId = parseIntOrNull(req.body?.supplier_id);
        if (!supplierId || supplierId <= 0) {
            await t.rollback();
            throw new CustomError('supplier_id wajib diisi dan valid', 400);
        }

        const supplier = await Supplier.findByPk(supplierId, { transaction: t });
        if (!supplier) {
            await t.rollback();
            throw new CustomError('Supplier tidak ditemukan', 404);
        }

        const notes = String(req.body?.notes ?? '').trim() || null;
        const itemsRaw = req.body?.items;
        if (!Array.isArray(itemsRaw) || itemsRaw.length <= 0) {
            await t.rollback();
            throw new CustomError('items wajib diisi (minimal 1 barang)', 400);
        }

        const merged = new Map<string, { qty: number; note: string | null }>();
        for (const item of itemsRaw) {
            const productId = String(item?.product_id ?? '').trim();
            const qty = Number(item?.qty);
            const note = String(item?.note ?? '').trim() || null;
            if (!productId) continue;
            if (!Number.isFinite(qty) || qty <= 0) continue;
            const existing = merged.get(productId);
            if (existing) {
                existing.qty += qty;
                if (note) existing.note = note;
            } else {
                merged.set(productId, { qty, note });
            }
        }

        if (merged.size <= 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item valid untuk disimpan', 400);
        }

        // Validate products exist before creating preorder
        for (const productId of merged.keys()) {
            const product = await Product.findByPk(productId, { transaction: t });
            if (!product) {
                await t.rollback();
                throw new CustomError(`Produk tidak ditemukan: ${productId}`, 404);
            }
        }

        const preorder = await SupplierPreorder.create(
            {
                supplier_id: supplierId,
                status: 'draft',
                notes,
                created_by: req.user!.id,
            },
            { transaction: t }
        );

        for (const [productId, data] of merged.entries()) {
            await SupplierPreorderItem.create(
                {
                    supplier_preorder_id: preorder.id,
                    product_id: productId,
                    qty: data.qty,
                    note: data.note,
                },
                { transaction: t }
            );
        }

        await t.commit();
        res.status(201).json(preorder);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error creating supplier preorder', 500);
    }
});

export const listSupplierPreorders = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, status, supplier_id, startDate, endDate } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const where: any = {};
        if (status) where.status = status;
        if (supplier_id) where.supplier_id = supplier_id;
        if (startDate && endDate) {
            where.createdAt = { [Op.between]: [new Date(String(startDate)), new Date(String(endDate))] };
        }

        const { count, rows } = await SupplierPreorder.findAndCountAll({
            where,
            include: [{ model: Supplier, as: 'Supplier', attributes: ['id', 'name'] }],
            limit: Number(limit),
            offset: Number(offset),
            order: [['createdAt', 'DESC']]
        });

        res.json({
            total: count,
            totalPages: Math.ceil(count / Number(limit)),
            currentPage: Number(page),
            preorders: rows
        });
    } catch {
        throw new CustomError('Error fetching supplier preorders', 500);
    }
});

export const getSupplierPreorderById = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id || '').trim();
        const preorder = await SupplierPreorder.findByPk(id, {
            include: [
                { model: Supplier, as: 'Supplier', attributes: ['id', 'name'] },
                {
                    model: SupplierPreorderItem,
                    as: 'Items',
                    include: [{ model: Product, as: 'Product', attributes: ['id', 'sku', 'name', 'stock_quantity', 'min_stock'] }]
                }
            ]
        });

        if (!preorder) {
            throw new CustomError('Supplier preorder not found', 404);
        }

        res.json(preorder);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error fetching supplier preorder detail', 500);
    }
});

export const updateSupplierPreorder = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = String(req.params.id || '').trim();
        const preorder = await SupplierPreorder.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!preorder) {
            await t.rollback();
            throw new CustomError('Supplier preorder not found', 404);
        }
        if (preorder.status !== 'draft') {
            await t.rollback();
            throw new CustomError('Preorder sudah difinalisasi / tidak bisa diubah', 409);
        }

        const notes = req.body?.notes !== undefined ? (String(req.body?.notes ?? '').trim() || null) : undefined;
        if (notes !== undefined) {
            await preorder.update({ notes }, { transaction: t });
        }

        if (req.body?.items !== undefined) {
            const itemsRaw = req.body?.items;
            if (!Array.isArray(itemsRaw) || itemsRaw.length <= 0) {
                await t.rollback();
                throw new CustomError('items wajib diisi (minimal 1 barang)', 400);
            }

            const merged = new Map<string, { qty: number; note: string | null }>();
            for (const item of itemsRaw) {
                const productId = String(item?.product_id ?? '').trim();
                const qty = Number(item?.qty);
                const note = String(item?.note ?? '').trim() || null;
                if (!productId) continue;
                if (!Number.isFinite(qty) || qty <= 0) continue;
                const existing = merged.get(productId);
                if (existing) {
                    existing.qty += qty;
                    if (note) existing.note = note;
                } else {
                    merged.set(productId, { qty, note });
                }
            }

            if (merged.size <= 0) {
                await t.rollback();
                throw new CustomError('Tidak ada item valid untuk disimpan', 400);
            }

            for (const productId of merged.keys()) {
                const product = await Product.findByPk(productId, { transaction: t });
                if (!product) {
                    await t.rollback();
                    throw new CustomError(`Produk tidak ditemukan: ${productId}`, 404);
                }
            }

            await SupplierPreorderItem.destroy({ where: { supplier_preorder_id: preorder.id }, transaction: t });
            for (const [productId, data] of merged.entries()) {
                await SupplierPreorderItem.create(
                    {
                        supplier_preorder_id: preorder.id,
                        product_id: productId,
                        qty: data.qty,
                        note: data.note,
                    },
                    { transaction: t }
                );
            }
        }

        await t.commit();
        res.json({ message: 'Preorder updated', id: preorder.id });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error updating supplier preorder', 500);
    }
});

export const finalizeSupplierPreorder = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = String(req.params.id || '').trim();
        const preorder = await SupplierPreorder.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!preorder) {
            await t.rollback();
            throw new CustomError('Supplier preorder not found', 404);
        }
        if (preorder.status !== 'draft') {
            await t.rollback();
            throw new CustomError('Preorder sudah difinalisasi / tidak bisa difinalisasi ulang', 409);
        }

        const itemsCount = await SupplierPreorderItem.count({ where: { supplier_preorder_id: preorder.id }, transaction: t });
        if (itemsCount <= 0) {
            await t.rollback();
            throw new CustomError('Preorder tidak memiliki item', 400);
        }

        await preorder.update(
            {
                status: 'finalized',
                finalized_by: req.user!.id,
                finalized_at: new Date(),
            },
            { transaction: t }
        );

        await t.commit();
        res.json({ message: 'Preorder finalized', status: preorder.status });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error finalizing supplier preorder', 500);
    }
});

export const exportSupplierPreorderXlsx = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id || '').trim();
        const preorder = await SupplierPreorder.findByPk(id, {
            include: [
                { model: Supplier, as: 'Supplier', attributes: ['id', 'name'] },
                {
                    model: SupplierPreorderItem,
                    as: 'Items',
                    include: [{ model: Product, as: 'Product', attributes: ['id', 'sku', 'name'] }]
                }
            ]
        });

        if (!preorder) {
            throw new CustomError('Supplier preorder not found', 404);
        }
        if ((preorder as any).status !== 'finalized') {
            throw new CustomError('Preorder harus finalize dulu sebelum export', 409);
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Migunani System';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('PO Supplier');

        const supplierName = (preorder as any)?.Supplier?.name || '-';
        const createdAt = (preorder as any)?.createdAt ? new Date(String((preorder as any).createdAt)) : null;
        const createdAtStr = createdAt && Number.isFinite(createdAt.getTime())
            ? createdAt.toISOString().slice(0, 19).replace('T', ' ')
            : '-';

        sheet.getRow(1).values = ['PO (PreOrder Supplier)'];
        sheet.getRow(1).font = { bold: true, size: 14 };

        sheet.getRow(3).values = ['ID', String((preorder as any).id)];
        sheet.getRow(4).values = ['Supplier', supplierName];
        sheet.getRow(5).values = ['Tanggal', createdAtStr];
        sheet.getRow(6).values = ['Status', String((preorder as any).status || '')];

        const headerRowIndex = 8;
        sheet.getRow(headerRowIndex).values = ['No', 'SKU', 'Produk', 'Qty'];
        sheet.getRow(headerRowIndex).font = { bold: true };

        const items = Array.isArray((preorder as any)?.Items) ? ((preorder as any).Items as any[]) : [];
        items.forEach((item, idx) => {
            const row = sheet.getRow(headerRowIndex + 1 + idx);
            row.values = [
                idx + 1,
                item?.Product?.sku || item?.product_id || '-',
                item?.Product?.name || '-',
                Number(item?.qty || 0),
            ];
        });

        sheet.columns = [
            { key: 'no', width: 6 },
            { key: 'sku', width: 18 },
            { key: 'product', width: 44 },
            { key: 'qty', width: 12 },
        ];

        const timestamp = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
        const shortId = String((preorder as any).id || '').split('-')[0]?.toUpperCase() || 'PO';
        const fileName = `po-supplier-${shortId}-${fileSuffix}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error exporting preorder xlsx', 500);
    }
});

