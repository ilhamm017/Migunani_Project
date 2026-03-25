import fs from 'fs';
import path from 'path';
import multer, { FileFilterCallback } from 'multer';
import { NextFunction, Request, Response } from 'express';
import { CustomError } from './CustomError';

const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp'
]);
const SAFE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SAFE_ATTACHMENT_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.txt', '.csv',
    '.doc', '.docx', '.xls', '.xlsx', '.zip', '.rar'
]);

const normalizeExtension = (originalName: string): string => {
    const extRaw = path.extname(originalName || '').toLowerCase();
    if (!SAFE_EXTENSIONS.has(extRaw)) {
        return '.jpg';
    }
    return extRaw === '.jpeg' ? '.jpg' : extRaw;
};

const ensureDirectory = (dest: string) => {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
};

const normalizeSafeFilenamePart = (value: string): string =>
    String(value || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '') || 'anonymous';

const imageFileFilter = (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const mime = String(file?.mimetype || '').toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mime)) {
        cb(new CustomError('File harus berupa JPG, PNG, atau WEBP', 400));
        return;
    }
    cb(null, true);
};

export const createMemoryImageUpload = (maxSizeBytes = 2 * 1024 * 1024) => multer({
    storage: multer.memoryStorage(),
    fileFilter: imageFileFilter,
    limits: {
        fileSize: maxSizeBytes,
        files: 1,
    }
});

export const createImageUpload = (folderName: string, prefix: string) => multer({
    storage: multer.diskStorage({
        destination: (req, _file, cb) => {
            const userId = normalizeSafeFilenamePart(String(req.user?.id || 'anonymous'));
            const dest = path.join('uploads', userId || 'anonymous', folderName);
            ensureDirectory(dest);
            cb(null, dest);
        },
        filename: (_req, file, cb) => {
            const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            const extension = normalizeExtension(file.originalname);
            cb(null, `${prefix}-${uniqueSuffix}${extension}`);
        }
    }),
    fileFilter: imageFileFilter,
    limits: {
        fileSize: MAX_UPLOAD_SIZE_BYTES,
        files: 1,
    }
});

export const createMultiFieldImageUpload = (
    folderName: string,
    prefixByField: Record<string, string>,
    maxFiles = 10
) => multer({
    storage: multer.diskStorage({
        destination: (req, _file, cb) => {
            const userId = normalizeSafeFilenamePart(String(req.user?.id || 'anonymous'));
            const dest = path.join('uploads', userId || 'anonymous', folderName);
            ensureDirectory(dest);
            cb(null, dest);
        },
        filename: (_req, file, cb) => {
            const field = String(file?.fieldname || '').trim();
            const prefix = prefixByField[field] || prefixByField['*'] || 'upload';
            const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            const extension = normalizeExtension(file.originalname);
            cb(null, `${prefix}-${uniqueSuffix}${extension}`);
        }
    }),
    fileFilter: imageFileFilter,
    limits: {
        fileSize: MAX_UPLOAD_SIZE_BYTES,
        files: maxFiles,
    }
});

type AttachmentUploadOptions = {
    folderName: string;
    prefix: string;
    allowedMimeTypes: string[];
    maxSizeBytes: number;
    fallbackExtension?: string;
    allowedExtensions?: string[];
    resolveOwnerSegment?: (req: Request) => string;
    unsupportedTypeMessage?: string;
};

export const createAttachmentUpload = (options: AttachmentUploadOptions) => {
    const allowedMimeTypes = new Set(options.allowedMimeTypes.map((value) => value.toLowerCase()));
    const fallbackExtension = String(options.fallbackExtension || '.bin').toLowerCase();
    const allowedExtensions = new Set(
        (options.allowedExtensions || Array.from(SAFE_ATTACHMENT_EXTENSIONS)).map((value) => value.toLowerCase())
    );

    return multer({
        storage: multer.diskStorage({
            destination: (req, _file, cb) => {
                const ownerSegment = normalizeSafeFilenamePart(
                    options.resolveOwnerSegment ? options.resolveOwnerSegment(req) : String(req.user?.id || 'anonymous')
                );
                const dest = path.join('uploads', ownerSegment, options.folderName);
                ensureDirectory(dest);
                cb(null, dest);
            },
            filename: (_req, file, cb) => {
                const extRaw = path.extname(file.originalname || '').toLowerCase();
                const ext = allowedExtensions.has(extRaw) ? extRaw : fallbackExtension;
                const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
                cb(null, `${options.prefix}-${uniqueSuffix}${ext}`);
            }
        }),
        fileFilter: (_req, file, cb) => {
            const mime = String(file?.mimetype || '').toLowerCase();
            if (!allowedMimeTypes.has(mime)) {
                cb(new CustomError(options.unsupportedTypeMessage || 'Format file tidak didukung.', 400));
                return;
            }
            cb(null, true);
        },
        limits: {
            fileSize: options.maxSizeBytes,
            files: 1,
        }
    });
};

type SingleUploadMiddlewareOptions = {
    fieldName: string;
    sizeExceededMessage: string;
    fallbackMessage: string;
};

export const createSingleUploadMiddleware = (
    upload: multer.Multer,
    options: SingleUploadMiddlewareOptions
) => {
    return (req: Request, res: Response, next: NextFunction) => {
        upload.single(options.fieldName)(req, res, (err) => {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: options.sizeExceededMessage });
            }
            if (err instanceof Error) {
                return res.status(400).json({ message: err.message || options.fallbackMessage });
            }
            return next();
        });
    };
};

type FieldsUploadMiddlewareOptions = {
    fields: Array<{ name: string; maxCount: number }>;
    sizeExceededMessage: string;
    fallbackMessage: string;
};

export const createFieldsUploadMiddleware = (
    upload: multer.Multer,
    options: FieldsUploadMiddlewareOptions
) => {
    return (req: Request, res: Response, next: NextFunction) => {
        upload.fields(options.fields)(req, res, (err) => {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: options.sizeExceededMessage });
            }
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') {
                return res.status(400).json({ message: 'Terlalu banyak file yang diupload.' });
            }
            if (err instanceof Error) {
                return res.status(400).json({ message: err.message || options.fallbackMessage });
            }
            return next();
        });
    };
};

export const cleanupUploadedFiles = async (req: Request): Promise<void> => {
    const filePaths = new Set<string>();
    const pushCandidate = (value: unknown) => {
        const maybePath = typeof value === 'string' ? value.trim() : '';
        if (!maybePath) return;
        if (!maybePath.startsWith('uploads/')) return;
        filePaths.add(path.resolve(process.cwd(), maybePath));
    };

    if ((req as any).file?.path) {
        pushCandidate((req as any).file.path);
    }

    const files = (req as any).files;
    if (Array.isArray(files)) {
        files.forEach((file: any) => pushCandidate(file?.path));
    } else if (files && typeof files === 'object') {
        Object.values(files).forEach((entry: any) => {
            if (Array.isArray(entry)) {
                entry.forEach((file: any) => pushCandidate(file?.path));
            } else {
                pushCandidate((entry as any)?.path);
            }
        });
    }

    await Promise.all(Array.from(filePaths).map(async (absolutePath) => {
        try {
            await fs.promises.unlink(absolutePath);
        } catch {
            // Ignore missing file or filesystem cleanup failures on best-effort cleanup path.
        }
    }));
};
