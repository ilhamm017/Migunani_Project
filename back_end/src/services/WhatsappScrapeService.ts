import * as crypto from 'crypto';
import waClient from './whatsappClient';
import { User } from '../models';
import { CustomError } from '../utils/CustomError';

export type ScrapeTimezone = 'Asia/Jakarta';
export type ScrapeMatchStatus = 'unique' | 'ambiguous' | 'unmatched';
export type ScrapeQtyUnit = 'pcs' | 'pc' | 'dus';
export type ScrapeQtySource = 'paren' | 'pcs' | 'colon' | 'trailing';

export type ScrapeGroup = {
    id: string;
    name: string;
    participants_count: number | null;
};

export type ScrapeRange = {
    date_from: string;
    date_to: string;
    timezone: ScrapeTimezone;
    start_utc_ms: number;
    end_utc_ms: number;
};

export type ScrapeCustomerCandidate = {
    id: string;
    name: string;
    whatsapp_number: string | null;
    status: string;
};

export type ScrapeItem = {
    item_id: string;
    kind: 'text' | 'image';
    raw: string;
    search_text: string;
    qty: number | null;
    qty_unit: ScrapeQtyUnit | null;
    qty_source: ScrapeQtySource | null;
    message_id: string;
    message_timestamp: number;
    line_index: number | null;
};

export type ScrapeBlock = {
    block_id: string;
    is_addon: boolean;
    marker_message_id: string;
    marker_timestamp: number;
    items: ScrapeItem[];
};

export type ScrapeCustomer = {
    customer_key: string;
    chat_name: string;
    match_status: ScrapeMatchStatus;
    candidates: ScrapeCustomerCandidate[];
    blocks: ScrapeBlock[];
};

export type ScrapeCustomerSummary = {
    customer_key: string;
    chat_name: string;
    match_status: ScrapeMatchStatus;
    candidates_count: number;
    blocks_count: number;
    items_count: number;
    unresolved_qty_count: number;
    has_media: boolean;
};

export type ScrapeSession = {
    session_id: string;
    created_at_ms: number;
    expires_at_ms: number;
    group: ScrapeGroup;
    range: ScrapeRange;
    message_limit: number;
    messages_fetched: number;
    messages_in_range: number;
    truncated: boolean;
    customers: Record<string, ScrapeCustomer>;
    media_message_ids: Set<string>;
    messages: StoredMessage[];
};

export type ScrapeSessionSummaryResponse = {
    session_id: string;
    created_at_ms: number;
    group: ScrapeGroup;
    range: ScrapeRange;
    message_limit: number;
    messages_scanned: number;
    truncated: boolean;
    customers: ScrapeCustomerSummary[];
};

export type ScrapeChatMessage = {
    message_id: string;
    timestamp: number;
    type: string;
    body: string;
    has_media: boolean;
    author: string | null;
    scrape_groups: ScrapeMessageGrouping[];
};

export type ScrapeMessageGrouping = {
    customer_key: string;
    block_id: string;
    is_addon: boolean;
    kind: 'marker' | 'item';
};

export type ScrapeSessionMessagesResponse = {
    session_id: string;
    created_at_ms: number;
    group: ScrapeGroup;
    range: ScrapeRange;
    message_limit: number;
    truncated: boolean;
    messages: ScrapeChatMessage[];
};

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

const sessions = new Map<string, ScrapeSession>();

const cleanupExpiredSessions = () => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
        if (session.expires_at_ms <= now) {
            sessions.delete(id);
        }
    }
};

const parseIsoDate = (isoDate: string) => {
    const trimmed = String(isoDate || '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!m) {
        throw new CustomError(`Format date harus YYYY-MM-DD, dapat: '${trimmed}'`, 400);
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        throw new CustomError(`Format date tidak valid: '${trimmed}'`, 400);
    }
    return { year, month, day, raw: trimmed };
};

