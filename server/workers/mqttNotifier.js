// MQTT Notifier Worker — Alarm Lifecycle (raise / escalate / cleared)
// ---------------------------------------------------------------------------
// Compares MQTT readings against dbo.NotifyConfig and inserts rows into
// dbo.NotifyLog. Unlike a flat "one row per breach" model, this worker emits
// a *chain* of events per alarm:
//
//   raise     – first time the value crosses any threshold
//   escalate  – severity increases above the peak seen so far in this alarm
//   cleared   – value returns to Normal long enough to be confident it's over
//
// All three carry the same `correlation_id` (pointing to the raise log_id),
// so the full lifecycle can be reconstructed with one JOIN.
//
// Key behaviors:
//   * Same delay rule as before: a transition is only logged after the value
//     has been continuously in that state for `delay` seconds (anti-noise).
//   * De-escalation (Very High -> High) does NOT emit a new row — we just
//     remember the lower current level. The alarm stays active.
//   * Auto-clear: if a device stops publishing for AUTO_CLEAR_MS, we emit a
//     synthetic 'cleared' row so the alarm doesn't dangle forever.
//   * State recovery on startup: active alarms are reloaded from NotifyLog so
//     a server restart doesn't produce duplicate raise events.

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const { sql, connectToDb } = require('../db');
const {
    severityOf,
    toNumber,
    extractFirstJsonObject,
    enrichPayload,
    pickTriggeredLevel,
    configForLevel,
} = require('./notifier_logic');

// ---- Tunables ------------------------------------------------------------
const CONFIG_REFRESH_MS = 30_000;          // re-read NotifyConfig every 30s
const STATE_SWEEP_MS    = 60_000;          // sweep state every 1m
const AUTO_CLEAR_MS     = 10 * 60_000;     // no MQTT for 10m -> auto cleared
const TOPIC_PATTERN     = 'SmartEE/Cloud/Device/+/+';
const LOG_PREFIX        = '[mqttNotifier]';

// ---- Module state --------------------------------------------------------
let mqttClient = null;
let configByKey = new Map();   // 'SERIAL|DBKEY' -> [config rows]
let runtimeState = new Map();  // 'SERIAL|DBKEY' -> state object (see below)
let configRefreshTimer = null;
let sweepTimer = null;
let started = false;

// State object shape (per SERIAL|DBKEY):
// {
//   currentLevel:  string,   // level the value is in *right now*
//   peakLevel:     string,   // highest severity reached during this alarm
//   since:         number,   // ms when currentLevel started being triggered
//   fired:         boolean,  // we've already logged raise/escalate for peakLevel
//   raiseLogId:    number,   // log_id of the original raise (correlation root)
//   raisedAt:      number,   // ms when raise was emitted (for duration calc)
//   normalSince:   number?,  // ms when value first went Normal (clear timer)
//   lastSeen:      number,   // ms of last MQTT message — drives auto-clear
// }

// ---- Helpers -------------------------------------------------------------
// MQTT config priority:
//   1. server/.env (MQTT_* vars) — production / staging
//   2. client/public/config/app-config.json — legacy dev convenience
//
// Reading env first means production deployments don't have to ship a copy
// of app-config.json with credentials. The JSON file remains a fallback so
// existing dev setups keep working without any setup change.
function loadMqttConfig() {
    let jsonCfg = {};
    try {
        const configPath = path.resolve(__dirname, '../../client/public/config/app-config.json');
        jsonCfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')).mqtt || {};
    } catch (_) { /* file missing or unreadable is fine — env can cover it */ }

    const jsonOpts = jsonCfg.options || {};
    const mode      = process.env.MQTT_MODE       || jsonCfg.mode       || 'cloud';
    const cloudUrl  = process.env.MQTT_CLOUD_URL  || jsonCfg.cloudUrl   || 'wss://cloudtat.com:9001/mqtt';
    const onsiteUrl = process.env.MQTT_ONSITE_URL || jsonCfg.onsiteUrl  || 'ws://localhost:9001/mqtt';
    const url = mode === 'onsite' ? onsiteUrl : cloudUrl;

    return {
        url,
        options: {
            keepalive: parseInt(process.env.MQTT_KEEPALIVE || jsonOpts.keepalive || '30', 10),
            // Stable clientId across restarts so the broker queues msgs while
            // we're down. Suffix with hostname to avoid colliding with another
            // worker on the same broker.
            clientId: `smartee-notifier-${require('os').hostname()}`,
            username: process.env.MQTT_USERNAME || jsonOpts.username,
            password: process.env.MQTT_PASSWORD || jsonOpts.password,
            clean: false,             // persistent session
            reconnectPeriod: parseInt(process.env.MQTT_RECONNECT_MS || jsonOpts.reconnectPeriod || '1000', 10),
            connectTimeout: parseInt(process.env.MQTT_CONNECT_TIMEOUT_MS || jsonOpts.connectTimeout || '30000', 10),
            protocolVersion: 4,
            rejectUnauthorized: false,
        },
    };
}

