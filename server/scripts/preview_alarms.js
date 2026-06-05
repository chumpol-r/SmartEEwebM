// Alarm Preview (dry-run) — compare incoming MQTT against NotifyConfig and
// show what the worker WOULD do, without inserting anything into NotifyLog.
//
// Behavior:
//   * Loads NotifyConfig from DB once on startup.
//   * Subscribes to all device topics.
//   * For each MQTT message, iterates only the keys that have a config entry
//     (intersection of MQTT payload ∩ NotifyConfig). Any extra MQTT field
//     (Time, Serial, MeterType, etc.) is ignored.
//   * Prints a one-line preview per matching key showing current value, the
//     level it would trigger, and the threshold breached.
//   * Press Ctrl+C for a summary of (serial, dbkey) -> level distribution.
//
// Usage:
//   node server/scripts/preview_alarms.js                # all devices
//   node server/scripts/preview_alarms.js METER3         # one device
//   node server/scripts/preview_alarms.js --quiet        # only summary (no live lines)
//
// Read-only — does NOT touch NotifyLog.

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const { sql, connectToDb } = require('../db');
// notifier_logic now lives in the standalone worker/ package.
const { enrichPayload } = require('../../worker/workers/notifier_logic');

// ---- Args ----------------------------------------------------------------
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const durationArg = args.find(a => a.startsWith('--duration='));
const DURATION_SEC = durationArg ? parseInt(durationArg.split('=')[1], 10) : 0;  // 0 = run forever
const filterSerials = args.filter(a => !a.startsWith('--')).map(s => s.toUpperCase());
const wantSerial = (s) => filterSerials.length === 0 || filterSerials.includes(s.toUpperCase());

// ---- MQTT config ---------------------------------------------------------
const cfgPath = path.resolve(__dirname, '../../client/public/config/app-config.json');
const mqttCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')).mqtt;
const url = mqttCfg.mode === 'onsite' ? mqttCfg.onsiteUrl : mqttCfg.cloudUrl;
const options = {
    keepalive: 30,
    clientId: `smartee-preview-${Date.now()}`,
    username: mqttCfg.options?.username,
    password: mqttCfg.options?.password,
    clean: true,
    reconnectPeriod: 1000,
    connectTimeout: 30_000,
    protocolVersion: 4,
    rejectUnauthorized: false,
};

// ---- Helpers (mirrors worker logic exactly) ------------------------------
function keyOf(serial, dbkey) { return `${String(serial).toUpperCase()}|${dbkey}`; }
function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function extractFirstJsonObject(text) {
    const start = text.indexOf('{');
    if (start === -1) throw new Error('No JSON object found');
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    throw new Error('Incomplete JSON');
}
// Same severity-aware threshold picker the worker uses.
function pickTriggeredLevel(value, configs) {
    const byLevel = {};
    for (const c of configs) byLevel[c.level] = c;
    const vh = byLevel['Very High'];
    const hi = byLevel['High'];
    const lo = byLevel['Low'];
    const vl = byLevel['Very Low'];
    if (vh && vh.point != null && value >= vh.point) return vh;
    if (hi && hi.point != null && value >= hi.point) return hi;
    if (vl && vl.point != null && value <= vl.point) return vl;
    if (lo && lo.point != null && value <= lo.point) return lo;
    return null;
}

const LEVEL_TAG = {
    'Very High': '[VH]',
    'High':      '[H ]',
    'Low':       '[L ]',
    'Very Low':  '[VL]',
};

function fmtTime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- Stats accumulator ---------------------------------------------------
// counters: Map<'SERIAL|DBKEY', Map<levelOrNormal, count>>
const counters = new Map();
const lastValues = new Map();  // 'SERIAL|DBKEY' -> { value, level, point, at }
const missingInMqtt = new Map();  // 'SERIAL|DBKEY' -> count (configured but never in payload)
let totalMessages = 0;