export const toJakartaDateRangeUtcMs = (dateFrom: string, dateTo: string) => {
    const from = parseIsoDate(dateFrom);
    const to = parseIsoDate(dateTo);
    const startUtcMs = Date.UTC(from.year, from.month - 1, from.day, 0, 0, 0) - (7 * 60 * 60 * 1000);
    const endUtcMs = Date.UTC(to.year, to.month - 1, to.day + 1, 0, 0, 0) - (7 * 60 * 60 * 1000);
    if (endUtcMs <= startUtcMs) {
        throw new CustomError('Rentang tanggal tidak valid: date_to harus >= date_from', 400);
    }
    return { startUtcMs, endUtcMs };
};

const normalizeKey = (input: string) =>
    String(input || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

const stripPlus = (input: string) => String(input || '').trim().replace(/^\+\s*/, '');

const tokenize = (input: string) =>
    normalizeKey(input)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);

const containsTokenSequence = (haystackTokens: string[], needleTokens: string[]) => {
    if (needleTokens.length === 0) return false;
    for (let i = 0; i <= haystackTokens.length - needleTokens.length; i++) {
        let ok = true;
        for (let j = 0; j < needleTokens.length; j++) {
            if (haystackTokens[i + j] !== needleTokens[j]) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }
    return false;
};

type MatchScore = { score: number; why: string };

const scoreMatch = (chatName: string, customerName: string): MatchScore | null => {
    const chatNorm = normalizeKey(chatName);
    const customerNorm = normalizeKey(customerName);
    if (!chatNorm || !customerNorm) return null;

    if (chatNorm === customerNorm) return { score: 100, why: 'exact' };

    const chatTokens = tokenize(chatName);
    const customerTokens = tokenize(customerName);
    if (chatTokens.length === 0 || customerTokens.length === 0) return null;

    if (containsTokenSequence(customerTokens, chatTokens)) return { score: 90, why: 'sequence' };

    if (chatTokens.length >= 2) {
        const filtered = chatTokens.filter((t) => t.length >= 3);
        if (filtered.length >= 2) {
            const customerSet = new Set(customerTokens);
            const allPresent = filtered.every((t) => customerSet.has(t));
            if (allPresent) return { score: 80, why: 'subset' };
        }
    }

    if (chatTokens.length === 1 && chatTokens[0].length >= 3) {
        if (customerTokens.includes(chatTokens[0])) return { score: 70, why: 'single_token' };
    }

    return null;
};

const isNameLikeLine = (raw: string) => {
    const t = String(raw || '').trim();
    if (!t) return false;
    if (t.includes('\n')) return false;
    const stripped = stripPlus(t);
    if (!stripped) return false;
    if (stripped.length > 60) return false;
    if (/[0-9]/.test(stripped)) return false;
    if (/[\\/:=@]/.test(stripped)) return false;
    return true;
};

const extractQtyAndSearchText = (rawLine: string): {
    qty: number | null;
    qty_unit: ScrapeQtyUnit | null;
    qty_source: ScrapeQtySource | null;
    search_text: string;
} => {
    const line = String(rawLine || '').trim();
    if (!line) {
        return { qty: null, qty_unit: null, qty_source: null, search_text: '' };
    }

    const paren = /\((\d+)\)\s*$/;
    const parenMatch = paren.exec(line);
    if (parenMatch) {
        const qty = Number(parenMatch[1]);
        const search = line.replace(paren, '').trim();
        return {
            qty: Number.isFinite(qty) ? Math.max(0, Math.trunc(qty)) : null,
            qty_unit: 'pcs',
            qty_source: 'paren',
            search_text: search,
        };
    }

    const pcsMatch = /(?:=|\b)\s*(\d+)\s*(pcs|pc|dus)\b\s*$/i.exec(line);
    if (pcsMatch) {
        const qty = Number(pcsMatch[1]);
        const unit = String(pcsMatch[2]).toLowerCase() as ScrapeQtyUnit;
        const search = line.replace(pcsMatch[0], '').trim();
        return {
            qty: Number.isFinite(qty) ? Math.max(0, Math.trunc(qty)) : null,
            qty_unit: unit,
            qty_source: 'pcs',
            search_text: search,
        };
    }

    const colonMatch = /:\s*(\d+)\s*(pcs|pc|dus)?\b/i.exec(line);
    if (colonMatch) {
        const qty = Number(colonMatch[1]);
        const unitRaw = typeof colonMatch[2] === 'string' ? colonMatch[2].toLowerCase() : '';
        const unit = (unitRaw === 'pcs' || unitRaw === 'pc' || unitRaw === 'dus') ? (unitRaw as ScrapeQtyUnit) : null;
        const search = line.replace(colonMatch[0], '').replace(/:\s*$/, '').trim();
        return {
            qty: Number.isFinite(qty) ? Math.max(0, Math.trunc(qty)) : null,
            qty_unit: unit,
            qty_source: 'colon',
            search_text: search,
        };
    }

    const trailingMatch = /(?:^|\s)(\d+)\s*(pcs|pc|dus)?\s*$/i.exec(line);
    if (trailingMatch) {
        const qty = Number(trailingMatch[1]);
        const unitRaw = typeof trailingMatch[2] === 'string' ? trailingMatch[2].toLowerCase() : '';
        const unit = (unitRaw === 'pcs' || unitRaw === 'pc' || unitRaw === 'dus') ? (unitRaw as ScrapeQtyUnit) : null;
        const search = line.replace(trailingMatch[0], '').trim();
        return {
            qty: Number.isFinite(qty) ? Math.max(0, Math.trunc(qty)) : null,
            qty_unit: unit,
            qty_source: 'trailing',
            search_text: search,
        };
    }

    return { qty: null, qty_unit: null, qty_source: null, search_text: line };
};

type BufferMessage = {
    id: string;
    timestamp: number;
    type: string;
    body: string;
    hasMedia: boolean;
    author: string | null;
};

type StoredMessage = BufferMessage;

const messageToBufferMessage = (msg: any): BufferMessage => ({
    id: String(msg?.id?._serialized || ''),
    timestamp: Number(msg?.timestamp || 0),
    type: String(msg?.type || ''),
    body: typeof msg?.body === 'string' ? msg.body : '',
    hasMedia: !!msg?.hasMedia,
    author: typeof msg?.author === 'string'
        ? msg.author
        : (typeof msg?._data?.author === 'string' ? msg._data.author : null),
});

const bufferToItems = (buffer: BufferMessage[], mediaWhitelist: Set<string>) => {
    const items: ScrapeItem[] = [];
    for (const msg of buffer) {
        const isImage = msg.hasMedia || String(msg.type || '').toLowerCase() === 'image';
        if (isImage) {
            mediaWhitelist.add(msg.id);
            const caption = String(msg.body || '').trim();
            items.push({
                item_id: crypto.randomUUID(),
                kind: 'image',
                raw: caption,
                search_text: caption,
                qty: null,
                qty_unit: null,
                qty_source: null,
                message_id: msg.id,
                message_timestamp: msg.timestamp,
                line_index: null,
            });
            continue;
        }

        const body = String(msg.body || '');
        const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const extracted = extractQtyAndSearchText(raw);
            items.push({
                item_id: crypto.randomUUID(),
                kind: 'text',
                raw,
                search_text: extracted.search_text,
                qty: extracted.qty,
                qty_unit: extracted.qty_unit,
                qty_source: extracted.qty_source,
                message_id: msg.id,
                message_timestamp: msg.timestamp,
                line_index: i,
            });
        }
    }
    return items;
};

