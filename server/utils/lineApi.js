// Thin wrapper around the LINE Messaging API.
//
// Used at subscription registration time to:
//   1. Verify the channel access token is valid & retrieve bot identity.
//   2. Verify the bot is actually present in the target user/group/room.
//   3. Send a one-shot "connection confirmed" message.
//
// Why not just save what the user typed?
//   A wrong token or a chatId from a group the bot was never added to looks
//   identical to a working one until the FIRST real alert fires — and then
//   it fails silently. Verifying at registration makes the failure mode
//   immediate and recoverable.
//
// Uses Node 20+ global fetch — no extra dependency.

const crypto = require('crypto');

const LINE_API_BASE = 'https://api.line.me/v2/bot';

class LineApiError extends Error {
    constructor(message, { status, code, hint } = {}) {
        super(message);
        this.name = 'LineApiError';
        this.status = status;
        this.code = code;
        this.hint = hint;
    }
}

// Extract the most informative human-readable detail LINE gave us.
// LINE error responses come in a few shapes — try them all in order.
function extractLineDetail(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    const parts = [];
    if (body.message) parts.push(body.message);
    // Field-level validation errors: details: [{ message, property }]
    if (Array.isArray(body.details) && body.details.length) {
        parts.push(body.details.map(d => `${d.property || ''} ${d.message || ''}`.trim()).join('; '));
    }
    if (body.error_description) parts.push(body.error_description);
    if (body.error) parts.push(typeof body.error === 'string' ? body.error : JSON.stringify(body.error));
    return parts.filter(Boolean).join(' — ') || JSON.stringify(body).slice(0, 200);
}

// Map LINE-style HTTP errors into a friendly message + actionable hint.
function classifyError(status, body, path) {
    const detail = extractLineDetail(body);
    if (status === 400) {
        return new LineApiError(
            `LINE ปฏิเสธคำขอ (400): ${detail || 'ข้อมูลไม่ถูกต้อง'}`,
            { status, code: 'bad_request', hint: `path=${path}` }
        );
    }
    if (status === 401) {
        return new LineApiError(
            'Channel Access Token ไม่ถูกต้องหรือหมดอายุ',
            { status, code: 'invalid_token', hint: detail || 'ตรวจสอบ Token ใน LINE Official Account Manager → Messaging API' }
        );
    }
    if (status === 403) {
        return new LineApiError(
            'Token นี้ไม่มีสิทธิ์เข้าถึงข้อมูลที่ขอ (ตรวจสอบว่า Channel เป็น Messaging API)',
            { status, code: 'forbidden', hint: detail }
        );
    }
    if (status === 404) {
        return new LineApiError(
            'ไม่พบกลุ่ม/ห้องนี้ — Bot อาจยังไม่ได้เข้าร่วม',
            { status, code: 'chat_not_found', hint: detail || 'เชิญ LINE Official Account เข้ากลุ่มก่อน แล้วลองอีกครั้ง' }
        );
    }
    if (status === 429) {
        return new LineApiError('LINE API ถูก rate-limit ชั่วคราว กรุณาลองใหม่ในอีกครู่', { status, code: 'rate_limited', hint: detail });
    }
    return new LineApiError(`LINE API error (${status}): ${detail || 'unknown'}`, { status, code: 'unknown', hint: `path=${path}` });
}

