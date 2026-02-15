import { Op, QueryTypes } from 'sequelize';
import {
    ChatSession,
    ChatThread,
    ChatThreadMember,
    Message,
    Order,
    Retur,
    User,
    sequelize
} from '../models';
import { getWhatsappLookupCandidates, normalizeWhatsappNumber } from '../utils/whatsappNumber';

export type ChatThreadType = 'staff_dm' | 'staff_customer' | 'support_omni' | 'wa_lead';
export type ChatMessageChannel = 'app' | 'whatsapp';
export type ChatDeliveryState = 'sent' | 'delivered' | 'read' | 'failed';
export type OpenThreadMode = 'staff_dm' | 'staff_customer' | 'support';
export type ContactQueryType = 'staff' | 'customer_contextual';
export type ThreadScope = ChatThreadType;

export interface ChatActor {
    id: string;
    role: string;
    whatsapp_number?: string;
}

const SUPPORT_ROLES = new Set(['super_admin', 'kasir']);
const STAFF_ROLES = new Set(['super_admin', 'kasir', 'admin_gudang', 'admin_finance', 'driver']);

const CUSTOMER_STAFF_IDENTITY_REGEX = /^web-customer:([^:]+):staff:([^:]+)$/;
const GUEST_WEB_PREFIX = 'webguest:';
const WA_LEAD_THREAD_PREFIX = 'wa_lead:';
const WA_LEAD_EXTERNAL_MAX_LEN = 32;
const WA_LEAD_KEY_SUFFIX_MAX_LEN = 220;

const isSupportRole = (role: string) => SUPPORT_ROLES.has(role);
const isStaffRole = (role: string) => STAFF_ROLES.has(role);
const isCustomerRole = (role: string) => role === 'customer';

const safeTrim = (value: unknown): string => String(value || '').trim();

const compactWithHash = (value: string, maxLen: number): string => {
    const raw = safeTrim(value);
    if (!raw) return '';
    if (raw.length <= maxLen) return raw;

    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
        hash = ((hash * 31) + raw.charCodeAt(i)) >>> 0;
    }
    const suffix = hash.toString(36);
    const keep = Math.max(1, maxLen - suffix.length - 1);
    return `${raw.slice(0, keep)}_${suffix}`.slice(0, maxLen);
};

const parseCustomerStaffIdentity = (value: unknown): { customerId: string; staffId: string } | null => {
    const raw = safeTrim(value);
    const match = CUSTOMER_STAFF_IDENTITY_REGEX.exec(raw);
    if (!match) return null;
    const customerId = safeTrim(match[1]);
    const staffId = safeTrim(match[2]);
    if (!customerId || !staffId) return null;
    return { customerId, staffId };
};

const buildStaffDmKey = (a: string, b: string): string => {
    const pair = [safeTrim(a), safeTrim(b)].sort();
    return `staff_dm:${pair[0]}:${pair[1]}`;
};

const buildStaffCustomerKey = (staffId: string, customerId: string): string =>
    `staff_customer:${safeTrim(staffId)}:${safeTrim(customerId)}`;

const buildSupportOmniKey = (customerId: string): string =>
    `support_omni:${safeTrim(customerId)}`;

const buildWaLeadKey = (normalizedNumber: string): string =>
    `${WA_LEAD_THREAD_PREFIX}${compactWithHash(normalizedNumber, WA_LEAD_KEY_SUFFIX_MAX_LEN)}`;

const buildLegacySessionIdentityForThread = (thread: ChatThread): { whatsappNumber: string; platform: 'web' | 'whatsapp' } => {
    const external = safeTrim(thread.external_whatsapp_number);
    if (thread.thread_type === 'wa_lead') {
        if (external && !external.startsWith(GUEST_WEB_PREFIX)) {
            return { whatsappNumber: external, platform: 'whatsapp' };
        }
        return { whatsappNumber: external || `${GUEST_WEB_PREFIX}${thread.id}`, platform: 'web' };
    }

    if (thread.thread_type === 'support_omni' && external && !external.startsWith(GUEST_WEB_PREFIX)) {
        return { whatsappNumber: external, platform: 'whatsapp' };
    }

    if (external) {
        return { whatsappNumber: external, platform: 'web' };
    }

    return { whatsappNumber: `thread:${thread.id}`, platform: 'web' };
};

const resolveOrCreateLegacySessionForThread = async (
    thread: ChatThread,
    requestedSessionId?: string
): Promise<ChatSession> => {
    const explicitSessionId = safeTrim(requestedSessionId);
    if (explicitSessionId) {
        const explicit = await ChatSession.findByPk(explicitSessionId);
        if (explicit) return explicit;
    }

    const threadSession = await ChatSession.findByPk(thread.id);
    if (threadSession) return threadSession;

    const legacyIdentity = buildLegacySessionIdentityForThread(thread);
    const now = new Date();

    try {
        return await ChatSession.create({
            id: thread.id,
            user_id: safeTrim(thread.customer_user_id) || undefined,
            whatsapp_number: legacyIdentity.whatsappNumber,
            platform: legacyIdentity.platform,
            is_bot_active: false,
            last_message_at: now
        });
    } catch (_error) {
        const createdByOtherRequest = await ChatSession.findByPk(thread.id);
        if (createdByOtherRequest) return createdByOtherRequest;
        throw _error;
    }
};

