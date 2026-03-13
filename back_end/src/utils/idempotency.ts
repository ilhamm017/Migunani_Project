import { Request } from 'express';
import { Op, UniqueConstraintError } from 'sequelize';
import { IdempotencyKey } from '../models';

type Entry = {
    scope: string;
    status: 'in_progress' | 'done';
    createdAt: Date;
    statusCode?: number;
    payload?: unknown;
};

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let lastCleanupAt = 0;

const normalizeKey = (value: unknown): string => String(value || '').trim();
const nextExpiryDate = () => new Date(Date.now() + CACHE_TTL_MS);

export const getIdempotencyKey = (req: Request): string => {
    const headerKey = req.headers['idempotency-key'];
    if (Array.isArray(headerKey)) {
        return normalizeKey(headerKey[0]);
    }
    return normalizeKey(headerKey);
};

const maybeCleanupExpiredKeys = async () => {
    const now = Date.now();
    if (now - lastCleanupAt < 60_000) return;
    lastCleanupAt = now;
    await IdempotencyKey.destroy({
        where: {
            expires_at: { [Op.lt]: new Date(now) },
            status: 'done',
        }
    });
};

const toDecisionFromRow = (
    row: Entry,
    now: Date
): { action: 'proceed' | 'replay' | 'conflict'; statusCode?: number; payload?: unknown } => {
    if (row.status === 'done' && row.createdAt.getTime() > now.getTime()) {
        return {
            action: 'replay',
            statusCode: Number(row.statusCode || 200),
            payload: row.payload
        };
    }
    if (row.status === 'in_progress' && row.createdAt.getTime() > now.getTime()) {
        return { action: 'conflict' };
    }
    return { action: 'proceed' };
};

export const beginIdempotentRequest = async (
    key: string,
    scope: string
): Promise<{ action: 'proceed' | 'replay' | 'conflict'; statusCode?: number; payload?: unknown }> => {
    if (!key) return { action: 'proceed' };
    await maybeCleanupExpiredKeys();

    const now = new Date();
    const newExpiry = nextExpiryDate();
    try {
        await IdempotencyKey.create({
            idempotency_key: key,
            scope,
            status: 'in_progress',
            expires_at: newExpiry
        });
        return { action: 'proceed' };
    } catch (error) {
        if (!(error instanceof UniqueConstraintError)) {
            throw error;
        }
    }

    const existing = await IdempotencyKey.findOne({ where: { idempotency_key: key } });
    if (!existing) return { action: 'conflict' };
    if (String(existing.scope || '') !== scope) {
        return { action: 'conflict' };
    }

    const existingStatus = String(existing.status || 'in_progress') as 'in_progress' | 'done';
    const existingExpiry = existing.expires_at ? new Date(existing.expires_at) : now;
    const decision = toDecisionFromRow({
        scope: String(existing.scope || ''),
        status: existingStatus,
        createdAt: existingExpiry,
        statusCode: existing.status_code ? Number(existing.status_code) : undefined,
        payload: existing.response_payload || undefined
    }, now);

    if (decision.action !== 'proceed') {
        return decision;
    }

    const [updated] = await IdempotencyKey.update({
        status: 'in_progress',
        status_code: null,
        response_payload: null,
        expires_at: newExpiry,
    }, {
        where: {
            id: String(existing.id),
            scope,
            expires_at: existingExpiry,
        }
    });
    if (updated === 1) {
        return { action: 'proceed' };
    }

    const latest = await IdempotencyKey.findOne({ where: { idempotency_key: key } });
    if (!latest || String(latest.scope || '') !== scope) {
        return { action: 'conflict' };
    }
    const latestStatus = String(latest.status || 'in_progress') as 'in_progress' | 'done';
    const latestExpiry = latest.expires_at ? new Date(latest.expires_at) : now;
    if (latestStatus === 'done' && latestExpiry.getTime() > now.getTime()) {
        return {
            action: 'replay',
            statusCode: Number(latest.status_code || 200),
            payload: latest.response_payload || undefined,
        };
    }

    return { action: 'conflict' };
};

export const commitIdempotentRequest = async (key: string, scope: string, statusCode: number, payload: unknown) => {
    if (!key) return;
    await IdempotencyKey.update({
        status: 'done',
        status_code: Number(statusCode || 200),
        response_payload: (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : { value: payload as unknown },
        expires_at: nextExpiryDate(),
    }, {
        where: {
            idempotency_key: key,
            scope,
            status: 'in_progress'
        }
    });
};

export const clearIdempotentRequest = async (key: string, scope: string) => {
    if (!key) return;
    await IdempotencyKey.destroy({
        where: {
            idempotency_key: key,
            scope,
            status: 'in_progress'
        }
    });
};