function keyOf(serial, dbkey) {
    return `${String(serial).toUpperCase()}|${dbkey}`;
}

// ---- Config cache --------------------------------------------------------
// Caches NotifyConfig rows joined with WebGroup / WebSite so each in-memory
// config carries a c_name snapshot. The JOIN uses owner_type as the
// discriminator (matches polymorphic FK pattern), so a single LEFT JOIN per
// side returns the correct c_name. c_name will be NULL for legacy rows
// that don't have c_id set yet — the worker handles that gracefully.
async function refreshConfigCache(pool) {
    try {
        const res = await pool.request().query(`
            SELECT
                c.notify_id, c.serial_id, c.mqtt_serial, c.dbkey, c.level,
                c.point, c.delay, c.message, c.alarm_type,
                c.c_id, c.owner_type,
                COALESCE(g.c_name, s.c_name) AS c_name
            FROM dbo.NotifyConfig c
            LEFT JOIN dbo.WebGroup g
                ON c.c_id = g.c_id AND c.owner_type = 'GROUP'
            LEFT JOIN dbo.WebSite  s
                ON c.c_id = s.c_id AND c.owner_type = 'SITE'
            WHERE c.mqtt_serial IS NOT NULL AND c.dbkey IS NOT NULL
        `);
        const next = new Map();
        for (const r of res.recordset) {
            const k = keyOf(r.mqtt_serial, r.dbkey);
            if (!next.has(k)) next.set(k, []);
            next.get(k).push({
                notifyId:  r.notify_id,
                serialId:  r.serial_id,
                level:     r.level,
                point:     r.point != null ? Number(r.point) : null,
                delay:     r.delay != null ? Number(r.delay) : 0,
                message:   r.message || '',
                alarmType: r.alarm_type || '',
                // Ownership snapshot — flows straight into NotifyLog.
                cId:        r.c_id || null,
                ownerType:  r.owner_type || null,
                cName:      r.c_name || null,
            });
        }
        configByKey = next;
        console.log(`${LOG_PREFIX} config refreshed (${configByKey.size} serial/dbkey pairs)`);
    } catch (err) {
        console.error(`${LOG_PREFIX} refresh failed:`, err.message);
    }
}