export const listWhatsappGroups = async (): Promise<ScrapeGroup[]> => {
    const chats = await waClient.getChats();
    const groups = chats.filter((c: any) => c?.isGroup);
    return groups.map((g: any) => ({
        id: String(g?.id?._serialized || ''),
        name: String(g?.name || ''),
        participants_count: Array.isArray(g?.participants) ? g.participants.length : null,
    })).filter((row) => row.id);
};

const loadCustomerCandidates = async () => {
    const rows = await User.findAll({
        where: { role: 'customer' },
        attributes: ['id', 'name', 'whatsapp_number', 'status'],
    });

    return rows.map((row: any) => ({
        id: String(row.id),
        name: String(row.name || ''),
        whatsapp_number: row.whatsapp_number ? String(row.whatsapp_number) : null,
        status: String(row.status || ''),
    })) as ScrapeCustomerCandidate[];
};

const matchCandidates = (chatName: string, dbCustomers: ScrapeCustomerCandidate[]) => {
    const scored = dbCustomers
        .map((c) => {
            const scored = scoreMatch(chatName, c.name);
            return scored ? { customer: c, score: scored.score } : null;
        })
        .filter(Boolean) as Array<{ customer: ScrapeCustomerCandidate; score: number }>;

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.customer.name.localeCompare(b.customer.name);
    });

    return scored.slice(0, 10).map((row) => row.customer);
};

