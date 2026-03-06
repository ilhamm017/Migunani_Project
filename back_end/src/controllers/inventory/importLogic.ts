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
import { runInventoryImportFromPath, runInventoryPreviewFromBuffer, isSupportedImportFile, resolveImportErrorStatus, runInventoryImportFromBuffer, runInventoryImportFromRowsPayload } from './utils';
export const importProductsFromUpload = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'File wajib diunggah' });
        }

        if (!isSupportedImportFile(req.file.originalname)) {
            return res.status(400).json({ message: 'Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv' });
        }

        const result = await runInventoryImportFromBuffer(req.file.buffer, req.file.originalname);
        res.json({
            message: 'Import selesai',
            summary: result.summary,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Import gagal';
        res.status(resolveImportErrorStatus(message)).json({ message, error });
    }
};

export const previewProductsImportFromUpload = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'File wajib diunggah' });
        }

        if (!isSupportedImportFile(req.file.originalname)) {
            return res.status(400).json({ message: 'Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv' });
        }

        const result = await runInventoryPreviewFromBuffer(req.file.buffer, req.file.originalname);
        res.json({
            message: 'Preview siap. Periksa dan edit data sebelum commit.',
            summary: result.summary,
            rows: result.rows,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Preview import gagal';
        res.status(resolveImportErrorStatus(message)).json({ message, error });
    }
};

export const commitProductsImport = async (req: Request, res: Response) => {
    try {
        const { rows } = req.body as { rows?: unknown[] };
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ message: 'rows wajib diisi dan tidak boleh kosong' });
        }

        const result = await runInventoryImportFromRowsPayload(rows);
        res.json({
            message: 'Import selesai',
            summary: result.summary,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Commit import gagal';
        res.status(resolveImportErrorStatus(message)).json({ message, error });
    }
};

export const importProductsFromPath = async (req: Request, res: Response) => {
    try {
        if (process.env.IMPORT_LOCAL_PATH_ENABLED !== 'true') {
            return res.status(403).json({ message: 'Import local path tidak diaktifkan' });
        }

        const { file_path } = req.body as { file_path?: string };
        if (!file_path || typeof file_path !== 'string') {
            return res.status(400).json({ message: 'file_path wajib diisi' });
        }

        const resolvedPath = path.resolve(file_path);
        if (!isSupportedImportFile(resolvedPath)) {
            return res.status(400).json({ message: 'Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv' });
        }

        try {
            const stat = await fs.stat(resolvedPath);
            if (!stat.isFile()) {
                return res.status(400).json({ message: 'file_path harus mengarah ke file' });
            }
        } catch {
            return res.status(400).json({ message: 'File pada file_path tidak ditemukan' });
        }

        const allowedRoots = (process.env.IMPORT_LOCAL_PATH_ALLOWLIST || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => path.resolve(value));

        if (allowedRoots.length > 0) {
            const isAllowedPath = allowedRoots.some((rootPath) =>
                resolvedPath === rootPath || resolvedPath.startsWith(`${rootPath}${path.sep}`)
            );
            if (!isAllowedPath) {
                return res.status(403).json({ message: 'Akses path ditolak oleh allowlist import' });
            }
        }

        const result = await runInventoryImportFromPath(resolvedPath);
        res.json({
            message: 'Import selesai',
            summary: result.summary,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Import gagal';
        res.status(resolveImportErrorStatus(message)).json({ message, error });
    }
};
