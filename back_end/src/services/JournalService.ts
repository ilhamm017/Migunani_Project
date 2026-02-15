import { Transaction } from 'sequelize';
import { Journal, JournalLine, Account, sequelize, AccountingPeriod } from '../models';

export interface JournalLineInput {
    account_id: number;
    debit: number;
    credit: number;
}

export interface JournalInput {
    date?: Date;
    description: string;
    reference_type?: string;
    reference_id?: string;
    created_by: string;
    lines: JournalLineInput[];
}

export class JournalService {
    /**
     * Create a journal entry with its lines.
     * Enforces that total debit equals total credit.
     */
    static async createEntry(input: JournalInput, t?: Transaction) {
        // Enforce Period Lock Check
        const entryDate = input.date || new Date();
        await this.validatePeriodLock(entryDate, t);

        const transaction = t || await sequelize.transaction();

        try {
            const { date, description, reference_type, reference_id, created_by, lines } = input;

            // 1. Validate debit/credit balance
            const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
            const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit), 0);

            // Use a small epsilon for decimal comparison if needed, 
            // but here we expect exact match if using proper decimal strings/numbers
            if (Math.abs(totalDebit - totalCredit) > 0.001) {
                throw new Error(`Journal tidak balance! Total Debit: ${totalDebit}, Total Credit: ${totalCredit}`);
            }

            if (lines.length < 2) {
                throw new Error('Journal minimal harus memiliki 2 baris (double entry)');
            }

            // 2. Create Journal Header
            const journal = await Journal.create({
                date: date || new Date(),
                description,
                reference_type: reference_type || null,
                reference_id: reference_id || null,
                created_by,
                posted_at: new Date() // Post immediately for now
            }, { transaction });

            // 3. Create Journal Lines
            await JournalLine.bulkCreate(
                lines.map(line => ({
                    journal_id: journal.id,
                    account_id: line.account_id,
                    debit: line.debit,
                    credit: line.credit
                })),
                { transaction }
            );

            if (!t) await transaction.commit();
            return journal;
        } catch (error) {
            if (!t) await transaction.rollback();
            throw error;
        }
    }

    static async getAccountByCode(code: string) {
        const account = await Account.findOne({ where: { code } });
        if (!account) throw new Error(`Akun dengan kode ${code} tidak ditemukan`);
        return account;
    }

    /**
     * Check if a date falls into a closed accounting period.
     * Throws error if closed.
     */
    static async validatePeriodLock(date: Date, t?: Transaction) {
        const month = date.getMonth() + 1; // 1-12
        const year = date.getFullYear();

        const period = await AccountingPeriod.findOne({
            where: { month, year },
            transaction: t
        });

        if (period && period.is_closed) {
            throw new Error(`Periode akuntansi ${month}-${year} sudah ditutup (Closed). Transaksi tidak diizinkan.`);
        }
    }

    /**
     * Create Adjustment Journal (Bypass specific checks or mark as adjustment if needed).
     * Typically adjustment journals are allowed in closed periods IF the user has specific permission,
     * OR they are only allowed in *open* periods but flagged as adjustments.
     * Based on requirement: "Jika periode closed: Hanya boleh adjustment journal".
     * This implies we CAN modify closed period IF it is an adjustment.
     */
    static async createAdjustmentEntry(input: JournalInput, t?: Transaction) {
        // We skip validatePeriodLock here or check if it's strictly for adjustment
        // For now, let's assume 'Adjustment' is just a description flag or similar,
        // but if the period is closed, we need to allow it. 

        // Actually, usually "Adjustment" is done BEFORE closing. 
        // If "Closed", it means NO edits. "Adjustment" might mean re-opening or specific audit entry.
        // Let's implement it as: Check if closed, if closed, allow ONLY if description/type says 'ADJUSTMENT'.

        const entryDate = input.date || new Date();
        const month = entryDate.getMonth() + 1;
        const year = entryDate.getFullYear();

        const period = await AccountingPeriod.findOne({
            where: { month, year },
            transaction: t
        });

        // If period is closed, ensure this IS an adjustment
        // Since this method is explicitly createAdjustmentEntry, we allow it.
        // But maybe we should log it differently?
        // For now, reuse createEntry logic but skip validatePeriodLock.

        const transaction = t || await sequelize.transaction();

        try {
            // ... duplicate logic from createEntry but without validatePeriodLock ...
            // Ideally refactor createEntry to accept options { skipPeriodCheck: boolean }
            return this._createEntryInternal(input, transaction);
        } catch (error) {
            if (!t) await transaction.rollback();
            throw error;
        }
    }

    private static async _createEntryInternal(input: JournalInput, transaction: Transaction) {
        const { date, description, reference_type, reference_id, created_by, lines } = input;

        // 1. Validate debit/credit balance
        const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit), 0);
        const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit), 0);

        if (Math.abs(totalDebit - totalCredit) > 0.001) {
            throw new Error(`Journal tidak balance! Total Debit: ${totalDebit}, Total Credit: ${totalCredit}`);
        }

        if (lines.length < 2) {
            throw new Error('Journal minimal harus memiliki 2 baris (double entry)');
        }

        // 2. Create Journal Header
        const journal = await Journal.create({
            date: date || new Date(),
            description,
            reference_type: reference_type || null,
            reference_id: reference_id || null,
            created_by,
            posted_at: new Date()
        }, { transaction });

        // 3. Create Journal Lines
        await JournalLine.bulkCreate(
            lines.map(line => ({
                journal_id: journal.id,
                account_id: line.account_id,
                debit: line.debit,
                credit: line.credit
            })),
            { transaction }
        );

        return journal;
    }
}