export const createScrapeSession = async (params: {
    group_id: string;
    date_from: string;
    date_to: string;
    timezone?: string;
    message_limit?: number;
}): Promise<ScrapeSessionSummaryResponse> => {
    cleanupExpiredSessions();

    const groupId = String(params.group_id || '').trim();
    if (!groupId) throw new CustomError('group_id wajib diisi.', 400);

    const timezone = (String(params.timezone || 'Asia/Jakarta').trim() || 'Asia/Jakarta') as string;
    if (timezone !== 'Asia/Jakarta') {
        throw new CustomError('Timezone saat ini hanya mendukung Asia/Jakarta.', 400);
    }

    const dateFrom = String(params.date_from || '').trim();
    const dateTo = String(params.date_to || '').trim();
    if (!dateFrom || !dateTo) throw new CustomError('date_from dan date_to wajib diisi.', 400);

    const messageLimitRaw = params.message_limit === undefined ? 10000 : Number(params.message_limit);
    const messageLimit = Math.max(100, Math.min(10000, Math.trunc(Number.isFinite(messageLimitRaw) ? messageLimitRaw : 10000)));

    const { startUtcMs, endUtcMs } = toJakartaDateRangeUtcMs(dateFrom, dateTo);

    const chat: any = await waClient.getChatById(groupId);
    if (!chat || !chat.isGroup) {
        throw new CustomError('Group tidak ditemukan atau bukan group chat.', 404);
    }

    const group: ScrapeGroup = {
        id: String(chat?.id?._serialized || groupId),
        name: String(chat?.name || ''),
        participants_count: Array.isArray(chat?.participants) ? chat.participants.length : null,
    };

    const fetched = await chat.fetchMessages({ limit: messageLimit });
    const fetchedBuffer = Array.isArray(fetched) ? fetched.map(messageToBufferMessage) : [];
    fetchedBuffer.sort((a, b) => a.timestamp - b.timestamp);

    const inRange = fetchedBuffer.filter((m) => {
        const tsMs = m.timestamp * 1000;
        return tsMs >= startUtcMs && tsMs < endUtcMs;
    });

    const oldestFetchedMs = fetchedBuffer.length > 0 ? fetchedBuffer[0].timestamp * 1000 : null;
    const truncated = fetchedBuffer.length >= messageLimit && oldestFetchedMs !== null && oldestFetchedMs > startUtcMs;

    const dbCustomers = await loadCustomerCandidates();

    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const session: ScrapeSession = {
        session_id: sessionId,
        created_at_ms: now,
        expires_at_ms: now + SESSION_TTL_MS,
        group,
        range: {
            date_from: dateFrom,
            date_to: dateTo,
            timezone: 'Asia/Jakarta',
            start_utc_ms: startUtcMs,
            end_utc_ms: endUtcMs,
        },
        message_limit: messageLimit,
        messages_fetched: fetchedBuffer.length,
        messages_in_range: inRange.length,
        truncated,
        customers: {},
        media_message_ids: new Set<string>(),
        messages: inRange,
    };

    for (const msg of inRange) {
        const isImage = msg.hasMedia || String(msg.type || '').toLowerCase() === 'image';
        if (isImage && msg.id) {
            session.media_message_ids.add(msg.id);
        }
    }

    let buffer: BufferMessage[] = [];
    let blockSeq = 0;

    for (const msg of inRange) {
        const bodyTrim = String(msg.body || '').trim();
        const maybeMarker = isNameLikeLine(bodyTrim);
        if (maybeMarker) {
            const rawName = stripPlus(bodyTrim);
            const isAddon = bodyTrim.startsWith('+');
            const candidates = matchCandidates(rawName, dbCustomers);
            const shouldTreatAsMarker = candidates.length > 0 || isAddon; // +Name can become unmatched marker.

            if (shouldTreatAsMarker) {
                const customerKey = normalizeKey(rawName);
                if (!customerKey) continue;

                const matchStatus: ScrapeMatchStatus = candidates.length === 0
                    ? 'unmatched'
                    : (candidates.length === 1 ? 'unique' : 'ambiguous');

                if (!session.customers[customerKey]) {
                    session.customers[customerKey] = {
                        customer_key: customerKey,
                        chat_name: rawName,
                        match_status: matchStatus,
                        candidates,
                        blocks: [],
                    };
                }

                const items = bufferToItems(buffer, session.media_message_ids);
                buffer = [];

                blockSeq += 1;
                session.customers[customerKey].blocks.push({
                    block_id: `b${blockSeq}`,
                    is_addon: isAddon,
                    marker_message_id: msg.id,
                    marker_timestamp: msg.timestamp,
                    items,
                });
                continue;
            }
        }

        buffer.push(msg);
    }

    // orphan buffer is ignored by default (admin can rescrape with wider range/limit if needed).

    sessions.set(sessionId, session);

    return toSessionSummary(session);
};

