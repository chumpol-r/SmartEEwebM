// Smart EE LINE Dispatcher (worker module)
// ---------------------------------------------------------------------------
// Sibling of lineDispatcher.js for the `smart` channel ("Smart EE Notification").
//
// Difference from the `line` channel:
//   * `line`  = BYO-bot. The user supplied a LINE channel access token + chatId;
//     they live encrypted inside UserNotificationSubscription.destination and we
//     call the LINE Messaging API directly.
//   * `smart` = relayed. The user only typed a Group ID + Pin ID. We forward the
//     message to smarteepro.com's relay (utils/smartEeNotify), which owns the
//     "(gid + pin) -> which LINE group" binding. No chatId, no LINE token here.
//
// destination holds { gid, pinCipher }. We decrypt the Pin per tick and replay
// it to the relay along with the shared `pas` (env). Everything else (per-sub
// cursor, scope/org rules, batch size, dead-sub handling) mirrors lineDispatcher
// so behavior stays consistent across the two LINE-backed channels.
//
// Assumes:
//   * global.dbPool is ready (set by index.js / worker.js before start()).
//   * Node 20+ global fetch/FormData (used inside smartEeNotify).

const { sql } = require('../db');
const smartEeNotify = require('../utils/smartEeNotify');
const { DecryptToken } = require('../utils/crypto');
const { smartReason } = require('../utils/failureReason');

// ---- Tunables ------------------------------------------------------------
const SMART_POLL_MS  = 5000;
const SMART_BATCH    = 5;
const SMART_MAX_TEXT = 4900;

let dispatchRunning = false;
let pollTimer = null;

// ---- Message formatting (identical shape to lineDispatcher) --------------

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
    return text.length > SMART_MAX_TEXT ? text.slice(0, SMART_MAX_TEXT - 1) + '…' : text;
}

// ---- Dispatch tick -------------------------------------------------------

