import { NextFunction, Request, Response } from 'express';
import { AuditLog } from '../models';

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_KEYS = new Set([
    'password',
    'token',
    'authorization',
    'payment_proof_url',
    'delivery_proof_url',
    'proof',
    'otp_code'
]);

const truncateText = (value: string, maxLength: number) => {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
};

const sanitizeValue = (value: unknown, depth = 0): unknown => {
    if (value === null || value === undefined) return value;
    if (depth > 3) return '[depth_limited]';
    if (typeof value === 'string') return truncateText(value, 400);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).slice(0, 30);
        return entries.reduce<Record<string, unknown>>((acc, [key, nestedValue]) => {
            if (SENSITIVE_KEYS.has(String(key).toLowerCase())) {
                acc[key] = '[redacted]';
                return acc;
            }
            acc[key] = sanitizeValue(nestedValue, depth + 1);
            return acc;
        }, {});
    }
    return String(value);
};

const buildActionLabel = (method: string, path: string) => {
    const cleanPath = String(path || '').replace(/^\/api\/v1\//, '').replace(/\/+/g, '/').replace(/^\//, '');
    return `${method.toUpperCase()} ${cleanPath || '/'}`;
};

const shouldAudit = (req: Request) => {
    if (!AUDITED_METHODS.has(String(req.method || '').toUpperCase())) return false;
    const path = String(req.originalUrl || req.path || '');
    if (!path.startsWith('/api/v1/')) return false;
    if (path.startsWith('/api/v1/chat') || path.startsWith('/api/v1/whatsapp')) return false;
    return true;
};

export const auditLogMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (!shouldAudit(req)) {
        next();
        return;
    }

    let responsePayload: unknown = null;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
        responsePayload = body;
        return originalJson(body);
    }) as Response['json'];

    res.on('finish', () => {
        const statusCode = Number(res.statusCode || 0);
        const actorUserId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;
        const ipAddress = truncateText(String(req.ip || req.socket?.remoteAddress || ''), 64) || null;
        const userAgent = truncateText(String(req.get('user-agent') || ''), 255) || null;
        const requestPayload = sanitizeValue({
            params: req.params || {},
            query: req.query || {},
            body: req.body || {},
            file: req.file ? {
                fieldname: req.file.fieldname,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
                filename: req.file.filename,
            } : null,
        });
        const safeResponsePayload = sanitizeValue(responsePayload);
        const errorMessage = typeof (responsePayload as any)?.message === 'string' && statusCode >= 400
            ? truncateText(String((responsePayload as any).message), 1000)
            : null;

        void AuditLog.create({
            actor_user_id: actorUserId,
            actor_role: actorRole,
            method: String(req.method || '').toUpperCase(),
            path: truncateText(String(req.originalUrl || req.path || ''), 255),
            action: truncateText(buildActionLabel(String(req.method || ''), String(req.route?.path || req.path || req.originalUrl || '')), 255),
            status_code: statusCode,
            success: statusCode >= 200 && statusCode < 400,
            ip_address: ipAddress,
            user_agent: userAgent,
            request_payload: requestPayload,
            response_payload: safeResponsePayload,
            error_message: errorMessage,
        }).catch((error) => {
            console.error('[AuditLog] Failed to persist audit log:', error);
        });
    });

    next();
};
