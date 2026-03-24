import fs from 'fs';
import path from 'path';
import { parseSalesReportDiskonXlsx } from '../seeders/salesReportDiskonParser';

const DEFAULT_SOURCE_FILENAME = 'Laporan Penjualan_24-03-2026sd24-03-2026@24-03-2026 12-15-15_diskon.xlsx';
const DEFAULT_OUT_FILE = path.resolve(__dirname, '../seeders/data/sales_report_diskon_2026_03_24.ts');

const main = async () => {
    const sourceFile = process.env.SALES_REPORT_FILE
        ? path.resolve(process.env.SALES_REPORT_FILE)
        : path.resolve(__dirname, `../../../${DEFAULT_SOURCE_FILENAME}`);

    const outFile = process.env.OUT_FILE
        ? path.resolve(process.env.OUT_FILE)
        : DEFAULT_OUT_FILE;

    const invoices = await parseSalesReportDiskonXlsx(sourceFile);
    const meta = {
        generated_at: new Date().toISOString(),
        source_file: path.basename(sourceFile),
        invoice_count: invoices.length,
        item_count: invoices.reduce((sum, inv) => sum + inv.items.length, 0),
    };

    const seedInvoices = invoices.map((inv) => ({
        invoice_no: inv.invoice_no,
        date: inv.date.toISOString(),
        customer_name: inv.customer_name,
        bruto: inv.bruto,
        diskon: inv.diskon,
        netto: inv.netto,
        items: inv.items,
    }));

    const payload = `/* eslint-disable */\n` +
        `// AUTO-GENERATED. Do not edit manually.\n` +
        `// Source: ${meta.source_file}\n` +
        `// Generated at: ${meta.generated_at}\n\n` +
        `export const salesReportDiskonSeedMeta = ${JSON.stringify(meta, null, 4)} as const;\n\n` +
        `export type SalesReportDiskonSeedInvoice = {\n` +
        `    invoice_no: string;\n` +
        `    date: string; // ISO\n` +
        `    customer_name: string;\n` +
        `    bruto: number;\n` +
        `    diskon: number;\n` +
        `    netto: number;\n` +
        `    items: Array<{\n` +
        `        product_name: string;\n` +
        `        cost_per_unit: number;\n` +
        `        price_per_unit: number;\n` +
        `        qty: number;\n` +
        `        discount_amount: number;\n` +
        `        subtotal: number;\n` +
        `        note: string | null;\n` +
        `        discount_pct: number;\n` +
        `    }>;\n` +
        `};\n\n` +
        `export const salesReportDiskonSeedInvoices: SalesReportDiskonSeedInvoice[] = ${JSON.stringify(seedInvoices, null, 4)};\n`;

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, payload, 'utf8');
    console.log(`[generate_sales_report_seed_data] wrote ${outFile}`);
    console.log(`[generate_sales_report_seed_data] meta`, meta);
};

main().catch((err) => {
    console.error('[generate_sales_report_seed_data] failed:', err);
    process.exit(1);
});
