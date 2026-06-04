// Web Push Dispatcher (worker module)
// ---------------------------------------------------------------------------
// Polls dbo.NotifyLog for rows in status='pending', sends each to every
// matching active webpush subscription, then flips the row to 'sent' /
// 'failed'. One row is delivered exactly once to whichever subscribers are
// active at that moment — a device that subscribes later won't receive old
// alerts.
//
// IMPORTANT: this module assumes two things have been set up by the caller
// BEFORE start() is called:
//   1. global.dbPool — an mssql pool, populated by connectToDb()
//   2. webpush.setVapidDetails(...) — VAPID keys configured on the shared
//      `web-push` singleton.
// Both server/index.js (in-process mode) and server/worker.js (separate
// process mode) satisfy these requirements; the dispatcher is identical in
// either case.

const webpush = require('web-push');
const { sql } = require('../db');
const { webpushAggregateReason } = require('../utils/failureReason');

// ---- Tunables ------------------------------------------------------------
const WEBPUSH_POLL_MS = 3000;
// Hard cap on each send attempt — without this a stale endpoint can hang
// the await indefinitely (FCM/APNs sometimes accept a TCP connection but
// never respond) and freeze the entire dispatcher. 10s is well past every
// healthy response; anything slower is effectively dead.
const WEBPUSH_TIMEOUT_MS = 10000;

let webpushDispatchRunning = false;
let pollTimer = null;

// Race the actual send against a timer. The timer can't cancel the
// underlying HTTP request, but the dispatcher stops waiting after the
// deadline so the loop moves on to the next subscription.
function sendNotificationWithTimeout(subscription, payload, ms) {
    return Promise.race([
        webpush.sendNotification(subscription, payload),
        new Promise((_, reject) => setTimeout(() => {
            const err = new Error('webpush send timeout');
            err.code = 'ETIMEDOUT';
            reject(err);
        }, ms)),
    ]);
}