// ---- State recovery (R1 mitigation) --------------------------------------
// On startup, reload any active alarms (raise/escalate without a matching
// cleared) so we don't emit a duplicate raise the next time MQTT arrives.
async function recoverActiveAlarms(pool) {
    try {
        const res = await pool.request().query(`
            ;WITH latest_alarm AS (
                SELECT mqtt_serial, dbkey, MAX(log_id) AS latest_id
                FROM dbo.NotifyLog
                WHERE event_type IN ('raise','escalate')
                GROUP BY mqtt_serial, dbkey
            ),
            latest_clear AS (
                SELECT mqtt_serial, dbkey, MAX(log_id) AS latest_id
                FROM dbo.NotifyLog
                WHERE event_type = 'cleared'
                GROUP BY mqtt_serial, dbkey
            )
            SELECT l.log_id, l.mqtt_serial, l.dbkey, l.level, l.event_time,
                   l.correlation_id, l.event_type
            FROM latest_alarm a
            INNER JOIN dbo.NotifyLog l ON l.log_id = a.latest_id
            LEFT JOIN latest_clear c
              ON c.mqtt_serial = a.mqtt_serial AND c.dbkey = a.dbkey
            WHERE c.latest_id IS NULL OR a.latest_id > c.latest_id
        `);

        const now = Date.now();
        for (const r of res.recordset) {
            const k = keyOf(r.mqtt_serial, r.dbkey);
            // correlation_id points at the original raise; if this *is* the
            // raise (event_type='raise'), correlation_id will be NULL.
            const raiseLogId = r.correlation_id || r.log_id;
            const raisedAt = new Date(r.event_time).getTime();
            runtimeState.set(k, {
                currentLevel: r.level,
                peakLevel:    r.level,
                since:        raisedAt,
                fired:        true,         // already logged before restart
                raiseLogId:   raiseLogId,
                raisedAt:     raisedAt,
                normalSince:  null,
                lastSeen:     now,          // give it grace before auto-clear
            });
        }
        console.log(`${LOG_PREFIX} recovered ${runtimeState.size} active alarm(s) from DB`);
    } catch (err) {
        console.error(`${LOG_PREFIX} recovery failed:`, err.message);
    }
}

// ---- Log insertion -------------------------------------------------------
// Returns the inserted log_id (number) or null on failure.
//
// Ownership is captured as a SNAPSHOT at write time (c_id, owner_type,
// c_name). Once the row exists in NotifyLog it is immune to future
// renames or deletions in WebGroup/WebSite — the audit trail stays accurate.
async function insertNotifyLog(pool, params) {
    const { serial, dbkey, value, cfg, eventTime, eventType, correlationId } = params;
    try {
        const res = await pool.request()
            .input('notifyId',      sql.Int,           cfg.notifyId)
            .input('serialId',      sql.Int,           cfg.serialId)
            .input('mqttSerial',    sql.VarChar,       String(serial).toUpperCase())
            .input('dbkey',         sql.VarChar,       dbkey)
            .input('level',         sql.VarChar,       cfg.level)
            .input('value',         sql.Decimal(18,4), value)
            .input('point',         sql.Decimal(18,4), cfg.point)
            .input('message',       sql.NVarChar,      cfg.message)
            .input('alarmType',     sql.VarChar,       cfg.alarmType)
            .input('eventTime',     sql.DateTime,      eventTime)
            .input('eventType',     sql.VarChar,       eventType)
            .input('correlationId', sql.BigInt,        correlationId)
            .input('cId',           sql.VarChar,       cfg.cId       || null)
            .input('ownerType',     sql.VarChar,       cfg.ownerType || null)
            .input('cName',         sql.NVarChar,      cfg.cName     || null)
            .query(`
                INSERT INTO dbo.NotifyLog (
                    notify_id, serial_id, mqtt_serial, dbkey, level, value, point,
                    message, alarm_type, event_time, status, delivered_count,
                    attempts, created_at, event_type, correlation_id,
                    c_id, owner_type, c_name
                )
                OUTPUT INSERTED.log_id
                VALUES (
                    @notifyId, @serialId, @mqttSerial, @dbkey, @level, @value, @point,
                    @message, @alarmType, @eventTime, 'pending', 0,
                    0, GETDATE(), @eventType, @correlationId,
                    @cId, @ownerType, @cName
                )
            `);
        const logId = res.recordset[0]?.log_id;
        const ownerTag = cfg.cName ? ` owner=${cfg.cName}` : '';
        console.log(`${LOG_PREFIX} ${eventType.toUpperCase()} ${serial}/${dbkey} ${cfg.level} value=${value} log_id=${logId} corr=${correlationId ?? '-'}${ownerTag}`);
        return logId;
    } catch (err) {
        console.error(`${LOG_PREFIX} insert failed for ${serial}/${dbkey} (${eventType}):`, err.message);
        return null;
    }
}