const toMessageCreatedVia = (
    senderType: 'customer' | 'admin' | 'bot',
    channel: ChatMessageChannel
): 'system' | 'wa_mobile_sync' | 'admin_panel' => {
    if (channel === 'whatsapp' && senderType === 'customer') return 'wa_mobile_sync';
    if (senderType === 'admin') return 'admin_panel';
    return 'system';
};

const normalizedSearchNumberCandidates = (value: string): string[] => {
    const digits = value.replace(/\D/g, '');
    if (!digits) return [];

    const variants = new Set<string>([digits]);
    if (digits.startsWith('0')) {
        variants.add(`62${digits.slice(1)}`);
    } else if (digits.startsWith('62')) {
        variants.add(`0${digits.slice(2)}`);
    } else if (digits.startsWith('8')) {
        variants.add(`62${digits}`);
        variants.add(`0${digits}`);
    }
    return Array.from(variants);
};

const ensureThreadMember = async (
    threadId: string,
    userId: string,
    memberRole: 'participant' | 'support_agent' = 'participant'
) => {
    await ChatThreadMember.findOrCreate({
        where: { thread_id: threadId, user_id: userId },
        defaults: {
            thread_id: threadId,
            user_id: userId,
            member_role: memberRole
        }
    });
};

const findOrCreateThread = async (params: {
    threadKey: string;
    threadType: ChatThreadType;
    customerUserId?: string | null;
    externalWhatsappNumber?: string | null;
    isBotActive?: boolean;
}): Promise<ChatThread> => {
    const existing = await ChatThread.findOne({
        where: { thread_key: params.threadKey }
    });
    if (existing) {
        const updates: Partial<{
            customer_user_id: string | null;
            external_whatsapp_number: string | null;
            thread_type: ChatThreadType;
            is_bot_active: boolean;
        }> = {};
        if (params.customerUserId && existing.customer_user_id !== params.customerUserId) {
            updates.customer_user_id = params.customerUserId;
        }
        if (
            params.externalWhatsappNumber &&
            existing.external_whatsapp_number !== params.externalWhatsappNumber
        ) {
            updates.external_whatsapp_number = params.externalWhatsappNumber;
        }
        if (existing.thread_type !== params.threadType) {
            updates.thread_type = params.threadType;
        }
        if (typeof params.isBotActive === 'boolean' && existing.is_bot_active !== params.isBotActive) {
            updates.is_bot_active = params.isBotActive;
        }
        if (Object.keys(updates).length > 0) {
            await existing.update(updates);
        }
        return existing;
    }

    return await ChatThread.create({
        thread_key: params.threadKey,
        thread_type: params.threadType,
        customer_user_id: params.customerUserId || null,
        external_whatsapp_number: params.externalWhatsappNumber || null,
        is_bot_active: params.isBotActive ?? false,
        last_message_at: new Date()
    });
};

const getAssignedCustomerIdsByDriver = async (driverId: string): Promise<string[]> => {
    const [orderRows, returRows] = await Promise.all([
        Order.findAll({
            where: {
                courier_id: driverId,
                customer_id: { [Op.ne]: null as any }
            },
            attributes: ['customer_id'],
            raw: true
        }) as Promise<Array<{ customer_id?: string }>>,
        Retur.findAll({
            where: {
                courier_id: driverId,
                created_by: { [Op.ne]: null as any }
            },
            attributes: ['created_by'],
            raw: true
        }) as Promise<Array<{ created_by?: string }>>,
    ]);

    const result = new Set<string>();
    for (const row of orderRows) {
        const value = safeTrim(row.customer_id);
        if (value) result.add(value);
    }
    for (const row of returRows) {
        const value = safeTrim(row.created_by);
        if (value) result.add(value);
    }
    return Array.from(result);
};

const isDriverAssignedToCustomer = async (driverId: string, customerId: string): Promise<boolean> => {
    if (!driverId || !customerId) return false;

    const [order, retur] = await Promise.all([
        Order.findOne({
            where: { courier_id: driverId, customer_id: customerId },
            attributes: ['id']
        }),
        Retur.findOne({
            where: { courier_id: driverId, created_by: customerId },
            attributes: ['id']
        })
    ]);

    return Boolean(order || retur);
};

