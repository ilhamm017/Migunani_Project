export class CustomError extends Error {
    public statusCode: number;
    public isOperational: boolean;
    public errors?: string[];
    public data?: unknown;

    constructor(message: string, statusCode: number, errors?: string[], data?: unknown) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true; // Indicates this is an expected business/validation error
        this.errors = errors;
        this.data = data;

        // Capture stack trace, excluding constructor call from it
        Error.captureStackTrace(this, this.constructor);
    }
}
