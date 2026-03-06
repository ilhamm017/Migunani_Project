export const OPEN_ORDER_STATUSES = [
    'pending',
    'waiting_invoice',
    'ready_to_ship',
    'allocated',
    'partially_fulfilled',
    'debt_pending',
    'hold',
] as const;

export const ALLOWED_TIERS = ['regular', 'gold', 'platinum'] as const;

export type CustomerOtpSession = {
    code: string;
    expiresAt: number;
    resendAvailableAt: number;
    requestedBy: string;
    attempts: number;
};
