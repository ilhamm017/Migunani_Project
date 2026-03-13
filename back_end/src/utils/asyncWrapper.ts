import { Request, Response, NextFunction } from 'express';

type AsyncExpressFunction = (req: Request, res: Response, next: NextFunction) => Promise<any>;

/**
 * Wraps an async controller function to catch exceptions and pass them to the error handling middleware.
 */
export const asyncWrapper = (fn: AsyncExpressFunction) => {
    return (req: Request, res: Response, next: NextFunction) => {
        fn(req, res, next).catch(next);
    };
};
