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
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const importProductsFromUpload = asyncWrapper(async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            throw new CustomError('File wajib diunggah', 400);
        }

        if (!isSupportedImportFile(req.file.originalname)) {
            throw new CustomError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400);
        }

        const result = await runInventoryImportFromBuffer(req.file.buffer, req.file.originalname);
        res.json({
            message: 'Import selesai',
            summary: result.summary,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Import gagal';
        throw new CustomError(message, resolveImportErrorStatus(message));
    }
});

export const previewProductsImportFromUpload = asyncWrapper(async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            throw new CustomError('File wajib diunggah', 400);
        }

        if (!isSupportedImportFile(req.file.originalname)) {
            throw new CustomError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400);
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
        throw new CustomError(message, resolveImportErrorStatus(message));
    }
});

export const commitProductsImport = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { rows } = req.body as { rows?: unknown[] };
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new CustomError('rows wajib diisi dan tidak boleh kosong', 400);
        }

        const result = await runInventoryImportFromRowsPayload(rows);
        res.json({
            message: 'Import selesai',
            summary: result.summary,
            errors: result.errors
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Commit import gagal';
        throw new CustomError(message, resolveImportErrorStatus(message));
    }
});

export const importProductsFromPath = asyncWrapper(async (req: Request, res: Response) => {
    try {
        if (process.env.IMPORT_LOCAL_PATH_ENABLED !== 'true') {
            throw new CustomError('Import local path tidak diaktifkan', 403);
        }

        const { file_path } = req.body as { file_path?: string };
        if (!file_path || typeof file_path !== 'string') {
            throw new CustomError('file_path wajib diisi', 400);
        }

        const resolvedPath = path.resolve(file_path);
        if (!isSupportedImportFile(resolvedPath)) {
            throw new CustomError('Format file tidak didukung. Gunakan .xlsx, .xls, atau .csv', 400);
        }

        try {
            const stat = await fs.stat(resolvedPath);
            if (!stat.isFile()) {
                throw new CustomError('file_path harus mengarah ke file', 400);
            }
        } catch {
            throw new CustomError('File pada file_path tidak ditemukan', 400);
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
                throw new CustomError('Akses path ditolak oleh allowlist import', 403);
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
        throw new CustomError(message, resolveImportErrorStatus(message));
    }
});
