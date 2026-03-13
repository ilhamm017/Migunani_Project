export class CustomError extends Error {
    public statusCode: number;
    public isOperational: boolean;
    public errors?: string[];

    constructor(message: string, statusCode: number, errors?: string[]) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true; // Indicates this is an expected business/validation error
        this.errors = errors;

        // Capture stack trace, excluding constructor call from it
        Error.captureStackTrace(this, this.constructor);
    }
}