// ---- Per-(serial,dbkey) decision ---------------------------------------
// Mutates runtimeState; awaits DB inserts so log_ids are captured into state.
async function evaluate(pool, serial, dbkey, value, configs, eventTime, now) {
    const k = keyOf(serial, dbkey);
    const prev = runtimeState.get(k);
    const triggered = pickTriggeredLevel(value, configs);

    // -------- Branch A: value is in Normal --------
    if (!triggered) {
        if (!prev) return;           // already Normal, nothing to do
        prev.lastSeen = now;

        if (prev.normalSince == null) {
            prev.normalSince = now;  // start clear-debounce timer
        }

        // Use the original raise-level config for clear delay (so the rule
        // matches the alarm that's being cleared). Fall back to peakLevel
        // delay if the original isn't present anymore.
        const clearCfg = configForLevel(configs, prev.peakLevel);
        const clearDelayMs = (clearCfg?.delay || 0) * 1000;

        if (now - prev.normalSince >= clearDelayMs) {
            // Emit cleared and forget this alarm.
            await insertNotifyLog(pool, {
                serial, dbkey,
                value,
                cfg: { ...clearCfg, level: prev.peakLevel, message: `Cleared (was ${prev.peakLevel})` },
                eventTime,
                eventType: 'cleared',
                correlationId: prev.raiseLogId,
            });
            runtimeState.delete(k);
        }
        return;
    }

    // -------- Branch B: value is in an alarm level --------
    // Any pending clear is cancelled — the value re-entered alarm territory.
    if (prev) prev.normalSince = null;

    // B1. First breach (no prior state). Start the raise timer.
    if (!prev) {
        runtimeState.set(k, {
            currentLevel: triggered.level,
            peakLevel:    triggered.level,
            since:        now,
            fired:        false,
            raiseLogId:   null,
            raisedAt:     null,
            normalSince:  null,
            lastSeen:     now,
        });
        return;
    }

    prev.lastSeen = now;

    // B2. Did severity exceed the previous peak? If yes -> potential escalate.
    const newSeverity = severityOf(triggered.level);
    const peakSeverity = severityOf(prev.peakLevel);
    const isNewPeak = newSeverity > peakSeverity;

    if (isNewPeak) {
        // Reset fired/since for a fresh escalate debounce. Keep raise lineage.
        prev.currentLevel = triggered.level;
        prev.peakLevel    = triggered.level;
        prev.since        = now;
        prev.fired        = false;
        // raiseLogId, raisedAt: preserved
    } else {
        // Same or lower severity than peak — just remember the current level
        // for visibility, do not re-fire.
        prev.currentLevel = triggered.level;
    }

    // B3. If we haven't fired the raise/escalate for the current peak yet,
    //     check whether the debounce delay has elapsed.
    if (!prev.fired) {
        const delayMs = (triggered.delay || 0) * 1000;
        if (now - prev.since >= delayMs) {
            // Pick the config that matches peakLevel (in case triggered points
            // at a lower level that's also active — shouldn't happen since
            // pickTriggeredLevel returns the most severe, but be defensive).
            const fireCfg = configForLevel(configs, prev.peakLevel) || triggered;
            const isRaise = prev.raiseLogId == null;
            const logId = await insertNotifyLog(pool, {
                serial, dbkey, value,
                cfg: fireCfg,
                eventTime,
                eventType: isRaise ? 'raise' : 'escalate',
                correlationId: isRaise ? null : prev.raiseLogId,
            });
            if (logId != null) {
                prev.fired = true;
                if (isRaise) {
                    prev.raiseLogId = logId;
                    prev.raisedAt   = now;
                }
            }
        }
    }
}

// ---- Per-message handler -------------------------------------------------
async function handleMessage(pool, topic, payloadRaw) {
    const parts = topic.split('/');
    const serial = (parts[parts.length - 1] || '').toUpperCase();
    if (!serial) return;

    let obj;
    try {
        const cleaned = payloadRaw.toString()
            .replace(/\bNaN\b/g, '0')
            .replace(/\b-?Infinity\b/g, '0');
        obj = JSON.parse(extractFirstJsonObject(cleaned));
    } catch (err) {
        console.warn(`${LOG_PREFIX} bad payload on ${topic}: ${err.message}`);
        return;
    }

    // Add server-side derived fields (VoltP-avr, Amp-avr) so NotifyConfig
    // entries for those keys can be evaluated even though the device doesn't
    // send them directly.
    enrichPayload(obj);

    let eventTime = new Date();
    if (obj.Time) {
        const parsed = new Date(String(obj.Time).replace(' ', 'T'));
        if (!isNaN(parsed.getTime())) eventTime = parsed;
    }
    const now = Date.now();

    // Iterate per-config so unconfigured payload keys cost nothing.
    for (const [k, configs] of configByKey) {
        if (!k.startsWith(serial + '|')) continue;
        const dbkey = k.slice(serial.length + 1);
        const value = toNumber(obj[dbkey]);
        if (value === null) continue;

        try {
            await evaluate(pool, serial, dbkey, value, configs, eventTime, now);
        } catch (err) {
            console.error(`${LOG_PREFIX} evaluate failed for ${serial}/${dbkey}:`, err.message);
        }
    }
}

