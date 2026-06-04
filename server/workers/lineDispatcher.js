// LINE Bot Dispatcher (worker module)
// ---------------------------------------------------------------------------
// Polls dbo.NotifyLog and pushes new alerts to every active LINE subscription
// via the LINE Messaging API.
//
// Why a separate channel from webpushDispatcher:
//   The web push dispatcher flips NotifyLog.status from 'pending' → 'sent',
//   which is fine when there's only one channel competing for the row. With
//   two channels we'd race each other and one would skip rows the other had
//   already flipped. We solve this by giving each LINE subscription its own
//   cursor: `UserNotificationSubscription.last_delivered_log_id`. The web
//   push dispatcher stays untouched.
//
// Delivery semantics (per LINE subscription):
//   * On subscribe: cursor is set to MAX(NotifyLog.log_id) at that moment
//     so a brand-new subscriber does NOT get flooded with backlog.
//   * Each tick: for each active LINE sub, fetch up to 5 NotifyLog rows
//     newer than the cursor that match scope + org rules, send them in a
//     single `/v2/bot/message/push` call (LINE accepts up to 5 messages per
//     request), then advance the cursor to the highest delivered log_id.
//   * Dead subscriptions (401 rotated token, 403/404 bot kicked from group)
//     are flipped to is_active = 0 — they stop being polled until the user
//     re-subscribes via the modal.
//
// Assumes:
//   * global.dbPool is ready (set by index.js / worker.js before start()).
//   * `node-fetch` is available globally (Node 20+).

const { sql } = require('../db');
const lineApi = require('../utils/lineApi');
const { DecryptToken } = require('../utils/crypto');
const { lineReason } = require('../utils/failureReason');

// ---- Tunables ------------------------------------------------------------
const LINE_POLL_MS  = 5000;   // 5s — LINE is less time-critical than browser push
const LINE_BATCH    = 5;      // LINE /message/push accepts up to 5 messages per call
const LINE_MAX_TEXT = 4900;   // LINE allows 5000; keep a little headroom

let dispatchRunning = false;
let pollTimer = null;

// ---- Message formatting --------------------------------------------------

function formatMessage(row) {
    const evt = row.event_type || 'raise';
    const isCleared = evt === 'cleared';
    const icon = isCleared ? '✅' : (evt === 'escalate' ? '⚠️' : '🚨');
    const tag  = isCleared ? 'OK' : (evt === 'escalate' ? 'ESCALATED' : 'ALARM');
    const org  = row.c_name ? `${row.c_name} ・ ` : '';
    const head = `${icon} ${tag}: ${org}${row.mqtt_serial || ''} - ${row.dbkey || ''} ${row.level || ''}`.trim();

    const detail = isCleared
        ? `${row.message || 'Returned to normal'}\nCurrent value: ${row.value}`
        : `${row.message || 'Alert'}\nValue: ${row.value}${row.point != null ? ` (threshold ${row.point})` : ''}`;

    let when = '';
    if (row.event_time) {
        const d = new Date(row.event_time);
        if (!isNaN(d)) when = `\n${d.toLocaleString('th-TH', { hour12: false })}`;
    }
    const text = `${head}\n${detail}${when}`;
    return text.length > LINE_MAX_TEXT ? text.slice(0, LINE_MAX_TEXT - 1) + '…' : text;
}

// ---- Dispatch tick -------------------------------------------------------

