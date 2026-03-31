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
                whatsapp_number?: string | null;
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
            whatsapp_number: dbUser.whatsapp_number ?? null
        };
        next();
    } catch {
        // JWT verification failure => unauthenticated (not authorized).
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

// Optional authentication: if no token is present, continue as guest.
// If a token is present but invalid/expired, it returns 401 (so FE can clear session).
export const authenticateTokenOptional = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return next();
    }
    return authenticateToken(req, res, next);
};

// Stateless auth that does not hit DB (use sparingly for endpoints that must stay responsive even if DB is slow).
// It trusts the signed JWT payload, so user role/status changes won't take effect until token expiry.
export const authenticateTokenStateless = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, getJwtSecret()) as {
            id?: string;
            role?: string;
            whatsapp_number?: string | null;
        };

        const userId = String(decoded?.id || '').trim();
        const role = String(decoded?.role || '').trim();
        if (!userId || !role) {
            return res.status(401).json({ message: 'Invalid token payload' });
        }

        req.user = {
            id: userId,
            role,
            whatsapp_number: typeof decoded.whatsapp_number === 'string' ? decoded.whatsapp_number : null
        };

        next();
    } catch {
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
export const generateToken = (user: { id: string; role: string; whatsapp_number?: string | null }) => {
    const whatsapp = typeof user.whatsapp_number === 'string' ? user.whatsapp_number.trim() : '';
    const payload = whatsapp
        ? { id: user.id, role: user.role, whatsapp_number: whatsapp }
        : { id: user.id, role: user.role };
    return jwt.sign(payload, getJwtSecret(), { expiresIn: '24h' });
};