const toCustomerSummary = (customer: ScrapeCustomer): ScrapeCustomerSummary => {
    let itemsCount = 0;
    let unresolvedQtyCount = 0;
    let hasMedia = false;
    for (const block of customer.blocks) {
        for (const item of block.items) {
            itemsCount += 1;
            if (item.kind === 'image') hasMedia = true;
            if (item.kind === 'text' && (item.qty === null || item.qty <= 0)) unresolvedQtyCount += 1;
        }
    }

    return {
        customer_key: customer.customer_key,
        chat_name: customer.chat_name,
        match_status: customer.match_status,
        candidates_count: customer.candidates.length,
        blocks_count: customer.blocks.length,
        items_count: itemsCount,
        unresolved_qty_count: unresolvedQtyCount,
        has_media: hasMedia,
    };
};

const toSessionSummary = (session: ScrapeSession): ScrapeSessionSummaryResponse => {
    const customers = Object.values(session.customers)
        .map(toCustomerSummary)
        .sort((a, b) => a.chat_name.localeCompare(b.chat_name));

    return {
        session_id: session.session_id,
        created_at_ms: session.created_at_ms,
        group: session.group,
        range: session.range,
        message_limit: session.message_limit,
        messages_scanned: session.messages_in_range,
        truncated: session.truncated,
        customers,
    };
};

export const getScrapeSessionSummary = (sessionId: string): ScrapeSessionSummaryResponse => {
    cleanupExpiredSessions();
    const session = sessions.get(sessionId);
    if (!session) throw new CustomError('Scrape session tidak ditemukan atau sudah expired.', 404);
    return toSessionSummary(session);
};