const getRelatedDriverIdsForCustomer = async (customerId: string): Promise<string[]> => {
    if (!customerId) return [];

    const [orders, returs] = await Promise.all([
        Order.findAll({
            where: { customer_id: customerId, courier_id: { [Op.ne]: null as any } },
            attributes: ['courier_id'],
            raw: true
        }) as Promise<Array<{ courier_id?: string }>>,
        Retur.findAll({
            where: { created_by: customerId, courier_id: { [Op.ne]: null as any } },
            attributes: ['courier_id'],
            raw: true
        }) as Promise<Array<{ courier_id?: string }>>,
    ]);

    const ids = new Set<string>();
    for (const row of orders) {
        const id = safeTrim(row.courier_id);
        if (id) ids.add(id);
    }
    for (const row of returs) {
        const id = safeTrim(row.courier_id);
        if (id) ids.add(id);
    }
    return Array.from(ids);
};

const isThreadMember = async (threadId: string, userId: string): Promise<boolean> => {
    if (!threadId || !userId) return false;
    const member = await ChatThreadMember.findOne({
        where: {
            thread_id: threadId,
            user_id: userId
        },
        attributes: ['id']
    });
    return Boolean(member);
};

const getThreadCustomerId = async (thread: ChatThread): Promise<string> => {
    const direct = safeTrim(thread.customer_user_id);
    if (direct) return direct;

    const row = await ChatThreadMember.findOne({
        where: { thread_id: thread.id },
        include: [{ model: User, attributes: ['id', 'role'], required: true }],
        attributes: ['id'],
    }) as any;
    const user = row?.User;
    if (user?.role === 'customer' && user?.id) return String(user.id);
    return '';
};

export const resolveSupportOmniThread = async (customerId: string): Promise<ChatThread> => {
    const thread = await findOrCreateThread({
        threadKey: buildSupportOmniKey(customerId),
        threadType: 'support_omni',
        customerUserId: customerId,
        isBotActive: false
    });
    await ensureThreadMember(thread.id, customerId, 'participant');
    return thread;
};

export const resolveStaffDmThread = async (a: string, b: string): Promise<ChatThread> => {
    const thread = await findOrCreateThread({
        threadKey: buildStaffDmKey(a, b),
        threadType: 'staff_dm',
        isBotActive: false
    });
    await Promise.all([
        ensureThreadMember(thread.id, a, 'participant'),
        ensureThreadMember(thread.id, b, 'participant')
    ]);
    return thread;
};

export const resolveStaffCustomerThread = async (staffId: string, customerId: string): Promise<ChatThread> => {
    const thread = await findOrCreateThread({
        threadKey: buildStaffCustomerKey(staffId, customerId),
        threadType: 'staff_customer',
        customerUserId: customerId,
        isBotActive: false
    });
    await Promise.all([
        ensureThreadMember(thread.id, staffId, 'participant'),
        ensureThreadMember(thread.id, customerId, 'participant')
    ]);
    return thread;
};

export const resolveWaLeadThread = async (rawNumber: string): Promise<ChatThread> => {
    const normalized = normalizeWhatsappNumber(rawNumber) || safeTrim(rawNumber) || `unknown-${Date.now()}`;
    const external = compactWithHash(normalized, WA_LEAD_EXTERNAL_MAX_LEN);
    return await findOrCreateThread({
        threadKey: buildWaLeadKey(normalized),
        threadType: 'wa_lead',
        externalWhatsappNumber: external,
        isBotActive: true
    });
};

const resolveWebGuestThread = async (guestId: string): Promise<ChatThread> => {
    const sanitized = safeTrim(guestId) || `anon-${Date.now()}`;
    const external = compactWithHash(`${GUEST_WEB_PREFIX}${sanitized}`, WA_LEAD_EXTERNAL_MAX_LEN);
    return await findOrCreateThread({
        threadKey: buildWaLeadKey(external),
        threadType: 'wa_lead',
        externalWhatsappNumber: external,
        isBotActive: false
    });
};

