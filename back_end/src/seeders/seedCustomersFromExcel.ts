import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { CustomerProfile, User, sequelize } from '../models';
import { normalizeWhatsappNumber } from '../utils/whatsappNumber';

type SeedCustomersFromExcelOptions = {
    excelPath: string;
    chunkSize?: number;
};

type SeedCustomersFromExcelResult = {
    excelPath: string;
    worksheetName: string;
    totalRows: number;
    parsed: number;
    inserted: number;
    deduped: number;
    skippedNoName: number;
    invalidPhonesBlanked: number;
    invalidEmailsBlanked: number;
};

const toTrimmedString = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value).trim();
    return '';
};

const isValidEmailLoose = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

const pickExistingPath = (candidates: Array<string | undefined | null>): string | null => {
    for (const candidate of candidates) {
        const next = typeof candidate === 'string' ? candidate.trim() : '';
        if (!next) continue;
        if (fs.existsSync(next)) return next;
    }
    return null;
};

export const seedCustomersFromExcel = async (
    options: SeedCustomersFromExcelOptions
): Promise<SeedCustomersFromExcelResult> => {
    const chunkSize = Number.isFinite(options.chunkSize) && (options.chunkSize as number) > 0
        ? Math.floor(options.chunkSize as number)
        : 100;

    const resolvedExcelPath = pickExistingPath([
        options.excelPath,
        path.resolve(process.cwd(), options.excelPath),
    ]);

    if (!resolvedExcelPath) {
        return {
            excelPath: options.excelPath,
            worksheetName: '',
            totalRows: 0,
            parsed: 0,
            inserted: 0,
            deduped: 0,
            skippedNoName: 0,
            invalidPhonesBlanked: 0,
            invalidEmailsBlanked: 0,
        };
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(resolvedExcelPath);

    const worksheet = workbook.getWorksheet('Pelanggan') || workbook.worksheets[0];
    if (!worksheet) {
        throw new Error(`[CustomersSeeder] Worksheet not found in ${resolvedExcelPath}`);
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
        throw new Error(`[CustomersSeeder] Header 'NAMA PELANGGAN' not found in ${resolvedExcelPath}`);
    }

    const seenKeys = new Set<string>();
    const seeds: Array<{
        name: string;
        whatsapp_number: string | null;
        email: string | null;
        saved_addresses: any[];
    }> = [];

    let skippedNoName = 0;
    let invalidPhonesBlanked = 0;
    let invalidEmailsBlanked = 0;
    let deduped = 0;

    const totalRows = worksheet.rowCount;
    for (let r = 2; r <= totalRows; r += 1) {
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

        seeds.push({
            name,
            whatsapp_number: normalizedWhatsapp,
            email,
            saved_addresses,
        });
    }

    if (seeds.length === 0) {
        return {
            excelPath: resolvedExcelPath,
            worksheetName: worksheet.name,
            totalRows,
            parsed: 0,
            inserted: 0,
            deduped,
            skippedNoName,
            invalidPhonesBlanked,
            invalidEmailsBlanked,
        };
    }

    let inserted = 0;

    const t = await sequelize.transaction();
    try {
        for (let i = 0; i < seeds.length; i += chunkSize) {
            const chunk = seeds.slice(i, i + chunkSize);
            for (const seed of chunk) {
                const user = await User.create({
                    name: seed.name,
                    email: seed.email,
                    password: null,
                    whatsapp_number: seed.whatsapp_number as any,
                    role: 'customer',
                    status: 'active',
                    debt: 0,
                }, { transaction: t });

                await CustomerProfile.create({
                    user_id: user.id,
                    tier: 'regular',
                    credit_limit: 0,
                    points: 0,
                    saved_addresses: seed.saved_addresses,
                }, { transaction: t });

                inserted += 1;
            }
        }

        await t.commit();
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }

    return {
        excelPath: resolvedExcelPath,
        worksheetName: worksheet.name,
        totalRows,
        parsed: seeds.length,
        inserted,
        deduped,
        skippedNoName,
        invalidPhonesBlanked,
        invalidEmailsBlanked,
    };
};

