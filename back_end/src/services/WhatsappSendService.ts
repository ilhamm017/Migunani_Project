import fs from 'fs';
import path from 'path';
import { MessageMedia } from 'whatsapp-web.js';
import waClient, { getStatus as getWhatsappStatus } from './whatsappClient';

export type WhatsappSendStatus = 'sent' | 'skipped_not_ready' | 'skipped_no_target' | 'failed_soft';

export interface WhatsappSendResult {
    channel: 'whatsapp';
    target: string | null;
    status: WhatsappSendStatus;
    reason: string | null;
    request_context: string;
}

type SendWhatsappParams = {
    target: string | null | undefined;
    requestContext: string;
    textBody?: string | null;
    attachmentPath?: string | null;
};

const maskTarget = (value: string | null): string | null => {
    if (!value) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    if (normalized.length <= 6) return `${normalized.slice(0, 2)}***`;
    return `${normalized.slice(0, 4)}***${normalized.slice(-3)}`;
};

const buildChatId = (target: string): string => (
    target.includes('@c.us') ? target : `${target}@c.us`
);

const logSendResult = (result: WhatsappSendResult, error?: unknown) => {
    const payload = {
        context: result.request_context,
        channel: result.channel,
        target: maskTarget(result.target),
        status: result.status,
        reason: result.reason
    };

    if (result.status === 'sent') {
        console.info('[WA_SEND]', payload);
        return;
    }

    if (result.status === 'skipped_not_ready' || result.status === 'skipped_no_target') {
        console.warn('[WA_SEND]', payload);
        return;
    }

    console.error('[WA_SEND]', payload);
    if (error) {
        console.error('[WA_SEND_UNEXPECTED]', error);
    }
};

export const sendWhatsappSafe = async (params: SendWhatsappParams): Promise<WhatsappSendResult> => {
    const target = String(params.target || '').trim();
    const textBody = String(params.textBody || '').trim();
    const attachmentPath = String(params.attachmentPath || '').trim();
    const requestContext = String(params.requestContext || 'unknown').trim() || 'unknown';

    if (!target) {
        const result: WhatsappSendResult = {
            channel: 'whatsapp',
            target: null,
            status: 'skipped_no_target',
            reason: 'missing_target',
            request_context: requestContext
        };
        logSendResult(result);
        return result;
    }

    const currentStatus = getWhatsappStatus();
    if (currentStatus !== 'READY') {
        const result: WhatsappSendResult = {
            channel: 'whatsapp',
            target,
            status: 'skipped_not_ready',
            reason: `client_status:${currentStatus}`,
            request_context: requestContext
        };
        logSendResult(result);
        return result;
    }

    try {
        const chatId = buildChatId(target);
        if (attachmentPath) {
            const absolutePath = path.resolve(process.cwd(), attachmentPath.replace(/^\/+/, ''));
            if (!fs.existsSync(absolutePath)) {
                const result: WhatsappSendResult = {
                    channel: 'whatsapp',
                    target,
                    status: 'failed_soft',
                    reason: 'attachment_missing',
                    request_context: requestContext
                };
                logSendResult(result);
                return result;
            }

            const media = await MessageMedia.fromFilePath(absolutePath);
            await waClient.sendMessage(chatId, media, textBody ? { caption: textBody } : undefined);
        } else {
            await waClient.sendMessage(chatId, textBody);
        }

        const result: WhatsappSendResult = {
            channel: 'whatsapp',
            target,
            status: 'sent',
            reason: null,
            request_context: requestContext
        };
        logSendResult(result);
        return result;
    } catch (error) {
        const result: WhatsappSendResult = {
            channel: 'whatsapp',
            target,
            status: 'failed_soft',
            reason: error instanceof Error ? error.message : 'unknown_error',
            request_context: requestContext
        };
        logSendResult(result, error);
        return result;
    }
};
