import { sequelize } from '../models';

export const parseEnumValuesFromColumnType = (columnType: string): string[] => {
    const values: string[] = [];
    const regex = /'((?:[^'\\]|\\.)*)'/g;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(columnType)) !== null) {
        values.push(match[1].replace(/\\'/g, "'"));
    }
    return values;
};

let cachedInitialInvoiceStatus: 'draft' | 'unpaid' | null = null;

export const resolveInitialInvoiceStatus = async (): Promise<'draft' | 'unpaid'> => {
    if (cachedInitialInvoiceStatus) return cachedInitialInvoiceStatus;
    if (sequelize.getDialect() !== 'mysql') {
        cachedInitialInvoiceStatus = 'draft';
        return cachedInitialInvoiceStatus;
    }

    try {
        const [rows] = await sequelize.query(
            `SELECT COLUMN_TYPE AS columnType
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'invoices'
               AND COLUMN_NAME = 'payment_status'`
        ) as any;

        const paymentStatusColumn = rows?.[0];
        if (!paymentStatusColumn?.columnType) {
            cachedInitialInvoiceStatus = 'unpaid';
            return cachedInitialInvoiceStatus;
        }

        const enumValues = parseEnumValuesFromColumnType(paymentStatusColumn.columnType);
        cachedInitialInvoiceStatus = enumValues.includes('draft') ? 'draft' : 'unpaid';
        return cachedInitialInvoiceStatus;
    } catch {
        cachedInitialInvoiceStatus = 'unpaid';
        return cachedInitialInvoiceStatus;
    }
};

export const generateInvoiceNumber = (orderId: string, now = new Date()): string => {
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const uniquePart = String(orderId || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 8);
    const timePart = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}${String(now.getMilliseconds()).padStart(3, '0')}`;
    const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `INV/${datePart}/${uniquePart || 'ORDER'}-${timePart}${randomPart}`;
};