function bump(k, levelOrNormal) {
    if (!counters.has(k)) counters.set(k, new Map());
    const m = counters.get(k);
    m.set(levelOrNormal, (m.get(levelOrNormal) || 0) + 1);
}

// ---- Main ----------------------------------------------------------------
let configByKey = new Map();

async function loadConfig() {
    const pool = await connectToDb();
    const res = await pool.request().query(`
        SELECT mqtt_serial, dbkey, level, point, message
        FROM dbo.NotifyConfig
        WHERE mqtt_serial IS NOT NULL AND dbkey IS NOT NULL
    `);
    for (const r of res.recordset) {
        const k = keyOf(r.mqtt_serial, r.dbkey);
        if (!configByKey.has(k)) configByKey.set(k, []);
        configByKey.get(k).push({
            level: r.level,
            point: r.point != null ? Number(r.point) : null,
            message: r.message || '',
        });
        missingInMqtt.set(k, 0);  // start at 0; will become >0 only if never seen
    }
    pool.close();
    return configByKey.size;
}

function printConfigSummary() {
    console.log('\n' + '═'.repeat(90));
    console.log(`LOADED NotifyConfig — ${configByKey.size} (serial, dbkey) pairs to watch`);
    console.log('═'.repeat(90));
    const bySerial = new Map();
    for (const [k, levels] of configByKey) {
        const [serial, dbkey] = k.split('|');
        if (!bySerial.has(serial)) bySerial.set(serial, []);
        bySerial.get(serial).push({ dbkey, levels });
    }
    for (const [serial, entries] of bySerial) {
        console.log(`\n  ${serial}: ${entries.length} dbkey(s)`);
        entries.sort((a, b) => a.dbkey.localeCompare(b.dbkey));
        for (const { dbkey, levels } of entries) {
            const tags = levels
                .map(l => `${LEVEL_TAG[l.level] || '[?]'} ${l.point}`)
                .join('  ');
            console.log(`    - ${dbkey.padEnd(18)} ${tags}`);
        }
    }
    console.log('');
}

async function main() {
    console.log(`[preview] loading NotifyConfig from DB...`);
    try {
        const n = await loadConfig();
        if (n === 0) {
            console.error('[preview] no NotifyConfig rows found — nothing to preview. Exiting.');
            process.exit(1);
        }
    } catch (err) {
        console.error('[preview] DB load failed:', err.message);
        process.exit(1);
    }
    printConfigSummary();

    console.log(`[preview] connecting to ${url}`);
    if (filterSerials.length > 0) console.log(`[preview] filter: ${filterSerials.join(', ')}`);
    if (quiet) console.log(`[preview] quiet mode — summary only`);
    console.log('[preview] Press Ctrl+C for final summary\n');

    const client = mqtt.connect(url, options);
    client.on('connect', () => {
        console.log('[preview] connected, subscribing to SmartEE/Cloud/Device/+/+\n');
        client.subscribe('SmartEE/Cloud/Device/+/+', { qos: 0 });
    });
    client.on('error', (err) => console.error('[preview] error:', err.message));

    client.on('message', (topic, payload) => {
        const parts = topic.split('/');
        const serial = (parts[parts.length - 1] || '').toUpperCase();
        if (!wantSerial(serial)) return;

        let obj;
        try {
            const cleaned = payload.toString().replace(/\bNaN\b/g, '0').replace(/\b-?Infinity\b/g, '0');
            obj = JSON.parse(extractFirstJsonObject(cleaned));
        } catch {
            return;
        }
        enrichPayload(obj);  // add VoltP-avr / Amp-avr like the worker does
        totalMessages++;

        // ★ Intersection only: iterate config, look up in MQTT payload.
        // Any MQTT key NOT in config is silently ignored (by design).
        for (const [k, configs] of configByKey) {
            if (!k.startsWith(serial + '|')) continue;
            const dbkey = k.slice(serial.length + 1);
            const value = toNumber(obj[dbkey]);
            if (value === null) continue;   // mqtt didn't send this key in this msg

            const triggered = pickTriggeredLevel(value, configs);
            const levelKey = triggered ? triggered.level : 'Normal';
            bump(k, levelKey);
            lastValues.set(k, {
                value,
                level: levelKey,
                point: triggered ? triggered.point : null,
                at: Date.now(),
            });

            if (!quiet) {
                const tag = triggered ? (LEVEL_TAG[triggered.level] || '[?]') : '[OK]';
                const valStr = String(value).padStart(12);
                const thresh = triggered ? `threshold ${triggered.point}` : 'in Normal band';
                console.log(`${fmtTime(new Date())} ${tag} ${serial.padEnd(8)} ${dbkey.padEnd(16)} value=${valStr}   ${thresh}`);
            }
        }
    });

    process.on('SIGINT', () => {
        printFinalSummary();
        client.end(true, () => process.exit(0));
    });

    if (DURATION_SEC > 0) {
        setTimeout(() => {
            console.log(`\n[preview] auto-exit after ${DURATION_SEC}s`);
            printFinalSummary();
            client.end(true, () => process.exit(0));
        }, DURATION_SEC * 1000);
    }
}