// ---- Periodic sweep ------------------------------------------------------
// (a) Auto-clear stale alarms (device went silent).
// (b) Memory cleanup happens implicitly: cleared alarms remove their state.
async function sweepStaleAlarms(pool) {
    const now = Date.now();
    const stale = [];
    for (const [k, s] of runtimeState) {
        if (now - s.lastSeen > AUTO_CLEAR_MS && s.raiseLogId != null) {
            stale.push([k, s]);
        }
    }
    for (const [k, s] of stale) {
        const [serial, dbkey] = k.split('|');
        const configs = configByKey.get(k) || [];
        const cfg = configForLevel(configs, s.peakLevel) || { notifyId: null, serialId: null, point: null, alarmType: '' };
        await insertNotifyLog(pool, {
            serial, dbkey,
            value: 0,
            cfg: { ...cfg, level: s.peakLevel, message: 'Auto-cleared (device silent > 10m)' },
            eventTime: new Date(),
            eventType: 'cleared',
            correlationId: s.raiseLogId,
        });
        runtimeState.delete(k);
    }
    if (stale.length > 0) {
        console.log(`${LOG_PREFIX} auto-cleared ${stale.length} stale alarm(s)`);
    }
}

// ---- Lifecycle -----------------------------------------------------------
async function start() {
    if (started) { console.warn(`${LOG_PREFIX} already started`); return; }
    started = true;

    const pool = global.dbPool || await connectToDb();
    if (!global.dbPool) global.dbPool = pool;

    await refreshConfigCache(pool);
    await recoverActiveAlarms(pool);

    configRefreshTimer = setInterval(() => refreshConfigCache(pool), CONFIG_REFRESH_MS);
    sweepTimer = setInterval(() => sweepStaleAlarms(pool), STATE_SWEEP_MS);

    const { url, options } = loadMqttConfig();
    console.log(`${LOG_PREFIX} connecting to ${url} as ${options.clientId}`);
    mqttClient = mqtt.connect(url, options);

    mqttClient.on('connect', () => {
        console.log(`${LOG_PREFIX} connected, subscribing to ${TOPIC_PATTERN}`);
        mqttClient.subscribe(TOPIC_PATTERN, { qos: 1 }, (err) => {
            if (err) console.error(`${LOG_PREFIX} subscribe failed:`, err.message);
            else console.log(`${LOG_PREFIX} subscribed`);
        });
    });
    mqttClient.on('reconnect', () => console.log(`${LOG_PREFIX} reconnecting...`));
    mqttClient.on('offline',   () => console.warn(`${LOG_PREFIX} offline`));
    mqttClient.on('error',     (err) => console.error(`${LOG_PREFIX} error:`, err.message));
    mqttClient.on('close',     () => console.warn(`${LOG_PREFIX} connection closed`));
    mqttClient.on('message', (topic, payload) => {
        handleMessage(pool, topic, payload).catch(err => {
            console.error(`${LOG_PREFIX} unhandled error:`, err);
        });
    });
}

async function stop() {
    if (!started) return;
    started = false;
    if (configRefreshTimer) clearInterval(configRefreshTimer);
    if (sweepTimer) clearInterval(sweepTimer);
    if (mqttClient) {
        await new Promise(resolve => mqttClient.end(false, {}, resolve));
        mqttClient = null;
    }
    console.log(`${LOG_PREFIX} stopped`);
}

module.exports = { start, stop };