async function lineFetch(path, { token, method = 'GET', body } = {}) {
    const headers = {
        Authorization: `Bearer ${token}`,
    };
    if (body) headers['Content-Type'] = 'application/json';

    let res;
    try {
        res = await fetch(`${LINE_API_BASE}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (networkErr) {
        throw new LineApiError('เชื่อมต่อ LINE API ไม่ได้ — ตรวจสอบอินเทอร์เน็ตของเซิร์ฟเวอร์', {
            status: 0, code: 'network', hint: networkErr.message,
        });
    }

    // Read body as text first so we can both log it AND attempt JSON parse
    // — some 400s come back as text/plain or empty.
    const rawText = await res.text().catch(() => '');
    let payload = null;
    if (rawText) {
        try { payload = JSON.parse(rawText); } catch { payload = rawText; }
    }

    if (!res.ok) {
        // Always log on the server so the operator sees what LINE actually said.
        console.error(`[lineApi] ${method} ${path} -> ${res.status}`, rawText.slice(0, 500));
        throw classifyError(res.status, payload, path);
    }
    return payload;
}

// ---------- Public helpers ----------

// Returns bot identity. Validates the token is alive.
// Docs: GET /v2/bot/info
async function getBotInfo(token) {
    return lineFetch('/info', { token });
    // { userId, basicId, premiumId?, displayName, pictureUrl?, chatMode, markAsReadMode }
}

// Detects chat type from the chatId prefix and verifies the bot can reach it.
// Returns { chatType, chatId, displayName?, pictureUrl? }
async function verifyChatTarget(token, chatId) {
    if (!chatId || typeof chatId !== 'string') {
        throw new LineApiError('Chat ID ว่าง', { status: 400, code: 'invalid_chatid' });
    }
    const head = chatId.charAt(0).toUpperCase();

    if (head === 'C') {
        // Group: /v2/bot/group/{groupId}/summary
        const sum = await lineFetch(`/group/${encodeURIComponent(chatId)}/summary`, { token });
        return { chatType: 'group', chatId, displayName: sum.groupName, pictureUrl: sum.pictureUrl };
    }
    if (head === 'R') {
        // Room: no summary endpoint. Use members count as a reachability probe.
        const ids = await lineFetch(`/room/${encodeURIComponent(chatId)}/members/ids`, { token });
        return { chatType: 'room', chatId, displayName: `Room (${(ids.memberIds || []).length} members)` };
    }
    if (head === 'U') {
        // 1:1 user: /v2/bot/profile/{userId}
        const p = await lineFetch(`/profile/${encodeURIComponent(chatId)}`, { token });
        return { chatType: 'user', chatId, displayName: p.displayName, pictureUrl: p.pictureUrl };
    }
    throw new LineApiError(
        `รูปแบบ Chat ID ไม่ถูกต้อง (ขึ้นต้นด้วย U / C / R เท่านั้น พบ '${head}')`,
        { status: 400, code: 'invalid_chatid_prefix' }
    );
}

// Send a simple text message. Used both for the post-registration test and
// future dispatcher calls. Docs: POST /v2/bot/message/push
async function pushTextMessage(token, chatId, text) {
    return lineFetch('/message/push', {
        token,
        method: 'POST',
        body: { to: chatId, messages: [{ type: 'text', text: String(text).slice(0, 5000) }] },
    });
}

// Reply to a webhook event using its replyToken. Token is single-use and
// valid for ~30 seconds — must be sent immediately when the event arrives.
// Docs: POST /v2/bot/message/reply
async function replyTextMessage(token, replyToken, text) {
    return lineFetch('/message/reply', {
        token,
        method: 'POST',
        body: {
            replyToken,
            messages: [{ type: 'text', text: String(text).slice(0, 5000) }],
        },
    });
}

// Verify the X-Line-Signature header against the raw request body.
// LINE signs every webhook delivery with HMAC-SHA256 using the channel
// secret; rejecting unsigned requests prevents anyone from POSTing forged
// events at our endpoint. Returns true on match.
function verifyWebhookSignature(channelSecret, rawBody, signatureHeader) {
    if (!channelSecret || !rawBody || !signatureHeader) return false;
    const expected = crypto
        .createHmac('SHA256', channelSecret)
        .update(rawBody)
        .digest('base64');
    // Constant-time compare to avoid timing attacks.
    try {
        const a = Buffer.from(expected);
        const b = Buffer.from(String(signatureHeader));
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

module.exports = {
    LineApiError,
    getBotInfo,
    verifyChatTarget,
    pushTextMessage,
    replyTextMessage,
    verifyWebhookSignature,
};