async function dispatchWebPush() {
    // Guard rails — never run if VAPID isn't set up, the DB pool isn't ready,
    // or another tick is still in flight. The lock prevents concurrent runs
    // even if the poll interval is too tight for the workload.
    if (webpushDispatchRunning || !global.dbPool) return;
    webpushDispatchRunning = true;
    try {
        // Prefer the LIVE NotifyConfig.message when available so admins can
        // edit copy and have it reflected on the next push, even for events
        // already queued. Fall back to NotifyLog.message (snapshot taken at
        // fire time) when:
        //   * the originating NotifyConfig row was deleted
        //   * nc.message is NULL or empty string
        //   * the NotifyLog row wasn't tied to a config (notify_id IS NULL)
        // NULLIF() trims empty strings so COALESCE skips them.
        // Channel routing: alarm_type is a CSV of channels (e.g. 'device,line').
        // Only rows that include 'device' should reach webpush. Rows with no
        // matching channel are flipped to 'sent' below so they don't sit in
        // the pending queue forever.
        const pending = await global.dbPool.request().query(`
            SELECT TOP (50)
                nl.log_id, nl.mqtt_serial, nl.dbkey, nl.level, nl.value, nl.point,
                COALESCE(NULLIF(nc.message, ''), nl.message) AS message,
                nl.alarm_type, nl.event_time, nl.event_type, nl.correlation_id,
                nl.c_id, nl.owner_type, nl.c_name
            FROM dbo.NotifyLog nl
            LEFT JOIN dbo.NotifyConfig nc ON nc.notify_id = nl.notify_id
            WHERE nl.status = 'pending'
            ORDER BY nl.log_id ASC
        `);

        const hasChannel = (csv, ch) =>
            String(csv || '').toLowerCase().split(',').map(s => s.trim()).includes(ch);

        for (const row of pending.recordset) {
            // Channel gate: if this row isn't routed to 'device', mark sent
            // (with delivered_count=0) and move on. Without this, rows
            // configured for LINE-only would stay 'pending' forever and the
            // queue would grow unbounded.
            if (!hasChannel(row.alarm_type, 'device')) {
                await global.dbPool.request()
                    .input('logId', sql.BigInt, row.log_id)
                    .query(`
                        UPDATE dbo.NotifyLog
                        SET status = 'sent', sent_at = GETDATE(),
                            delivered_count = 0, attempts = attempts + 1
                        WHERE log_id = @logId
                    `);
                console.log(`[webpush] log ${row.log_id} skipped (channels='${row.alarm_type || ''}')`);
                continue;
            }

            // Find active webpush subscriptions that match this serial's scope
            // AND belong to a user inside the alarm's organization. Super Group
            // users (WebGroup.c_active = 'Z') receive every alarm. Everyone
            // else only receives alarms where their WebUser.c_id matches the
            // alarm's c_id — matching the same scoping rule used by /api/notify-log.
            //
            // Legacy rows where row.c_id is NULL only reach Super Group users.
            const subsRes = await global.dbPool.request()
                .input('serial', sql.VarChar, String(row.mqtt_serial || '').toUpperCase())
                .input('logCId', sql.VarChar, row.c_id || null)
                .query(`
                    SELECT s.subscription_id, s.destination
                    FROM dbo.UserNotificationSubscription s
                    INNER JOIN dbo.WebUser u ON u.u_id = s.user_id
                    LEFT JOIN dbo.WebGroup g ON g.c_id = u.c_id
                    WHERE s.is_active = 1
                      AND s.channel = 'webpush'
                      AND s.destination IS NOT NULL
                      AND (s.scope = 'all' OR (s.scope = 'serial' AND UPPER(s.scope_value) = @serial))
                      AND (
                            -- Super Group: sees everything
                            g.c_active = 'Z'
                            -- OR same org (only when log has a c_id to match against)
                            OR (@logCId IS NOT NULL AND u.c_id = @logCId)
                          )
                `);
            const subs = subsRes.recordset;

            // Event-type-aware notification: cleared events get a calmer
            // "back to normal" presentation so the user can scan at a glance.
            // The c_name (WebGroup/WebSite display name, snapshotted when
            // the row was inserted) leads the title so the user can tell at a
            // glance which org the alert belongs to.
            const evt = row.event_type || 'raise';
            const isCleared = evt === 'cleared';
            const statusTag = isCleared
                ? 'OK'
                : (evt === 'escalate' ? 'ESCALATED' : 'ALARM');
            const orgPrefix = row.c_name ? `${row.c_name} ・ ` : '';
            const title = `${orgPrefix}${statusTag}: ${row.mqtt_serial} - ${row.dbkey} ${row.level}`;
            const bodyText = isCleared
                ? `${row.message || 'Returned to normal'} (current value ${row.value})`
                : `${row.message || 'Alert'} (value ${row.value}${row.point != null ? `, threshold ${row.point}` : ''})`;

            const payload = JSON.stringify({
                title,
                body: bodyText,
                // Tag by correlation_id when present so a cleared notification
                // visually *replaces* the matching raise on supported platforms
                // (one stacked notification per alarm lifecycle instead of two).
                tag: `notify-${row.correlation_id || row.log_id}`,
                data: {
                    url: '/notify-log',
                    logId: row.log_id,
                    serial: row.mqtt_serial,
                    eventType: evt,
                    correlationId: row.correlation_id,
                    cId: row.c_id,
                    ownerType: row.owner_type,
                    cName: row.c_name,
                },
            });

            // Send to every matching subscription in parallel. Each send is
            // wrapped in a timeout so one slow/dead endpoint can't stall the
            // others, and Promise.allSettled means a single rejection won't
            // skip the rest. This is the critical change that prevents the
            // dispatcher from hanging on the first stale FCM endpoint.
            const sendResults = await Promise.allSettled(subs.map(async (s) => {
                let subscription;
                try {
                    subscription = JSON.parse(s.destination);
                } catch (_) {
                    // Surface as a recognisable error so the reason mapper can
                    // tell the user the saved subscription is corrupt.
                    return { delivered: false, err: { code: 'bad_subscription' } };
                }
                try {
                    await sendNotificationWithTimeout(subscription, payload, WEBPUSH_TIMEOUT_MS);
                    return { delivered: true };
                } catch (err) {
                    const isDead = err.statusCode === 404
                        || err.statusCode === 410
                        || err.code === 'ETIMEDOUT';
                    if (isDead) {
                        try {
                            await global.dbPool.request()
                                .input('id', sql.BigInt, s.subscription_id)
                                .query(`UPDATE dbo.UserNotificationSubscription
                                        SET is_active = 0, updated_at = GETDATE()
                                        WHERE subscription_id = @id`);
                        } catch (_) { /* swallow — best effort */ }
                        const reason = err.code === 'ETIMEDOUT' ? 'timeout' : `HTTP ${err.statusCode}`;
                        console.log(`[webpush] deactivated dead subscription ${s.subscription_id} (${reason})`);
                    } else {
                        console.error(`[webpush] send failed (sub ${s.subscription_id}):`, err.statusCode || err.message);
                    }
                    return { delivered: false, err };
                }
            }));
            const delivered = sendResults.reduce(
                (n, r) => n + (r.status === 'fulfilled' && r.value.delivered ? 1 : 0),
                0
            );
            // Collect the errors behind every non-delivered send so we can
            // store ONE human-readable reason when the whole row fails.
            const failerrors = sendResults
                .filter(r => r.status === 'fulfilled' && !r.value.delivered && r.value.err)
                .map(r => r.value.err);

            // matched>0 but none delivered -> 'failed'; otherwise 'sent'.
            const newStatus = (subs.length > 0 && delivered === 0) ? 'failed' : 'sent';
            // fail_reason is only ever written on failure (sticky, informational).
            // On 'sent' we pass NULL but DON'T touch any reason a LINE/smart
            // dispatcher may have set — this main path only runs for rows routed
            // to 'device', and a fresh device row starts with fail_reason NULL.
            const failReason = newStatus === 'failed' ? webpushAggregateReason(failerrors) : null;
            await global.dbPool.request()
                .input('logId', sql.BigInt, row.log_id)
                .input('count', sql.Int, delivered)
                .input('status', sql.VarChar, newStatus)
                .input('failReason', sql.NVarChar(255), failReason)
                .query(`
                    UPDATE dbo.NotifyLog
                    SET status = @status, sent_at = GETDATE(),
                        delivered_count = @count, attempts = attempts + 1,
                        fail_reason = @failReason
                    WHERE log_id = @logId
                `);
            console.log(`[webpush] log ${row.log_id} ${row.mqtt_serial}/${row.dbkey} ${row.level} -> ${delivered}/${subs.length} device(s) [${newStatus}]`);
        }
    } catch (err) {
        console.error('[webpush dispatch]', err.message);
    } finally {
        webpushDispatchRunning = false;
    }
}

function start() {
    if (pollTimer) {
        console.warn('[webpush] dispatcher already running, skipping start()');
        return;
    }
    pollTimer = setInterval(dispatchWebPush, WEBPUSH_POLL_MS);
    console.log(`[webpush] dispatcher started (every ${WEBPUSH_POLL_MS}ms)`);
}

function stop() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[webpush] dispatcher stopped');
}

module.exports = {
    start,
    stop,
    dispatchWebPush,
    WEBPUSH_POLL_MS,
};