export const resolveThreadForLegacySession = async (
    session: ChatSession,
    options?: { senderId?: string; fallbackGuestId?: string }
): Promise<ChatThread> => {
    const bySessionId = await ChatThread.findByPk(session.id);
    if (bySessionId) return bySessionId;

    const sessionUserId = safeTrim(session.user_id);
    const sessionIdentity = safeTrim(session.whatsapp_number);

    if (sessionIdentity.startsWith('thread:')) {
        const token = safeTrim(sessionIdentity.slice('thread:'.length));
        if (token) {
            const byId = await ChatThread.findByPk(token);
            if (byId) return byId;

            const byKey = await ChatThread.findOne({ where: { thread_key: token } });
            if (byKey) return byKey;
        }
    }

    const identityPair = parseCustomerStaffIdentity(sessionIdentity);
    if (identityPair) {
        return await resolveStaffCustomerThread(identityPair.staffId, identityPair.customerId);
    }

    if (session.platform === 'whatsapp') {
        if (sessionUserId) {
            const user = await User.findByPk(sessionUserId, { attributes: ['id', 'role'] });
            if (user?.role === 'customer') {
                return await resolveSupportOmniThread(sessionUserId);
            }
        }
        return await resolveWaLeadThread(sessionIdentity);
    }

    if (sessionUserId) {
        const user = await User.findByPk(sessionUserId, { attributes: ['id', 'role'] });
        if (user?.role === 'customer') {
            return await resolveSupportOmniThread(sessionUserId);
        }

        const normalized = normalizeWhatsappNumber(sessionIdentity);
        if (normalized && user && isStaffRole(user.role)) {
            const candidates = getWhatsappLookupCandidates(normalized);
            const customer = await User.findOne({
                where: {
                    role: 'customer',
                    whatsapp_number: { [Op.in]: candidates },
                    status: 'active'
                },
                attributes: ['id']
            });
            if (customer?.id) {
                return await resolveStaffCustomerThread(sessionUserId, customer.id);
            }
        }
    }

    if (sessionIdentity.startsWith(GUEST_WEB_PREFIX)) {
        const guestId = safeTrim(options?.fallbackGuestId) || sessionIdentity.replace(/^webguest:/, '');
        return await resolveWebGuestThread(guestId);
    }

    if (sessionIdentity.startsWith('web-')) {
        const guestId = safeTrim(options?.fallbackGuestId) || sessionIdentity.replace(/^web-/, '');
        return await resolveWebGuestThread(guestId);
    }

    const normalizedIdentity = normalizeWhatsappNumber(sessionIdentity);
    if (normalizedIdentity) {
        return await resolveWaLeadThread(normalizedIdentity);
    }

    if (session.platform === 'web') {
        return await resolveWebGuestThread(session.id);
    }

    return await resolveWaLeadThread(`legacy-${session.id}`);
};

export const resolveThreadForIncomingWebSocket = async (params: {
    session?: ChatSession | null;
    incomingUserId?: string;
    incomingGuestId?: string;
    incomingWhatsappNumber?: string;
}): Promise<ChatThread> => {
    if (params.session) {
        return await resolveThreadForLegacySession(params.session, {
            senderId: params.incomingUserId,
            fallbackGuestId: params.incomingGuestId
        });
    }

    const userId = safeTrim(params.incomingUserId);
    if (userId) {
        const user = await User.findByPk(userId, { attributes: ['id', 'role'] });
        if (user?.role === 'customer') {
            return await resolveSupportOmniThread(user.id);
        }
    }

    const incomingNumber = normalizeWhatsappNumber(params.incomingWhatsappNumber || '');
    if (incomingNumber) {
        const candidates = getWhatsappLookupCandidates(incomingNumber);
        const customer = await User.findOne({
            where: {
                role: 'customer',
                status: 'active',
                whatsapp_number: { [Op.in]: candidates }
            },
            attributes: ['id']
        });
        if (customer?.id) {
            return await resolveSupportOmniThread(customer.id);
        }
    }

    if (safeTrim(params.incomingGuestId)) {
        return await resolveWebGuestThread(params.incomingGuestId || '');
    }

    return await resolveWaLeadThread(incomingNumber || `anon-${Date.now()}`);
};

export const resolveThreadForIncomingWhatsapp = async (params: {
    normalizedWhatsappNumber: string;
    user?: User | null;
}): Promise<ChatThread> => {
    if (params.user?.role === 'customer' && params.user.id) {
        return await resolveSupportOmniThread(params.user.id);
    }
    return await resolveWaLeadThread(params.normalizedWhatsappNumber);
};

export const createThreadMessage = async (payload: {
    threadId: string;
    senderType: 'customer' | 'admin' | 'bot';
    senderId?: string;
    body: string;
    attachmentUrl?: string;
    channel: ChatMessageChannel;
    quotedMessageId?: string;
    sessionId?: string;
    isRead?: boolean;
    createdVia?: 'system' | 'wa_mobile_sync' | 'admin_panel';
    deliveryState?: ChatDeliveryState;
}): Promise<Message> => {
    const thread = await ChatThread.findByPk(payload.threadId);
    if (!thread) {
        throw new Error('Thread not found');
    }

    const legacySession = await resolveOrCreateLegacySessionForThread(thread, payload.sessionId);
    const now = new Date();
    const isRead = payload.isRead ?? false;
    const deliveryState: ChatDeliveryState = payload.deliveryState || (isRead ? 'read' : 'sent');
    const message = await Message.create({
        session_id: legacySession.id,
        thread_id: payload.threadId,
        sender_type: payload.senderType,
        sender_id: payload.senderId || undefined,
        body: payload.body,
        attachment_url: payload.attachmentUrl || undefined,
        is_read: isRead,
        read_at: isRead ? now : null,
        created_via: payload.createdVia || toMessageCreatedVia(payload.senderType, payload.channel),
        channel: payload.channel,
        quoted_message_id: payload.quotedMessageId || undefined,
        delivery_state: deliveryState
    });

    await Promise.all([
        thread.update({ last_message_at: now }),
        legacySession.update({ last_message_at: now })
    ]);
    return message;
};

