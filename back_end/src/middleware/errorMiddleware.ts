import { Request, Response, NextFunction } from 'express';
import { CustomError } from '../utils/CustomError';
import { UniqueConstraintError, ValidationError } from 'sequelize';
import { MulterError } from 'multer';
import { cleanupUploadedFiles } from '../utils/uploadPolicy';
import * as crypto from 'crypto';

export const errorMiddleware = async (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    let statusCode = 500;
    let message = 'Internal Server Error';
    let errors = undefined;
    const requestIdFromHeader = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].trim() : '';
    const request_id = requestIdFromHeader || crypto.randomUUID();

    // Log the error for debugging
    console.error(`[Error Handler] [${request_id}] ${req.method} ${req.url} - ${err.name}: ${err.message}`);
    // Print stack + (when available) the underlying SQL details for faster production debugging.
    console.error(err);
    const anyErr = err as any;
    const sql = anyErr?.sql || anyErr?.parent?.sql || anyErr?.original?.sql;
    const sqlMessage = anyErr?.parent?.sqlMessage || anyErr?.original?.sqlMessage;
    if (sqlMessage) console.error(`[SQL Message] ${sqlMessage}`);
    if (sql) console.error(`[SQL] ${sql}`);

    const headerDebugToken = typeof req.headers['x-error-debug-token'] === 'string' ? req.headers['x-error-debug-token'].trim() : '';
    const envDebugToken = String(process.env.ERROR_DEBUG_TOKEN || '').trim();
    const debugTokenOk = (() => {
        if (!envDebugToken || !headerDebugToken) return false;
        const a = Buffer.from(headerDebugToken);
        const b = Buffer.from(envDebugToken);
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    })();
    const adminDebugRequested = String(req.headers['x-admin-debug'] || '').trim() === '1';
    const isSuperAdmin = String((req as any).user?.role || '') === 'super_admin';
    const exposeErrorDetails = process.env.EXPOSE_ERROR_DETAILS === 'true' || debugTokenOk || (adminDebugRequested && isSuperAdmin);
    const exposeSql = process.env.EXPOSE_ERROR_SQL === 'true';

    // Handing our own Custom Errors (Operational errors)
    if (err instanceof CustomError) {
        statusCode = err.statusCode;
        message = err.message;
        errors = err.errors;
    }
    // Handling Sequelize Unique Constraint Errors
    else if (err instanceof UniqueConstraintError) {
        statusCode = 409;
        message = 'Conflict: Duplicate entry found';
        errors = err.errors.map(e => e.message);
    }
    // Handling Sequelize Validation Errors
    else if (err instanceof ValidationError) {
        statusCode = 400;
        message = 'Validation Error';
        errors = err.errors.map(e => e.message);
    }
    else if (err instanceof MulterError) {
        statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        message = err.code === 'LIMIT_FILE_SIZE'
            ? 'Ukuran file melebihi batas maksimal 5MB'
            : `Upload error: ${err.message}`;
    }
    // Add handling for other known third-party errors here
    else {
        // Unexpected system errors
        // In production, you might not want to send the raw error message
        message = process.env.NODE_ENV === 'production'
            ? 'Internal Server Error'
            : err.message || message;
    }

    if (statusCode >= 400) {
        await cleanupUploadedFiles(req);
    }

    res.status(statusCode).json({
        status: 'error',
        statusCode,
        message,
        request_id,
        ...(exposeErrorDetails && {
            debug: {
                name: err.name,
                message: err.message,
                stack: typeof (err as any)?.stack === 'string' ? (err as any).stack.split('\n').slice(0, 20).join('\n') : undefined,
                sqlMessage,
                ...(exposeSql && sql ? { sql: String(sql) } : null),
            }
        }),
        ...(errors && { errors }) // Only include errors array if it exists
    });
};
