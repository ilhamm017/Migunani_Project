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

export const buildProductTokenClause = (args: {
    sequelize: Sequelize;
    token: string;
    productTableAlias?: string; // default: Product
}): any => {
    const { sequelize, token } = args;
    const productAlias = args.productTableAlias || 'Product';
    const needle = `%${token}%`;

    const aliasSubquery = `(SELECT product_id FROM product_aliases WHERE alias_normalized LIKE ${sequelize.escape(needle)})`;

    return {
        [Op.or]: [
            where(sqlNormalizeExpr(col(`${productAlias}.name`)), Op.like, needle),
            where(sqlNormalizeExpr(col(`${productAlias}.sku`)), Op.like, needle),
            where(sqlNormalizeExpr(col(`${productAlias}.barcode`)), Op.like, needle),
            { id: { [Op.in]: literal(aliasSubquery) } },
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