const ensureActor = async (actor: ChatActor): Promise<User> => {
    const user = await User.findByPk(actor.id, {
        attributes: ['id', 'role', 'status', 'name', 'whatsapp_number']
    });
    if (!user || user.status !== 'active') {
        throw new Error('ACTOR_NOT_FOUND');
    }
    return user;
};

export const canAccessThread = async (thread: ChatThread, actor: ChatActor): Promise<boolean> => {
    if (thread.thread_type === 'wa_lead') {
        return isSupportRole(actor.role);
    }

    if (thread.thread_type === 'support_omni') {
        if (isSupportRole(actor.role)) return true;
        if (isCustomerRole(actor.role)) {
            return safeTrim(thread.customer_user_id) === safeTrim(actor.id);
        }
        return await isThreadMember(thread.id, actor.id);
    }

    if (thread.thread_type === 'staff_dm') {
        if (!isStaffRole(actor.role)) return false;
        return await isThreadMember(thread.id, actor.id);
    }

    if (thread.thread_type === 'staff_customer') {
        if (isCustomerRole(actor.role)) {
            if (safeTrim(thread.customer_user_id) === safeTrim(actor.id)) return true;
            return await isThreadMember(thread.id, actor.id);
        }

        if (actor.role === 'driver') {
            const isMember = await isThreadMember(thread.id, actor.id);
            if (!isMember) return false;
            const customerId = await getThreadCustomerId(thread);
            if (!customerId) return false;
            return await isDriverAssignedToCustomer(actor.id, customerId);
        }

        return await isThreadMember(thread.id, actor.id);
    }

    return false;
};

const toThreadListItem = (params: {
    thread: ChatThread;
    actor: ChatActor;
    membersByThreadId: Map<string, Array<{ user_id: string; role: string; name: string; whatsapp_number: string }>>;
    latestMessageByThreadId: Map<string, Message>;
    unreadCountByThreadId: Map<string, number>;
}): any => {
    const thread = params.thread;
    const members = params.membersByThreadId.get(thread.id) || [];
    const latest = params.latestMessageByThreadId.get(thread.id) || null;
    const unread = params.unreadCountByThreadId.get(thread.id) || 0;

    const actorId = safeTrim(params.actor.id);
    const actorRole = safeTrim(params.actor.role);
    const others = members.filter((member) => safeTrim(member.user_id) !== actorId);

    let title = 'Percakapan';
    let subtitle = '';
    if (thread.thread_type === 'staff_dm') {
        const other = others[0] || members[0];
        title = other?.name || 'Staff';
        subtitle = other?.whatsapp_number || '';
    } else if (thread.thread_type === 'staff_customer') {
        if (actorRole === 'customer') {
            const staff = others.find((member) => isStaffRole(member.role)) || others[0];
            title = staff?.name || 'Staff';
            subtitle = staff?.whatsapp_number || '';
        } else {
            const customer = others.find((member) => member.role === 'customer') || others[0];
            title = customer?.name || 'Customer';
            subtitle = customer?.whatsapp_number || '';
        }
    } else if (thread.thread_type === 'support_omni') {
        if (actorRole === 'customer') {
            title = 'Tim Migunani Support';
            subtitle = '';
        } else {
            const customer = others.find((member) => member.role === 'customer') || members.find((member) => member.role === 'customer');
            title = customer?.name || 'Customer';
            subtitle = customer?.whatsapp_number || thread.external_whatsapp_number || '';
        }
    } else if (thread.thread_type === 'wa_lead') {
        title = `Lead WhatsApp`;
        subtitle = thread.external_whatsapp_number || '';
    }

    const latestPreview = latest
        ? (latest.body === '[Lampiran]' ? 'Lampiran' : latest.body || 'Lampiran')
        : 'Belum ada pesan';

    return {
        id: thread.id,
        thread_key: thread.thread_key,
        thread_type: thread.thread_type,
        title,
        subtitle,
        customer_user_id: thread.customer_user_id,
        external_whatsapp_number: thread.external_whatsapp_number,
        last_message_at: thread.last_message_at,
        unread_count: unread,
        latest_message: latest
            ? {
                id: latest.id,
                body: latest.body,
                attachment_url: latest.attachment_url,
                sender_type: latest.sender_type,
                sender_id: latest.sender_id,
                channel: latest.channel,
                created_via: latest.created_via,
                delivery_state: latest.delivery_state,
                is_read: latest.is_read,
                read_at: latest.read_at,
                createdAt: latest.createdAt,
            }
            : null,
        latest_preview: latestPreview
    };
};

