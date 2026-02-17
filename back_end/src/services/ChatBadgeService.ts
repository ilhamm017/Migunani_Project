import { Op } from 'sequelize';
import { ChatThread, ChatThreadMember, User } from '../models';
import { ChatActor, listThreads } from './ChatThreadService';

export type ChatUnreadBadgePayload = {
    user_id: string;
    total_unread: number;
};

const CHAT_ENABLED_ROLES = new Set([
    'super_admin',
    'kasir',
    'admin_gudang',
    'admin_finance',
    'driver',
    'customer'
]);

const SUPPORT_ROLES = ['super_admin', 'kasir'] as const;
const MAX_THREAD_PAGES = 20;

const safeTrim = (value: unknown): string => String(value || '').trim();

const isChatEnabledRole = (role: unknown): boolean => CHAT_ENABLED_ROLES.has(safeTrim(role));

const toChatActor = (row: { id?: string; role?: string; whatsapp_number?: string | null }): ChatActor => ({
    id: safeTrim(row.id),
    role: safeTrim(row.role),
    whatsapp_number: safeTrim(row.whatsapp_number)
});

const computeUnreadTotalForActor = async (actor: ChatActor): Promise<number> => {
    let total = 0;
    let cursor: string | undefined;
    const seenCursors = new Set<string>();

    for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
        const result = await listThreads({
            actor,
            limit: 100,
            cursor
        });

        const rows = Array.isArray(result?.threads) ? result.threads : [];
        total += rows.reduce((acc: number, row: any) => acc + Number(row?.unread_count || 0), 0);

        const nextCursor = safeTrim(result?.next_cursor);
        if (!nextCursor || rows.length === 0 || seenCursors.has(nextCursor)) {
            break;
        }

        seenCursors.add(nextCursor);
        cursor = nextCursor;
    }

    return total;
};

const toUniqueIds = (values: string[]): string[] => {
    return Array.from(new Set(values.map((value) => safeTrim(value)).filter(Boolean)));
};

export const buildUnreadBadgePayloadsForUserIds = async (userIds: string[]): Promise<ChatUnreadBadgePayload[]> => {
    const uniqueIds = toUniqueIds(userIds);
    if (uniqueIds.length === 0) return [];

    const users = await User.findAll({
        where: {
            id: { [Op.in]: uniqueIds },
            status: 'active',
            role: { [Op.in]: Array.from(CHAT_ENABLED_ROLES) as string[] }
        },
        attributes: ['id', 'role', 'whatsapp_number'],
        raw: true
    }) as Array<{ id: string; role: string; whatsapp_number?: string | null }>;

    const payloads = await Promise.all(users.map(async (user) => {
        const totalUnread = await computeUnreadTotalForActor(toChatActor(user));
        return {
            user_id: safeTrim(user.id),
            total_unread: totalUnread
        };
    }));

    return payloads.filter((payload) => !!payload.user_id);
};

export const buildUnreadBadgePayloadForUser = async (userId: string): Promise<ChatUnreadBadgePayload | null> => {
    const payloads = await buildUnreadBadgePayloadsForUserIds([userId]);
    return payloads[0] || null;
};

export const buildUnreadBadgePayloadsForThread = async (params: {
    threadId: string;
    excludeUserId?: string;
}): Promise<ChatUnreadBadgePayload[]> => {
    const threadId = safeTrim(params.threadId);
    if (!threadId) return [];

    const thread = await ChatThread.findByPk(threadId, {
        attributes: ['id', 'thread_type', 'customer_user_id']
    });
    if (!thread) return [];

    const targetUserIds = new Set<string>();
    const customerId = safeTrim(thread.customer_user_id);
    if (customerId) {
        targetUserIds.add(customerId);
    }

    const memberRows = await ChatThreadMember.findAll({
        where: { thread_id: thread.id },
        include: [{
            model: User,
            attributes: ['id', 'role', 'status'],
            required: true
        }],
        attributes: ['user_id']
    }) as unknown as Array<{ user_id?: string; User?: { id?: string; role?: string; status?: string } }>;

    for (const row of memberRows) {
        const memberId = safeTrim(row?.User?.id || row?.user_id);
        const memberRole = safeTrim(row?.User?.role);
        const memberStatus = safeTrim(row?.User?.status);
        if (!memberId) continue;
        if (memberStatus && memberStatus !== 'active') continue;
        if (!isChatEnabledRole(memberRole)) continue;
        targetUserIds.add(memberId);
    }

    if (thread.thread_type === 'support_omni' || thread.thread_type === 'wa_lead') {
        const supportRows = await User.findAll({
            where: {
                role: { [Op.in]: SUPPORT_ROLES as unknown as string[] },
                status: 'active'
            },
            attributes: ['id'],
            raw: true
        }) as Array<{ id: string }>;
        for (const row of supportRows) {
            const id = safeTrim(row.id);
            if (id) targetUserIds.add(id);
        }
    }

    const excludeUserId = safeTrim(params.excludeUserId);
    if (excludeUserId) {
        targetUserIds.delete(excludeUserId);
    }

    return await buildUnreadBadgePayloadsForUserIds(Array.from(targetUserIds));
};
