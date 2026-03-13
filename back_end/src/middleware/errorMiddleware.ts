import { Request, Response, NextFunction } from 'express';
import { CustomError } from '../utils/CustomError';
import { UniqueConstraintError, ValidationError } from 'sequelize';
import { MulterError } from 'multer';
import { cleanupUploadedFiles } from '../utils/uploadPolicy';

export const errorMiddleware = async (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    let statusCode = 500;
    let message = 'Internal Server Error';
    let errors = undefined;

    // Log the error for debugging
    console.error(`[Error Handler] ${req.method} ${req.url} - ${err.name}: ${err.message}`);

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
        ...(errors && { errors }) // Only include errors array if it exists
    });
};
