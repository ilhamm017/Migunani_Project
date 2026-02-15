
export interface FinanceExpense {
    id: number;
    category: string;
    amount: string; // Decimal is string in JSON
    date: string;
    status: 'requested' | 'approved' | 'rejected' | 'paid';
    note?: string;
    attachment_url?: string;
    created_by: string;
    User: { name: string };
    approved_by?: string;
    paid_at?: string;
}

export interface FinanceJournal {
    id: number;
    date: string;
    description: string;
    reference_id?: string;
    reference_type?: string;
    Lines: Array<{
        id: number;
        account_id: number;
        debit: string;
        credit: string;
        Account: { name: string; code: string };
    }>;
}

export interface FinancePeriod {
    id: number;
    month: number;
    year: number;
    status: 'open' | 'closed';
    closed_at?: string;
    closed_by?: string;
}

export interface ExpenseLabel {
    id: number;
    name: string;
    description?: string;
    account_code?: string; // Future mapping
    requires_approval?: boolean;
}

export interface DriverCodStatus {
    id: string; // User ID
    name: string;
    pending_cod: number;
    invoice_count: number;
    last_settlement?: string;
}

export interface FinanceReportPnL {
    revenue: number;
    cogs: number;
    gross_profit: number;
    expenses: { category: string; amount: number }[];
    total_expense: number;
    net_profit: number;
}
