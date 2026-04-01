export const FINAL_ORDER_STATUSES = new Set(['delivered', 'completed', 'partially_fulfilled', 'canceled', 'cancelled']);
export const COURIER_OWNERSHIP_REQUIRED_STATUSES = new Set(['ready_to_ship', 'checked', 'shipped']);
export const isDeadlockError = (error: any): boolean => {
    const code = error?.parent?.code || error?.original?.code || error?.code;
    return code === 'ER_LOCK_DEADLOCK';
};