function printFinalSummary() {
    console.log('\n\n' + '═'.repeat(110));
    console.log(`FINAL PREVIEW SUMMARY   messages: ${totalMessages}   (serial,dbkey) seen: ${lastValues.size}`);
    console.log('═'.repeat(110));

    // Per (serial,dbkey) distribution
    const allKeys = [...new Set([...configByKey.keys(), ...counters.keys()])].sort();
    const bySerial = new Map();
    for (const k of allKeys) {
        const [serial] = k.split('|');
        if (!bySerial.has(serial)) bySerial.set(serial, []);
        bySerial.get(serial).push(k);
    }

    for (const [serial, keys] of bySerial) {
        console.log(`\n  ${serial}`);
        console.log('  ' + '─'.repeat(106));
        console.log('  ' + [
            'dbkey'.padEnd(16),
            'Last value'.padStart(14),
            'Last verdict'.padEnd(12),
            'VH'.padStart(5), 'H'.padStart(5), 'Norm'.padStart(5), 'L'.padStart(5), 'VL'.padStart(5),
            'Status'.padEnd(20),
        ].join(' '));
        console.log('  ' + '─'.repeat(106));

        for (const k of keys) {
            const dbkey = k.split('|')[1];
            const cnt = counters.get(k) || new Map();
            const lv = lastValues.get(k);
            const total = [...cnt.values()].reduce((a, b) => a + b, 0);

            let status;
            if (total === 0) status = '⚠ NOT IN MQTT';
            else if (!cnt.get('Very High') && !cnt.get('High') && !cnt.get('Very Low') && !cnt.get('Low')) status = '✓ always Normal';
            else status = '🚨 would alarm';

            console.log('  ' + [
                dbkey.padEnd(16),
                (lv ? String(lv.value) : '-').padStart(14),
                (lv ? lv.level : '-').padEnd(12),
                String(cnt.get('Very High') || 0).padStart(5),
                String(cnt.get('High') || 0).padStart(5),
                String(cnt.get('Normal') || 0).padStart(5),
                String(cnt.get('Low') || 0).padStart(5),
                String(cnt.get('Very Low') || 0).padStart(5),
                status.padEnd(20),
            ].join(' '));
        }
    }

    // Highlight problems
    const missing = [...configByKey.keys()].filter(k => !counters.has(k));
    if (missing.length > 0) {
        console.log('\n  ⚠ dbkeys configured but NEVER seen in MQTT (possible spelling mismatch):');
        for (const k of missing) {
            const [serial, dbkey] = k.split('|');
            console.log(`      ${serial} / ${dbkey}`);
        }
    } else {
        console.log('\n  ✓ Every configured dbkey was seen in MQTT at least once.');
    }
    console.log('');
}

main().catch(err => {
    console.error('[preview] fatal:', err);
    process.exit(1);
});