export const listThreads = async (params: {
    actor: ChatActor;
    scope?: ThreadScope;
    q?: string;
    limit?: number;
    cursor?: string;
}) => {
    const actor = await ensureActor(params.actor);
    const limit = Number.isFinite(params.limit) ? Math.min(100, Math.max(1, Math.trunc(params.limit || 20))) : 20;
    const cursorDate = params.cursor ? new Date(params.cursor) : null;
    const whereClause: any = {};
    if (params.scope) {
        whereClause['thread_type'] = params.scope;
    }
    if (cursorDate && !Number.isNaN(cursorDate.getTime())) {
        whereClause['last_message_at'] = { [Op.lt]: cursorDate };
    }

    const rows = await ChatThread.findAll({
        where: whereClause,
        order: [['last_message_at', 'DESC']],
        limit: Math.max(limit * 3, 60),
    });

    const filtered: ChatThread[] = [];
    for (const row of rows) {
        if (await canAccessThread(row, actor)) {
            filtered.push(row);
        }
        if (filtered.length >= limit * 2) break;
    }

    const threadIds = filtered.map((thread) => thread.id);
    if (threadIds.length === 0) {
        return {
            threads: [],
            next_cursor: null
        };
    }

    const [memberRows, latestRows, unreadRows] = await Promise.all([
        ChatThreadMember.findAll({
            where: { thread_id: { [Op.in]: threadIds } },
            include: [{
                model: User,
                attributes: ['id', 'name', 'role', 'whatsapp_number'],
                required: true
            }],
            attributes: ['thread_id', 'user_id'],
            raw: true
        }) as Promise<Array<any>>,
        sequelize.query<any>(
            `
            SELECT m.*
            FROM messages m
            INNER JOIN (
                SELECT thread_id, MAX(id) AS last_id
                FROM messages
                WHERE thread_id IN (:threadIds)
                GROUP BY thread_id
            ) lm ON lm.last_id = m.id
            `,
            {
                replacements: { threadIds },
                type: QueryTypes.SELECT
            }
        ),
        sequelize.query<{ thread_id: string; total: number | string }>(
            `
            SELECT thread_id, COUNT(*) AS total
            FROM messages
            WHERE thread_id IN (:threadIds)
              AND read_at IS NULL
              AND (sender_id IS NULL OR sender_id <> :actorId)
            GROUP BY thread_id
            `,
            {
                replacements: { threadIds, actorId: actor.id },
                type: QueryTypes.SELECT
            }
        )
    ]);

    const membersByThreadId = new Map<string, Array<{ user_id: string; role: string; name: string; whatsapp_number: string }>>();
    for (const row of memberRows) {
        const threadId = safeTrim(row.thread_id);
        if (!threadId) continue;
        const current = membersByThreadId.get(threadId) || [];
        current.push({
            user_id: safeTrim(row['User.id']),
            role: safeTrim(row['User.role']),
            name: safeTrim(row['User.name']),
            whatsapp_number: safeTrim(row['User.whatsapp_number']),
        });
        membersByThreadId.set(threadId, current);
    }

    const latestMessageByThreadId = new Map<string, Message>();
    for (const row of latestRows as any[]) {
        const threadId = safeTrim(row.thread_id);
        if (!threadId || latestMessageByThreadId.has(threadId)) continue;
        latestMessageByThreadId.set(threadId, row as Message);
    }

    const unreadCountByThreadId = new Map<string, number>();
    for (const row of unreadRows as Array<{ thread_id: string; total: number | string }>) {
        unreadCountByThreadId.set(safeTrim(row.thread_id), Number(row.total || 0));
    }

    let mapped = filtered.map((thread) => toThreadListItem({
        thread,
        actor,
        membersByThreadId,
        latestMessageByThreadId,
        unreadCountByThreadId
    }));

    const query = safeTrim(params.q).toLowerCase();
    if (query) {
        mapped = mapped.filter((item) => {
            const haystack = [
                safeTrim(item.title),
                safeTrim(item.subtitle),
                safeTrim(item.latest_preview),
                safeTrim(item.external_whatsapp_number),
            ].join(' ').toLowerCase();
            if (haystack.includes(query)) return true;
            const needleCandidates = normalizedSearchNumberCandidates(query);
            const phoneText = safeTrim(item.subtitle).replace(/\D/g, '');
            if (!phoneText || needleCandidates.length === 0) return false;
            return needleCandidates.some((needle) => phoneText.includes(needle) || needle.includes(phoneText));
        });
    }

    const trimmed = mapped.slice(0, limit);
    const nextCursor = trimmed.length >= limit
        ? safeTrim(trimmed[trimmed.length - 1]?.last_message_at || '')
        : null;

    return {
        threads: trimmed,
        next_cursor: nextCursor || null
    };
};