async function dispatchLine() {
    if (dispatchRunning || !global.dbPool) return;
    dispatchRunning = true;
    try {
        // All active LINE subs + org context for scoping.
        const subsRes = await global.dbPool.request().query(`
            SELECT s.subscription_id, s.user_id, s.destination,
                   s.scope, s.scope_value, s.last_delivered_log_id,
                   u.c_id AS user_c_id, g.c_active
            FROM dbo.UserNotificationSubscription s
            INNER JOIN dbo.WebUser u ON u.u_id = s.user_id
            LEFT  JOIN dbo.WebGroup g ON g.c_id = u.c_id
            WHERE s.is_active = 1
              AND s.channel = 'line'
              AND s.destination IS NOT NULL
        `);

        for (const sub of subsRes.recordset) {
            // Parse & decrypt token. Skip subs whose payload is malformed
            // (legacy plaintext rows, missing fields, etc.) — they need to
            // re-subscribe via the modal to be upgraded.
            let token, chatId;
            try {
                const d = JSON.parse(sub.destination);
                chatId = d.chatId;
                token  = d.tokenCipher ? DecryptToken(d.tokenCipher) : d.token;
            } catch {
                continue;
            }
            if (!token || !chatId) continue;

            const isSuper = sub.c_active === 'Z';
            const cursor  = sub.last_delivered_log_id || 0;

            // Pick the next batch of unsent rows for this subscription.
            // Scope rules mirror the webpush dispatcher exactly so behavior
            // stays consistent across channels.
            const logsRes = await global.dbPool.request()
                .input('cursor', sql.BigInt, cursor)
                .input('scope', sql.VarChar, sub.scope || 'all')
                .input('scopeValue', sql.VarChar, sub.scope_value || null)
                .input('userCId', sql.VarChar, sub.user_c_id || null)
                .input('isSuper', sql.Bit, isSuper ? 1 : 0)
                .query(`
                    SELECT TOP (${LINE_BATCH})
                        nl.log_id, nl.mqtt_serial, nl.dbkey, nl.level, nl.value, nl.point,
                        COALESCE(NULLIF(nc.message, ''), nl.message) AS message,
                        nl.event_time, nl.event_type, nl.c_name, nl.alarm_type
                    FROM dbo.NotifyLog nl
                    LEFT JOIN dbo.NotifyConfig nc ON nc.notify_id = nl.notify_id
                    WHERE nl.log_id > @cursor
                      AND (@scope = 'all' OR (@scope = 'serial' AND UPPER(nl.mqtt_serial) = UPPER(@scopeValue)))
                      AND (@isSuper = 1 OR (nl.c_id IS NOT NULL AND nl.c_id = @userCId))
                      AND (',' + LOWER(REPLACE(ISNULL(nl.alarm_type, ''), ' ', '')) + ',') LIKE '%,line,%'
                    ORDER BY nl.log_id ASC
                `);
            const logs = logsRes.recordset;
            if (logs.length === 0) continue;

            // Send each row as its own text. The helper covers one message
            // per call which keeps the wire format simple; LINE accepts up
            // to 5 in one request as an optimization we can add later.
            let delivered = 0;
            let fatal = null;
            for (const row of logs) {
                try {
                    await lineApi.pushTextMessage(token, chatId, formatMessage(row));
                    delivered++;
                } catch (err) {
                    fatal = err;
                    break;
                }
            }

            // Advance cursor to the last log_id we actually delivered. If
            // delivery failed mid-batch, only commit the ones that went out.
            if (delivered > 0) {
                const maxId = logs[delivered - 1].log_id;
                await global.dbPool.request()
                    .input('id', sql.BigInt, sub.subscription_id)
                    .input('newCursor', sql.BigInt, maxId)
                    .query(`UPDATE dbo.UserNotificationSubscription
                            SET last_delivered_log_id = @newCursor, updated_at = GETDATE()
                            WHERE subscription_id = @id`);
            }

            // Record WHY this row failed to deliver so it shows on the Notify
            // Log page. The row that threw is the first undelivered one
            // (logs[delivered]) since the loop breaks on the first failure.
            // Best-effort: never let a logging UPDATE break the dispatch loop.
            const failedRow = logs[delivered];
            if (fatal && failedRow) {
                try {
                    await global.dbPool.request()
                        .input('logId', sql.BigInt, failedRow.log_id)
                        .input('reason', sql.NVarChar(255), lineReason(fatal))
                        .query(`UPDATE dbo.NotifyLog SET fail_reason = @reason WHERE log_id = @logId`);
                } catch (_) { /* swallow — best effort */ }
            }

            // Permanent failures = deactivate the sub. The user gets a
            // friendly path back via the Subscribe modal which re-verifies.
            if (fatal) {
                const status = fatal.status || 0;
                const dead = status === 401 || status === 403 || status === 404;
                if (dead) {
                    await global.dbPool.request()
                        .input('id', sql.BigInt, sub.subscription_id)
                        .query(`UPDATE dbo.UserNotificationSubscription
                                SET is_active = 0, updated_at = GETDATE()
                                WHERE subscription_id = @id`);
                    console.log(`[line] deactivated sub ${sub.subscription_id} (HTTP ${status} - ${fatal.code || fatal.message})`);
                } else {
                    console.error(`[line] send failed (sub ${sub.subscription_id}):`, status || '-', fatal.message);
                }
            }

            if (delivered > 0) {
                console.log(`[line] sub ${sub.subscription_id} ${chatId} -> ${delivered}/${logs.length} message(s) (cursor now ${logs[delivered - 1].log_id})`);
            }
        }
    } catch (err) {
        console.error('[line dispatch]', err.message);
    } finally {
        dispatchRunning = false;
    }
}

function start() {
    if (pollTimer) {
        console.warn('[line] dispatcher already running, skipping start()');
        return;
    }
    pollTimer = setInterval(dispatchLine, LINE_POLL_MS);
    console.log(`[line] dispatcher started (every ${LINE_POLL_MS}ms)`);
}

function stop() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[line] dispatcher stopped');
}

module.exports = { start, stop, dispatchLine, LINE_POLL_MS };
