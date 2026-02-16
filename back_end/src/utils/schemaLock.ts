import { Sequelize } from 'sequelize';

export type SchemaLockErrorCode =
    | 'SCHEMA_LOCK_TIMEOUT'
    | 'SCHEMA_LOCK_ACQUIRE_FAILED'
    | 'SCHEMA_LOCK_RELEASE_FAILED';

export class SchemaLockError extends Error {
    code: SchemaLockErrorCode;

    constructor(code: SchemaLockErrorCode, message: string) {
        super(message);
        this.name = 'SchemaLockError';
        this.code = code;
    }
}

export interface SchemaLockHandle {
    lockName: string;
    release: () => Promise<void>;
}

const parseTimeoutSec = (): number => {
    const raw = process.env.DB_SCHEMA_LOCK_TIMEOUT_SEC;
    const parsed = Number(raw ?? '30');
    if (!Number.isFinite(parsed) || parsed <= 0) return 30;
    return Math.floor(parsed);
};

const resolveLockName = (): string => {
    const lockName = String(process.env.DB_SCHEMA_LOCK_NAME || '').trim();
    return lockName || 'migunani_schema_lock';
};

export const acquireSchemaLock = async (
    sequelize: Sequelize,
    options?: { lockName?: string; timeoutSec?: number }
): Promise<SchemaLockHandle> => {
    const lockName = options?.lockName || resolveLockName();
    const timeoutSec = options?.timeoutSec ?? parseTimeoutSec();
    const transaction = await sequelize.transaction();

    try {
        const [rows] = await sequelize.query(
            'SELECT GET_LOCK(:lockName, :timeoutSec) AS lockStatus',
            {
                transaction,
                replacements: {
                    lockName,
                    timeoutSec
                }
            }
        ) as any;

        const lockStatus = rows?.[0]?.lockStatus;
        if (lockStatus !== 1) {
            if (lockStatus === 0) {
                throw new SchemaLockError(
                    'SCHEMA_LOCK_TIMEOUT',
                    `Schema lock '${lockName}' is busy. Another schema operation is running.`
                );
            }
            throw new SchemaLockError(
                'SCHEMA_LOCK_ACQUIRE_FAILED',
                `Failed to acquire schema lock '${lockName}'.`
            );
        }
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    return {
        lockName,
        release: async () => {
            try {
                const [releaseRows] = await sequelize.query(
                    'SELECT RELEASE_LOCK(:lockName) AS releaseStatus',
                    {
                        transaction,
                        replacements: {
                            lockName
                        }
                    }
                ) as any;

                const releaseStatus = releaseRows?.[0]?.releaseStatus;
                if (releaseStatus !== 1) {
                    throw new SchemaLockError(
                        'SCHEMA_LOCK_RELEASE_FAILED',
                        `Failed to release schema lock '${lockName}'.`
                    );
                }
            } finally {
                await transaction.rollback();
            }
        }
    };
};