export const openThread = async (params: {
    actor: ChatActor;
    targetUserId?: string;
    mode: OpenThreadMode;
}) => {
    const actor = await ensureActor(params.actor);
    const mode = params.mode;
    const targetUserId = safeTrim(params.targetUserId);
    const targetUser = targetUserId
        ? await User.findByPk(targetUserId, { attributes: ['id', 'role', 'status'] })
        : null;

    if (targetUserId && (!targetUser || targetUser.status !== 'active')) {
        throw new Error('TARGET_NOT_FOUND');
    }

    if (mode === 'staff_dm') {
        if (!targetUser) throw new Error('TARGET_REQUIRED');
        if (!isStaffRole(actor.role) || !isStaffRole(targetUser.role)) {
            throw new Error('INVALID_STAFF_DM');
        }
        return await resolveStaffDmThread(actor.id, targetUser.id);
    }

    if (mode === 'staff_customer') {
        if (!targetUser) throw new Error('TARGET_REQUIRED');

        if (isStaffRole(actor.role) && targetUser.role === 'customer') {
            if (actor.role === 'driver') {
                const hasAccess = await isDriverAssignedToCustomer(actor.id, targetUser.id);
                if (!hasAccess) throw new Error('DRIVER_CUSTOMER_FORBIDDEN');
            } else if (!(isSupportRole(actor.role) || actor.role === 'admin_finance')) {
                throw new Error('STAFF_CUSTOMER_FORBIDDEN');
            }
            return await resolveStaffCustomerThread(actor.id, targetUser.id);
        }

        if (actor.role === 'customer' && isStaffRole(targetUser.role)) {
            if (targetUser.role === 'driver') {
                const relatedDrivers = await getRelatedDriverIdsForCustomer(actor.id);
                if (!relatedDrivers.includes(targetUser.id)) {
                    throw new Error('CUSTOMER_DRIVER_FORBIDDEN');
                }
                return await resolveStaffCustomerThread(targetUser.id, actor.id);
            }
            throw new Error('CUSTOMER_STAFF_FORBIDDEN');
        }

        throw new Error('INVALID_STAFF_CUSTOMER');
    }

    if (mode === 'support') {
        if (actor.role === 'customer') {
            return await resolveSupportOmniThread(actor.id);
        }
        if (isSupportRole(actor.role) && targetUser?.role === 'customer') {
            return await resolveSupportOmniThread(targetUser.id);
        }
        throw new Error('SUPPORT_FORBIDDEN');
    }

    throw new Error('INVALID_MODE');
};

