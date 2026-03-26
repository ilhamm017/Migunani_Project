import { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { CustomerBalanceEntry, User, sequelize } from '../models';

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

const toNumber = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

export class CustomerBalanceService {
    static async getBalance(customerId: string, options?: { transaction?: Transaction }): Promise<number> {
        const sum = await CustomerBalanceEntry.sum('amount', {
            where: { customer_id: customerId },
            transaction: options?.transaction,
        });
        return round2(toNumber(sum));
    }

    static async getSummary(customerId: string, options?: { transaction?: Transaction }) {
        const entries = await CustomerBalanceEntry.findAll({
            where: { customer_id: customerId },
            attributes: ['amount'],
            transaction: options?.transaction,
            raw: true,
        }) as unknown as Array<{ amount: number }>;

        let credit = 0;
        let debt = 0;
        for (const row of entries) {
            const amt = round2(toNumber((row as any).amount));
            if (amt > 0) credit += amt;
            if (amt < 0) debt += Math.abs(amt);
        }
        credit = round2(credit);
        debt = round2(debt);
        return {
            balance: round2(credit - debt),
            total_credit: credit,
            total_debt: debt,
        };
    }

    static async listEntries(
        customerId: string,
        params?: { limit?: number; offset?: number },
        options?: { transaction?: Transaction }
    ) {
        const limit = Math.min(200, Math.max(1, Number(params?.limit || 50) || 50));
        const offset = Math.max(0, Number(params?.offset || 0) || 0);

        const result = await CustomerBalanceEntry.findAndCountAll({
            where: { customer_id: customerId },
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            limit,
            offset,
            transaction: options?.transaction,
        });

        return {
            total: Number(result.count || 0),
            limit,
            offset,
            entries: result.rows,
        };
    }

    static async createEntry(payload: {
        customer_id: string;
        amount: number;
        entry_type: any;
        reference_type?: string | null;
        reference_id?: string | null;
        note?: string | null;
        created_by?: string | null;
        idempotency_key?: string | null;
    }, options?: { transaction?: Transaction }) {
        const customerId = String(payload.customer_id || '').trim();
        if (!customerId) throw new Error('customer_id wajib diisi');

        const amount = round2(toNumber(payload.amount));
        if (!Number.isFinite(amount) || amount === 0) throw new Error('amount tidak valid');

        const customer = await User.findOne({
            where: { id: customerId, role: 'customer' },
            attributes: ['id'],
            transaction: options?.transaction,
        });
        if (!customer) throw new Error('customer tidak ditemukan');

        const created = await CustomerBalanceEntry.create({
            customer_id: customerId,
            amount,
            entry_type: payload.entry_type,
            reference_type: payload.reference_type ?? null,
            reference_id: payload.reference_id ?? null,
            note: payload.note ?? null,
            created_by: payload.created_by ?? null,
            idempotency_key: payload.idempotency_key ?? null,
        } as any, { transaction: options?.transaction });

        return created;
    }

    static allocateDiffProRata(
        diff: number,
        weightsByCustomerId: Map<string, number>
    ): Map<string, number> {
        const normalizedDiff = round2(toNumber(diff));
        const weights: Array<{ customerId: string; weight: number }> = Array.from(weightsByCustomerId.entries())
            .map(([customerId, weight]) => ({ customerId: String(customerId).trim(), weight: Math.max(0, round2(toNumber(weight))) }))
            .filter((row) => row.customerId && row.weight > 0)
            .sort((a, b) => {
                if (b.weight !== a.weight) return b.weight - a.weight;
                return a.customerId.localeCompare(b.customerId);
            });

        const out = new Map<string, number>();
        if (!Number.isFinite(normalizedDiff) || normalizedDiff === 0 || weights.length === 0) return out;

        const totalWeight = round2(weights.reduce((sum, row) => sum + row.weight, 0));
        if (totalWeight <= 0) return out;

        // Initial allocation (rounded to cents)
        let allocatedSum = 0;
        for (const row of weights) {
            const raw = normalizedDiff * (row.weight / totalWeight);
            const rounded = round2(raw);
            if (rounded !== 0) {
                out.set(row.customerId, rounded);
                allocatedSum = round2(allocatedSum + rounded);
            } else {
                out.set(row.customerId, 0);
            }
        }

        // Distribute remainder deterministically by highest weight
        let remainder = round2(normalizedDiff - allocatedSum);
        const step = remainder > 0 ? 0.01 : -0.01;
        const maxSteps = 10000; // safety
        let steps = 0;
        while (remainder !== 0 && steps < maxSteps) {
            for (const row of weights) {
                if (remainder === 0) break;
                out.set(row.customerId, round2(toNumber(out.get(row.customerId)) + step));
                remainder = round2(remainder - step);
                steps += 1;
                if (remainder === 0 || steps >= maxSteps) break;
            }
        }

        // Drop zeros
        Array.from(out.entries()).forEach(([k, v]) => {
            if (round2(v) === 0) out.delete(k);
            else out.set(k, round2(v));
        });
        return out;
    }

    static async getCustomerBalancesReport(params: {
        q?: string;
        only_negative?: boolean;
        only_positive?: boolean;
        min_abs?: number;
        limit?: number;
        offset?: number;
    }) {
        const limit = Math.min(200, Math.max(1, Number(params.limit || 50) || 50));
        const offset = Math.max(0, Number(params.offset || 0) || 0);
        const q = String(params.q || '').trim();
        const minAbs = round2(Math.max(0, toNumber(params.min_abs)));
        const onlyNegative = Boolean(params.only_negative);
        const onlyPositive = Boolean(params.only_positive);

        // Aggregate balances for customers only.
        const whereUser: any = { role: 'customer' };
        if (q) {
            whereUser[Op.or] = [
                { name: { [Op.like]: `%${q}%` } },
                { whatsapp_number: { [Op.like]: `%${q}%` } },
                { email: { [Op.like]: `%${q}%` } },
            ];
        }

        const rows = await sequelize.query(
            `SELECT 
                u.id AS customer_id,
                u.name AS customer_name,
                u.whatsapp_number AS whatsapp_number,
                COALESCE(SUM(e.amount), 0) AS balance,
                MAX(e.createdAt) AS last_movement_at
             FROM users u
             LEFT JOIN customer_balance_entries e ON e.customer_id = u.id
             WHERE u.role = 'customer'
               ${q ? `AND (u.name LIKE :q OR u.whatsapp_number LIKE :q OR u.email LIKE :q)` : ''}
             GROUP BY u.id
             ORDER BY ABS(COALESCE(SUM(e.amount), 0)) DESC, last_movement_at DESC
             LIMIT :limit OFFSET :offset`,
            {
                replacements: {
                    q: `%${q}%`,
                    limit,
                    offset,
                }
            }
        ) as any;

        const data = Array.isArray(rows?.[0]) ? rows[0] : [];
        const filtered = data.filter((row: any) => {
            const bal = round2(toNumber(row.balance));
            if (minAbs > 0 && Math.abs(bal) < minAbs) return false;
            if (onlyNegative && !(bal < 0)) return false;
            if (onlyPositive && !(bal > 0)) return false;
            return true;
        });

        return {
            limit,
            offset,
            rows: filtered.map((row: any) => ({
                customer_id: String(row.customer_id),
                customer_name: row.customer_name,
                whatsapp_number: row.whatsapp_number,
                balance: round2(toNumber(row.balance)),
                last_movement_at: row.last_movement_at ? new Date(row.last_movement_at).toISOString() : null,
            })),
        };
    }
}

