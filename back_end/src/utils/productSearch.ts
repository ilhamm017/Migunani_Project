import { Op, col, fn, literal, where } from 'sequelize';
import type { Sequelize } from 'sequelize';

const MAX_TOKENS = 6;
const MAX_TOKEN_LENGTH = 30;

// Keep this in sync with `sqlNormalizeExpr` below.
const STRIP_REGEX = /[\s\-_.(),/\\%'"()]+/g;
const DIGIT_REGEX = /\d/;

export const normalizeSearchText = (raw: unknown): string => {
    return String(raw ?? '')
        .trim()
        .toLowerCase()
        .replace(STRIP_REGEX, '');
};

export const splitSearchTokens = (raw: unknown): string[] => {
    const text = normalizeSearchText(raw);
    if (!text) return [];

    // Tokenize from the *original* raw string to preserve word boundaries,
    // then normalize each token.
    const source = typeof raw === 'string'
        ? raw.trim()
        : Array.isArray(raw)
            ? String(raw[0] ?? '').trim()
            : String(raw ?? '').trim();

    const tokens = source
        .split(/\s+/)
        .map((t) => normalizeSearchText(t))
        .filter(Boolean)
        .map((t) => (t.length > MAX_TOKEN_LENGTH ? t.slice(0, MAX_TOKEN_LENGTH) : t))
        .filter((t) => t.length >= 2 || DIGIT_REGEX.test(t));

    return tokens.slice(0, MAX_TOKENS);
};

export const normalizeAliasInput = (raw: unknown): { alias: string; alias_normalized: string } | null => {
    const alias = String(raw ?? '').trim();
    if (!alias) return null;

    const alias_normalized = normalizeSearchText(alias);
    if (!alias_normalized) return null;

    return { alias, alias_normalized };
};

// MySQL normalization: LOWER() then nested REPLACE() for common separators.
// The char set must match `STRIP_REGEX` to avoid false negatives.
const SQL_STRIP_CHARS = [' ', '-', '_', '.', ',', '/', '\\\\', '%', '\'', '"', '(', ')'] as const;

export const sqlNormalizeExpr = (expr: any) => {
    let out: any = fn('LOWER', expr);
    for (const ch of SQL_STRIP_CHARS) {
        out = fn('REPLACE', out, ch, '');
    }
    return out;
};

const toAsciiCode = (ch: string): number => {
    if (ch.length === 1) return ch.charCodeAt(0);
    // Special case: we store backslash as '\\\\' in SQL_STRIP_CHARS.
    if (ch === '\\\\') return '\\'.charCodeAt(0);
    return ch.charCodeAt(0);
};

// MySQL normalization but expressed as a SQL string, useful for literal subqueries.
// The char set must match `SQL_STRIP_CHARS` to avoid false negatives.
export const sqlNormalizeString = (exprSql: string): string => {
    let out = `LOWER(${exprSql})`;
    for (const ch of SQL_STRIP_CHARS) {
        out = `REPLACE(${out}, CHAR(${toAsciiCode(ch)}), '')`;
    }
    return out;
};

export const buildProductTokenClause = (args: {
    sequelize: Sequelize;
    token: string;
    productTableAlias?: string; // default: Product
}): any => {
    const { sequelize, token } = args;
    const productAlias = args.productTableAlias || 'Product';
    const needle = `%${token}%`;

    const aliasSubquery = `(SELECT product_id FROM product_aliases WHERE alias_normalized LIKE ${sequelize.escape(needle)})`;
    const primaryCategorySubquery = `(SELECT id FROM categories WHERE ${sqlNormalizeString('categories.name')} LIKE ${sequelize.escape(needle)})`;
    const taggedCategorySubquery = `(SELECT pc.product_id FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE ${sqlNormalizeString('c.name')} LIKE ${sequelize.escape(needle)})`;

    return {
        [Op.or]: [
            where(sqlNormalizeExpr(col(`${productAlias}.name`)), Op.like, needle),
            where(sqlNormalizeExpr(col(`${productAlias}.sku`)), Op.like, needle),
            where(sqlNormalizeExpr(col(`${productAlias}.barcode`)), Op.like, needle),
            { id: { [Op.in]: literal(aliasSubquery) } },
            { category_id: { [Op.in]: literal(primaryCategorySubquery) } },
            { id: { [Op.in]: literal(taggedCategorySubquery) } },
        ]
    };
};

export const applyTokenSearch = (args: {
    sequelize: Sequelize;
    whereClause: any;
    tokens: string[];
    mode: 'and' | 'or';
    productTableAlias?: string;
}) => {
    const { sequelize, whereClause, tokens, mode } = args;
    if (!Array.isArray(tokens) || tokens.length === 0) return;

    const productAlias = args.productTableAlias || 'Product';
    const tokenClauses = tokens.map((token) => buildProductTokenClause({ sequelize, token, productTableAlias: productAlias }));

    const existing = whereClause[Op.and];
    const andParts: any[] = [];
    if (Array.isArray(existing)) andParts.push(...existing);
    else if (existing) andParts.push(existing);

    if (mode === 'and') {
        andParts.push(...tokenClauses);
    } else {
        andParts.push({ [Op.or]: tokenClauses });
    }
    whereClause[Op.and] = andParts;
};

export const getCountNumber = (count: unknown): number => {
    if (typeof count === 'number') return count;
    if (typeof count === 'string') return Number(count) || 0;
    if (Array.isArray(count)) {
        return count.reduce((sum, row) => {
            if (typeof row === 'number') return sum + row;
            if (typeof row === 'string') return sum + (Number(row) || 0);
            const candidate = (row as any)?.count;
            if (typeof candidate === 'number') return sum + candidate;
            if (typeof candidate === 'string') return sum + (Number(candidate) || 0);
            return sum;
        }, 0);
    }
    return Number(count as any) || 0;
};

export const buildProductMatchCountLiteral = (args: {
    sequelize: Sequelize;
    tokens: string[];
    productTableAlias?: string; // default: Product
}): ReturnType<typeof literal> => {
    const productAlias = args.productTableAlias || 'Product';
    const tokens = Array.isArray(args.tokens) ? args.tokens.filter(Boolean) : [];
    if (tokens.length === 0) return literal('0');

    const q = (colName: string) => `\`${productAlias}\`.\`${colName}\``;
    const normalized = (exprSql: string) => sqlNormalizeString(exprSql);

    const cases = tokens.map((token) => {
        const needle = `%${token}%`;
        const escapedNeedle = args.sequelize.escape(needle);

        const aliasSubquery = `(SELECT product_id FROM product_aliases WHERE alias_normalized LIKE ${escapedNeedle})`;
        const primaryCategorySubquery = `(SELECT id FROM categories WHERE ${sqlNormalizeString('categories.name')} LIKE ${escapedNeedle})`;
        const taggedCategorySubquery = `(SELECT pc.product_id FROM product_categories pc JOIN categories c ON c.id = pc.category_id WHERE ${sqlNormalizeString('c.name')} LIKE ${escapedNeedle})`;

        const conditions = [
            `${normalized(q('name'))} LIKE ${escapedNeedle}`,
            `${normalized(q('sku'))} LIKE ${escapedNeedle}`,
            `${normalized(q('barcode'))} LIKE ${escapedNeedle}`,
            `${q('id')} IN ${aliasSubquery}`,
            `${q('category_id')} IN ${primaryCategorySubquery}`,
            `${q('id')} IN ${taggedCategorySubquery}`,
        ];

        return `CASE WHEN (${conditions.join(' OR ')}) THEN 1 ELSE 0 END`;
    });

    return literal(`(${cases.join(' + ')})`);
};