export const listContacts = async (params: {
    actor: ChatActor;
    type: ContactQueryType;
    q?: string;
    limit?: number;
}) => {
    const actor = await ensureActor(params.actor);
    const limit = Number.isFinite(params.limit) ? Math.min(100, Math.max(1, Math.trunc(params.limit || 20))) : 20;
    const query = safeTrim(params.q);

    const baseFilter = (whereRole: string[] | null, whereExtra?: any) => {
        const whereClause: any = {
            status: 'active',
            ...(whereRole ? { role: { [Op.in]: whereRole } } : {}),
            ...(whereExtra || {})
        };
        if (query) {
            const phoneCandidates = normalizedSearchNumberCandidates(query);
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${query}%` } },
                { email: { [Op.like]: `%${query}%` } },
                ...phoneCandidates.map((candidate) => ({ whatsapp_number: { [Op.like]: `%${candidate}%` } }))
            ];
        }
        return whereClause;
    };

    if (params.type === 'staff') {
        let roles = Array.from(STAFF_ROLES);
        if (actor.role === 'customer') {
            const relatedDrivers = await getRelatedDriverIdsForCustomer(actor.id);
            const supportRows = await User.findAll({
                where: baseFilter(['super_admin', 'kasir']),
                attributes: ['id', 'name', 'role', 'whatsapp_number'],
                limit
            });
            const driverRows = relatedDrivers.length > 0
                ? await User.findAll({
                    where: baseFilter(['driver'], { id: { [Op.in]: relatedDrivers } }),
                    attributes: ['id', 'name', 'role', 'whatsapp_number'],
                    limit
                })
                : [];
            const rows = [...supportRows, ...driverRows]
                .filter((row) => safeTrim((row as any).id) !== actor.id);
            return rows.slice(0, limit);
        }

        const rows = await User.findAll({
            where: baseFilter(roles, { id: { [Op.ne]: actor.id } }),
            attributes: ['id', 'name', 'role', 'whatsapp_number'],
            order: [['name', 'ASC']],
            limit
        });
        return rows;
    }

    if (params.type === 'customer_contextual') {
        if (actor.role === 'driver') {
            const customerIds = await getAssignedCustomerIdsByDriver(actor.id);
            if (customerIds.length === 0) return [];
            return await User.findAll({
                where: baseFilter(['customer'], { id: { [Op.in]: customerIds } }),
                attributes: ['id', 'name', 'role', 'whatsapp_number'],
                order: [['name', 'ASC']],
                limit
            });
        }
        if (isSupportRole(actor.role)) {
            return await User.findAll({
                where: baseFilter(['customer']),
                attributes: ['id', 'name', 'role', 'whatsapp_number'],
                order: [['name', 'ASC']],
                limit
            });
        }
    }

    return [];
};

export const getThreadMessages = async (params: {
    actor: ChatActor;
    threadId: string;
    cursor?: string;
    limit?: number;
}) => {
    const actor = await ensureActor(params.actor);
    const threadId = safeTrim(params.threadId);
    const thread = await ChatThread.findByPk(threadId);
    if (!thread) throw new Error('THREAD_NOT_FOUND');

    const canAccess = await canAccessThread(thread, actor);
    if (!canAccess) throw new Error('THREAD_FORBIDDEN');

    const limit = Number.isFinite(params.limit) ? Math.min(200, Math.max(1, Math.trunc(params.limit || 50))) : 50;
    const cursor = safeTrim(params.cursor);
    const whereClause: any = { thread_id: threadId };
    if (cursor) {
        whereClause.id = { [Op.lt]: cursor };
    }

    const rows = await Message.findAll({
        where: whereClause,
        include: [{
            model: User,
            attributes: ['id', 'name', 'role', 'whatsapp_number'],
            required: false
        }],
        order: [['id', 'DESC']],
        limit
    });

    const reversed = rows.reverse();
    const quotedIds = Array.from(new Set(
        reversed
            .map((row) => safeTrim(row.quoted_message_id))
            .filter((id) => id.length > 0)
    ));
    const quotedRows = quotedIds.length > 0
        ? await Message.findAll({
            where: { id: { [Op.in]: quotedIds } },
            attributes: ['id', 'body', 'sender_id', 'sender_type', 'createdAt']
        })
        : [];
    const quotedMap = new Map<string, Message>();
    for (const row of quotedRows) {
        quotedMap.set(String(row.id), row);
    }

    const messages = reversed.map((row) => {
        const quoted = row.quoted_message_id ? quotedMap.get(String(row.quoted_message_id)) : null;
        return {
            id: row.id,
            session_id: row.session_id,
            thread_id: row.thread_id,
            body: row.body,
            attachment_url: row.attachment_url,
            sender_type: row.sender_type,
            sender_id: row.sender_id,
            channel: row.channel,
            created_via: row.created_via,
            delivery_state: row.delivery_state,
            is_read: row.is_read,
            read_at: row.read_at,
            createdAt: row.createdAt,
            User: (row as any).User || null,
            quoted_message: quoted
                ? {
                    id: quoted.id,
                    body: quoted.body,
                    sender_id: quoted.sender_id,
                    sender_type: quoted.sender_type,
                    createdAt: quoted.createdAt
                }
                : null
        };
    });

    const nextCursor = rows.length >= limit ? String(rows[rows.length - 1]?.id || '') : '';
    return {
        thread,
        messages,
        next_cursor: nextCursor || null
    };
};

export const markThreadAsRead = async (params: {
    actor: ChatActor;
    threadId: string;
}) => {
    const actor = await ensureActor(params.actor);
    const thread = await ChatThread.findByPk(safeTrim(params.threadId));
    if (!thread) throw new Error('THREAD_NOT_FOUND');

    const canAccess = await canAccessThread(thread, actor);
    if (!canAccess) throw new Error('THREAD_FORBIDDEN');

    const now = new Date();
    const [updatedCount] = await Message.update(
        {
            is_read: true,
            read_at: now,
            delivery_state: 'read'
        },
        {
            where: {
                thread_id: thread.id,
                read_at: { [Op.is]: null },
                [Op.or]: [
                    { sender_id: { [Op.ne]: actor.id } },
                    { sender_id: { [Op.is]: null as any } }
                ]
            }
        }
    );

    return {
        thread,
        updated_count: Number(updatedCount || 0)
    };
};

export const backfillLegacyChatSessionsToThreads = async () => {
    const sessions = await ChatSession.findAll({
        attributes: ['id', 'user_id', 'whatsapp_number', 'platform', 'last_message_at']
    });

    for (const session of sessions) {
        const thread = await resolveThreadForLegacySession(session);
        await Message.update(
            {
                thread_id: thread.id,
            },
            {
                where: {
                    session_id: session.id,
                    thread_id: { [Op.is]: null }
                }
            }
        );
    }

    await sequelize.query(
        `
        UPDATE messages
        SET channel = 'whatsapp'
        WHERE created_via = 'wa_mobile_sync'
          AND (channel <> 'whatsapp' OR channel IS NULL)
        `
    );
    await sequelize.query(
        `
        UPDATE messages
        SET delivery_state = CASE WHEN is_read = 1 THEN 'read' ELSE 'sent' END
        WHERE delivery_state IS NULL OR delivery_state NOT IN ('sent', 'delivered', 'read', 'failed')
        `
    );
    await sequelize.query(
        `
        UPDATE messages
        SET read_at = COALESCE(read_at, updatedAt)
        WHERE is_read = 1 AND read_at IS NULL
        `
    );
};