export const getScrapeCustomerDetail = (sessionId: string, customerKey: string) => {
    cleanupExpiredSessions();
    const session = sessions.get(sessionId);
    if (!session) throw new CustomError('Scrape session tidak ditemukan atau sudah expired.', 404);

    const key = normalizeKey(customerKey);
    const customer = session.customers[key];
    if (!customer) throw new CustomError('Customer tidak ditemukan dalam session.', 404);

    return {
        session_id: session.session_id,
        created_at_ms: session.created_at_ms,
        group: session.group,
        range: session.range,
        message_limit: session.message_limit,
        truncated: session.truncated,
        customer,
    };
};

export const getScrapeSessionMessages = (sessionId: string): ScrapeSessionMessagesResponse => {
    cleanupExpiredSessions();
    const session = sessions.get(sessionId);
    if (!session) throw new CustomError('Scrape session tidak ditemukan atau sudah expired.', 404);

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const groupingsByMessageId = new Map<string, ScrapeMessageGrouping[]>();

    const addGrouping = (messageId: string, grouping: ScrapeMessageGrouping) => {
        const id = String(messageId || '').trim();
        if (!id) return;
        const existing = groupingsByMessageId.get(id);
        if (!existing) {
            groupingsByMessageId.set(id, [grouping]);
            return;
        }
        const already = existing.some((g) =>
            g.customer_key === grouping.customer_key &&
            g.block_id === grouping.block_id &&
            g.kind === grouping.kind
        );
        if (!already) existing.push(grouping);
    };

    for (const customer of Object.values(session.customers || {})) {
        for (const block of customer.blocks || []) {
            addGrouping(block.marker_message_id, {
                customer_key: customer.customer_key,
                block_id: block.block_id,
                is_addon: !!block.is_addon,
                kind: 'marker',
            });
            for (const item of block.items || []) {
                addGrouping(item.message_id, {
                    customer_key: customer.customer_key,
                    block_id: block.block_id,
                    is_addon: !!block.is_addon,
                    kind: 'item',
                });
            }
        }
    }

    return {
        session_id: session.session_id,
        created_at_ms: session.created_at_ms,
        group: session.group,
        range: session.range,
        message_limit: session.message_limit,
        truncated: session.truncated,
        messages: messages.map((m) => ({
            message_id: String(m.id || ''),
            timestamp: Number(m.timestamp || 0),
            type: String(m.type || ''),
            body: typeof m.body === 'string' ? m.body : '',
            has_media: !!m.hasMedia || String(m.type || '').toLowerCase() === 'image',
            author: typeof m.author === 'string' ? m.author : null,
            scrape_groups: groupingsByMessageId.get(String(m.id || '').trim()) || [],
        })).filter((row) => row.message_id),
    };
};

export const getScrapeMedia = async (sessionId: string, messageId: string) => {
    cleanupExpiredSessions();
    const session = sessions.get(sessionId);
    if (!session) throw new CustomError('Scrape session tidak ditemukan atau sudah expired.', 404);

    const id = String(messageId || '').trim();
    if (!id) throw new CustomError('messageId wajib diisi.', 400);
    if (!session.media_message_ids.has(id)) {
        throw new CustomError('Media tidak ditemukan dalam session.', 404);
    }

    const msg: any = await (waClient as any).getMessageById(id);
    if (!msg || !msg.hasMedia) {
        throw new CustomError('Message media tidak ditemukan.', 404);
    }

    const media: any = await msg.downloadMedia();
    const mimetype = typeof media?.mimetype === 'string' ? media.mimetype : 'application/octet-stream';
    const dataBase64 = typeof media?.data === 'string' ? media.data : '';
    if (!dataBase64) {
        throw new CustomError('Gagal mengambil media dari WhatsApp.', 502);
    }

    const buffer = Buffer.from(dataBase64, 'base64');
    return { mimetype, buffer };
};
