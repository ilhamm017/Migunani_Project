import { ReturHandover } from '../models';

export const RETUR_HANDOVER_ATTRS_WITHOUT_DEBT_SNAPSHOT = [
    'id',
    'invoice_id',
    'driver_id',
    'status',
    'submitted_at',
    'received_at',
    'received_by',
    'note',
] as const;

const getSqlMessage = (err: any) =>
    String(err?.original?.sqlMessage || err?.parent?.sqlMessage || err?.message || '');

export const isUnknownColumnError = (err: any, column: string) => {
    const msg = getSqlMessage(err);
    return /unknown column/i.test(msg) && msg.includes(column);
};

export const isMissingDebtSnapshotColumnError = (err: any) =>
    isUnknownColumnError(err, 'driver_debt_before') || isUnknownColumnError(err, 'driver_debt_after');

export const stripDebtSnapshotFields = <T extends Record<string, any>>(values: T): T => {
    const next: any = { ...(values || {}) };
    delete next.driver_debt_before;
    delete next.driver_debt_after;
    return next;
};

export const findAllReturHandoversSafe = async (options: any) => {
    try {
        return await ReturHandover.findAll(options);
    } catch (err: any) {
        if (!isMissingDebtSnapshotColumnError(err)) throw err;
        if (options?.attributes) throw err;
        return await ReturHandover.findAll({
            ...options,
            attributes: [...RETUR_HANDOVER_ATTRS_WITHOUT_DEBT_SNAPSHOT],
        });
    }
};

export const findReturHandoverByPkSafe = async (id: number, options: any) => {
    try {
        return await ReturHandover.findByPk(id, options);
    } catch (err: any) {
        if (!isMissingDebtSnapshotColumnError(err)) throw err;
        if (options?.attributes) throw err;
        return await ReturHandover.findByPk(id, {
            ...options,
            attributes: [...RETUR_HANDOVER_ATTRS_WITHOUT_DEBT_SNAPSHOT],
        });
    }
};

export const updateReturHandoverSafe = async (handover: any, values: any, options: any) => {
    try {
        return await handover.update(values, options);
    } catch (err: any) {
        if (!isMissingDebtSnapshotColumnError(err)) throw err;
        const stripped = stripDebtSnapshotFields(values || {});
        return await handover.update(stripped, options);
    }
};

export const bulkUpdateReturHandoversSafe = async (values: any, options: any) => {
    try {
        return await (ReturHandover as any).update(values, options);
    } catch (err: any) {
        if (!isMissingDebtSnapshotColumnError(err)) throw err;
        const stripped = stripDebtSnapshotFields(values || {});
        const keys = Object.keys(stripped);
        if (keys.length === 0) return [0];
        return await (ReturHandover as any).update(stripped, options);
    }
};
