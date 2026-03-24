import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models';

// Extend Express Request interface to include user property
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                role: string;
                whatsapp_number?: string;
            };
        }
    }
}

const getJwtSecret = (): string => {
    const secret = String(process.env.JWT_SECRET || '').trim();
    if (!secret) {
        throw new Error('JWT_SECRET is required');
    }
    return secret;
};

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, getJwtSecret()) as { id?: string };
        const userId = String(decoded?.id || '').trim();
        if (!userId) {
            // Treat invalid token as unauthenticated so FE can trigger re-login.
            return res.status(401).json({ message: 'Invalid token payload' });
        }

        const dbUser = await User.findByPk(userId, {
            attributes: ['id', 'role', 'status', 'whatsapp_number']
        });
        if (!dbUser) {
            return res.status(401).json({ message: 'User not found' });
        }
        if (String(dbUser.status || '').toLowerCase() !== 'active') {
            return res.status(403).json({ message: 'Account is inactive or banned' });
        }

        req.user = {
            id: String(dbUser.id),
            role: String(dbUser.role),
            whatsapp_number: String(dbUser.whatsapp_number || '')
        };
        next();
    } catch {
        // JWT verification failure => unauthenticated (not authorized).
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

export const authorizeRoles = (...allowedRoles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: 'User not authenticated' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
        }

        next();
    };
};

// Helper for generating tokens (can be used in AuthController later)
export const generateToken = (user: { id: string; role: string; whatsapp_number: string }) => {
    return jwt.sign(user, getJwtSecret(), { expiresIn: '24h' });
};