async function dispatchSmart() {
    if (dispatchRunning || !global.dbPool) return;
    // Nothing to relay with if the shared API password isn't configured.
    if (!smartEeNotify.isConfigured()) return;
    dispatchRunning = true;
    try {
        const subsRes = await global.dbPool.request().query(`
            SELECT s.subscription_id, s.user_id, s.destination,
                   s.scope, s.scope_value, s.last_delivered_log_id,
                   u.c_id AS user_c_id, g.c_active
            FROM dbo.UserNotificationSubscription s
            INNER JOIN dbo.WebUser u ON u.u_id = s.user_id
            LEFT  JOIN dbo.WebGroup g ON g.c_id = u.c_id
            WHERE s.is_active = 1
              AND s.channel = 'smart'
              AND s.destination IS NOT NULL
        `);

        for (const sub of subsRes.recordset) {
            // Parse destination & decrypt the Pin. Skip malformed rows (legacy
            // shapes, missing fields) — they re-subscribe via the modal.
            let gid, pin;
            try {
                const d = JSON.parse(sub.destination);
                gid = d.gid ?? d.groupId;
                pin = d.pinCipher ? DecryptToken(d.pinCipher) : null;
            } catch {
                continue;
            }
            if (gid == null || !pin) continue;

            const isSuper = sub.c_active === 'Z';
            const cursor  = sub.last_delivered_log_id || 0;

            // Same scope rules as lineDispatcher — only the alarm_type channel
            // token differs ('smart' instead of 'line').
            const logsRes = await global.dbPool.request()
                .input('cursor', sql.BigInt, cursor)
                .input('scope', sql.VarChar, sub.scope || 'all')
                .input('scopeValue', sql.VarChar, sub.scope_value || null)
                .input('userCId', sql.VarChar, sub.user_c_id || null)
                .input('isSuper', sql.Bit, isSuper ? 1 : 0)
                .query(`
                    SELECT TOP (${SMART_BATCH})
                        nl.log_id, nl.mqtt_serial, nl.dbkey, nl.level, nl.value, nl.point,
                        COALESCE(NULLIF(nc.message, ''), nl.message) AS message,
                        nl.event_time, nl.event_type, nl.c_name, nl.alarm_type
                    FROM dbo.NotifyLog nl
                    LEFT JOIN dbo.NotifyConfig nc ON nc.notify_id = nl.notify_id
                    WHERE nl.log_id > @cursor
                      AND (@scope = 'all' OR (@scope = 'serial' AND UPPER(nl.mqtt_serial) = UPPER(@scopeValue)))
                      AND (@isSuper = 1 OR (nl.c_id IS NOT NULL AND nl.c_id = @userCId))
                      AND (',' + LOWER(REPLACE(ISNULL(nl.alarm_type, ''), ' ', '')) + ',') LIKE '%,smart,%'
                    ORDER BY nl.log_id ASC
                `);
            const logs = logsRes.recordset;
            if (logs.length === 0) continue;

            let delivered = 0;
            let fatal = null;
            for (const row of logs) {
                try {
                    await smartEeNotify.sendNotify({ gid, pin, message: formatMessage(row) });
                    delivered++;
                } catch (err) {
                    fatal = err;
                    break;
                }
            }

            if (delivered > 0) {
                const maxId = logs[delivered - 1].log_id;
                await global.dbPool.request()
                    .input('id', sql.BigInt, sub.subscription_id)
                    .input('newCursor', sql.BigInt, maxId)
                    .query(`UPDATE dbo.UserNotificationSubscription
                            SET last_delivered_log_id = @newCursor, updated_at = GETDATE()
                            WHERE subscription_id = @id`);
            }

            // Record WHY this row failed so it surfaces on the Notify Log page.
            // The failing row is the first undelivered one (loop breaks on it).
            // Best-effort: a logging UPDATE must never break the dispatch loop.
            const failedRow = logs[delivered];
            if (fatal && failedRow) {
                try {
                    await global.dbPool.request()
                        .input('logId', sql.BigInt, failedRow.log_id)
                        .input('reason', sql.NVarChar(255), smartReason(fatal))
                        .query(`UPDATE dbo.NotifyLog SET fail_reason = @reason WHERE log_id = @logId`);
                } catch (_) { /* swallow — best effort */ }
            }

            // A 4xx from the relay means the Group/Pin is no longer valid →
            // deactivate so we stop hammering it. 5xx / network = transient,
            // leave active and retry next tick.
            if (fatal) {
                const status = fatal.status || 0;
                const dead = status >= 400 && status < 500;
                if (dead) {
                    await global.dbPool.request()
                        .input('id', sql.BigInt, sub.subscription_id)
                        .query(`UPDATE dbo.UserNotificationSubscription
                                SET is_active = 0, updated_at = GETDATE()
                                WHERE subscription_id = @id`);
                    console.log(`[smart] deactivated sub ${sub.subscription_id} (HTTP ${status} - ${fatal.code || fatal.message})`);
                } else {
                    console.error(`[smart] send failed (sub ${sub.subscription_id}):`, status || '-', fatal.message);
                }
            }

            if (delivered > 0) {
                console.log(`[smart] sub ${sub.subscription_id} gid=${gid} -> ${delivered}/${logs.length} message(s) (cursor now ${logs[delivered - 1].log_id})`);
            }
        }
    } catch (err) {
        console.error('[smart dispatch]', err.message);
    } finally {
        dispatchRunning = false;
    }
}

function start() {
    if (pollTimer) {
        console.warn('[smart] dispatcher already running, skipping start()');
        return;
    }
    pollTimer = setInterval(dispatchSmart, SMART_POLL_MS);
    console.log(`[smart] dispatcher started (every ${SMART_POLL_MS}ms)`);
}

function stop() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[smart] dispatcher stopped');
}

module.exports = { start, stop, dispatchSmart, SMART_POLL_MS };
