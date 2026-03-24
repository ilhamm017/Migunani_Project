import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { normalizeWhatsappNumber } from '../utils/whatsappNumber';

const toTrimmedString = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value).trim();
    if (value && typeof value === 'object' && 'text' in (value as any) && typeof (value as any).text === 'string') {
        return String((value as any).text).trim();
    }
    return '';
};

const isValidEmailLoose = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

const main = async () => {
    const excelPathArg = process.argv[2] || '../Pelanggan_@24-03-2026 12-43-15.xlsx';
    const outPathArg = process.argv[3] || 'src/seeders/data/pelanggan_2026_03_24.ts';

    const excelPath = path.resolve(process.cwd(), excelPathArg);
    const outPath = path.resolve(process.cwd(), outPathArg);

    if (!fs.existsSync(excelPath)) {
        throw new Error(`Excel file not found: ${excelPath}`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelPath);
    const worksheet = workbook.getWorksheet('Pelanggan') || workbook.worksheets[0];
    if (!worksheet) {
        throw new Error(`Worksheet not found in: ${excelPath}`);
    }

    const headerRow = worksheet.getRow(1);
    const headerByCol = new Map<number, string>();
    for (let c = 1; c <= worksheet.columnCount; c += 1) {
        const raw = toTrimmedString(headerRow.getCell(c).text || headerRow.getCell(c).value);
        if (!raw) continue;
        headerByCol.set(c, raw.toLowerCase());
    }

    const findCol = (...names: string[]): number | null => {
        const lowered = names.map((name) => name.trim().toLowerCase()).filter(Boolean);
        for (const [col, header] of headerByCol.entries()) {
            if (lowered.includes(header)) return col;
        }
        return null;
    };

    const colName = findCol('nama pelanggan', 'nama');
    const colTelp = findCol('telp', 'telepon', 'no telp', 'no hp', 'hp');
    const colAlamat = findCol('alamat');
    const colKota = findCol('kota', 'kabupaten', 'kab/kota');
    const colEmail = findCol('email', 'e-mail');
    const colKeterangan = findCol('keterangan', 'catatan', 'note', 'notes');

    if (!colName) {
        throw new Error(`Header 'NAMA PELANGGAN' not found in: ${excelPath}`);
    }

    const seenKeys = new Set<string>();
    const rows: Array<{
        name: string;
        whatsapp_number: string | null;
        email: string | null;
        saved_addresses: any[];
    }> = [];

    let skippedNoName = 0;
    let invalidPhonesBlanked = 0;
    let invalidEmailsBlanked = 0;
    let deduped = 0;

    for (let r = 2; r <= worksheet.rowCount; r += 1) {
        const row = worksheet.getRow(r);
        const name = toTrimmedString(row.getCell(colName).text || row.getCell(colName).value);
        if (!name) {
            skippedNoName += 1;
            continue;
        }

        const telpRaw = colTelp
            ? toTrimmedString(row.getCell(colTelp).text || row.getCell(colTelp).value)
            : '';
        const alamat = colAlamat
            ? toTrimmedString(row.getCell(colAlamat).text || row.getCell(colAlamat).value)
            : '';
        const kota = colKota
            ? toTrimmedString(row.getCell(colKota).text || row.getCell(colKota).value)
            : '';
        const emailRaw = colEmail
            ? toTrimmedString(row.getCell(colEmail).text || row.getCell(colEmail).value)
            : '';
        const keterangan = colKeterangan
            ? toTrimmedString(row.getCell(colKeterangan).text || row.getCell(colKeterangan).value)
            : '';

        const normalizedWhatsapp = telpRaw ? normalizeWhatsappNumber(telpRaw) : null;
        if (telpRaw && !normalizedWhatsapp) invalidPhonesBlanked += 1;

        let email: string | null = emailRaw || null;
        if (email && !isValidEmailLoose(email)) {
            invalidEmailsBlanked += 1;
            email = null;
        }

        const addressCombined = [alamat, kota].map((v) => v.trim()).filter(Boolean).join(', ');
        const saved_addresses = (addressCombined || keterangan)
            ? [{
                label: 'Import Excel',
                address: addressCombined || null,
                city: kota || null,
                note: keterangan || null,
                isPrimary: true,
            }]
            : [];

        const dedupeKey = normalizedWhatsapp
            ? `wa:${normalizedWhatsapp}`
            : `name:${name.toLowerCase()}`;
        if (seenKeys.has(dedupeKey)) {
            deduped += 1;
            continue;
        }
        seenKeys.add(dedupeKey);

        rows.push({
            name,
            whatsapp_number: normalizedWhatsapp,
            email,
            saved_addresses,
        });
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const meta = {
        worksheet: worksheet.name,
        totalRows: worksheet.rowCount,
        parsed: rows.length,
        deduped,
        skippedNoName,
        invalidPhonesBlanked,
        invalidEmailsBlanked,
    };

    const file =
        `/* AUTO-GENERATED FILE - DO NOT EDIT MANUALLY\n` +
        ` * Source: ${path.basename(excelPath)}\n` +
        ` * Generated at: ${new Date().toISOString()}\n` +
        ` */\n\n` +
        `export type SeedCustomerRow = {\n` +
        `  name: string;\n` +
        `  whatsapp_number: string | null;\n` +
        `  email: string | null;\n` +
        `  saved_addresses: any[];\n` +
        `};\n\n` +
        `export const pelangganSeedRows: SeedCustomerRow[] = ${JSON.stringify(rows, null, 2)} as any;\n\n` +
        `export const pelangganSeedMeta = ${JSON.stringify(meta, null, 2)} as const;\n`;

    fs.writeFileSync(outPath, file, 'utf8');
    console.log(`[generate_pelanggan_seed] Wrote: ${outPath}`);
    console.log('[generate_pelanggan_seed] Stats:', {
        parsed: rows.length,
        deduped,
        skippedNoName,
        invalidPhonesBlanked,
        invalidEmailsBlanked,
    });
};

main().catch((err) => {
    console.error('[generate_pelanggan_seed] Failed:', err);
    process.exit(1);
});
