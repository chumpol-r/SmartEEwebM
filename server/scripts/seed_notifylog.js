/**
 * seed_notifylog.js — สร้างข้อมูลตัวอย่างลง dbo.NotifyLog ครอบคลุม "ทุก use case"
 * ของการแจ้งเตือนต่ออุปกรณ์ (MQTT serial) ที่มี NotifyConfig จริง.
 *
 * แนวคิด: อ่าน NotifyConfig จริงต่อ serial → สำหรับแต่ละ (serial, dbkey, level)
 * ที่ไม่ใช่ Normal สร้าง 3 เหตุการณ์ตาม state machine ของ notifier_logic:
 *     raise → escalate → clear
 * โดย event `clear`/`escalate` ผูก correlation_id กับ log_id ของ `raise`
 * (เลียนแบบ insertNotifyLog ใน server/workers/mqttNotifier.js).
 *
 * owner snapshot (c_id / owner_type / c_name) ดึงจาก config + resolve ชื่อจาก
 * WebGroup/WebSite — ตรงกับที่ worker เขียนจริง.
 *
 * ── ความปลอดภัย ───────────────────────────────────────────────────────────
 *   default ตั้ง status='sent', sent_at=now และ **เคลียร์ alarm_type=''**
 *   เพื่อกัน dispatcher (web push / LINE / smart) หยิบไปส่งออกจริง
 *   (LINE/smart ใช้ cursor last_delivered_log_id ไม่ดู status — ถ้าไม่อยากให้
 *   ส่งจริงต้องให้ alarm_type ว่าง). ใช้ --real-channels เพื่อคัดลอก alarm_type
 *   จาก config (อุปกรณ์จะถูกส่งจริงถ้า worker กำลังรัน — ใช้เฉพาะตอนตั้งใจ).
 *
 * ── การใช้งาน ────────────────────────────────────────────────────────────
 *   node scripts/seed_notifylog.js                       # METER3,METER4,METER5 (safe)
 *   node scripts/seed_notifylog.js --serials=METER3,METER5
 *   node scripts/seed_notifylog.js --dry-run             # พิมพ์อย่างเดียว ไม่ insert
 *   node scripts/seed_notifylog.js --real-channels       # ใช้ alarm_type จาก config
 *   node scripts/seed_notifylog.js --with-failures       # ใส่ตัวอย่าง status='failed'+fail_reason
 */
const { connectToDb, sql } = require('../db');

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getOpt = (k, d) => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.split('=').slice(1).join('=') : d;
};
const DRY_RUN = hasFlag('--dry-run');
const REAL_CHANNELS = hasFlag('--real-channels');
const WITH_FAILURES = hasFlag('--with-failures');
const SERIALS = getOpt('serials', 'METER3,METER4,METER5')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

// level ลำดับความรุนแรง (ไม่รวม Normal — Normal ไม่ใช่ event raise)
const LEVEL_ORDER = ['Very Low', 'Low', 'High', 'Very High'];
// severity 2 ระดับเหมือน notifier_logic: extreme=2, moderate=1
const SEVERITY = { 'Very Low': 2, Low: 1, High: 1, 'Very High': 2 };
// ทิศของ breach: low = ค่าต่ำกว่า threshold, high = ค่าสูงกว่า
const DIRECTION = { 'Very Low': 'low', Low: 'low', High: 'high', 'Very High': 'high' };

// baseline ค่าโดยประมาณต่อ dbkey เพื่อให้ value ดูสมจริง (ไม่กระทบ logic)
const BASELINE = {
    'Amp1': 30, 'Amp2': 30, 'Amp3': 30, 'Amp-avr': 30,
    KWH: 5000, KVAR: 800, PF: 0.92, LastKwDemand: 250,
    VoltP1: 230, VoltP2: 230, VoltP3: 230, 'VoltP-avr': 230,
};
function fakeValue(dbkey, level) {
    const base = BASELINE[dbkey] ?? 100;
    const factor = DIRECTION[level] === 'high'
        ? (SEVERITY[level] === 2 ? 1.6 : 1.25)   // High +25%, Very High +60%
        : (SEVERITY[level] === 2 ? 0.4 : 0.7);   // Low -30%, Very Low -60%
    return Number((base * factor).toFixed(4));
}

async function resolveName(pool, ownerType, cId) {
    if (!cId) return null;
    const table = String(ownerType).toUpperCase() === 'GROUP' ? 'WebGroup' : 'WebSite';
    const r = await pool.request()
        .input('cid', sql.VarChar, String(cId).trim())
        .query(`SELECT TOP 1 c_name FROM dbo.${table} WHERE LTRIM(RTRIM(c_id)) = @cid`);
    return r.recordset[0]?.c_name?.trim() ?? null;
}

// insert 1 แถว คืน log_id (เลียนแบบ insertNotifyLog ของ worker + status/sent_at)
async function insertRow(pool, row) {
    if (DRY_RUN) {
        console.log(`  [dry] ${row.eventType.padEnd(8)} ${row.mqttSerial}/${row.dbkey} ${row.level.padEnd(9)} value=${row.value} corr=${row.correlationId ?? '-'} status=${row.status}`);
        return null;
    }
    const res = await pool.request()
        .input('notifyId', sql.Int, row.notifyId)
        .input('serialId', sql.Int, row.serialId)
        .input('mqttSerial', sql.VarChar, row.mqttSerial)
        .input('dbkey', sql.VarChar, row.dbkey)
        .input('level', sql.VarChar, row.level)
        .input('value', sql.Decimal(18, 4), row.value)
        .input('point', sql.Decimal(18, 4), row.point)
        .input('message', sql.NVarChar, row.message)
        .input('alarmType', sql.VarChar(50), row.alarmType)
        .input('eventTime', sql.DateTime, row.eventTime)
        .input('status', sql.VarChar(20), row.status)
        .input('sentAt', sql.DateTime, row.sentAt)
        .input('attempts', sql.Int, row.attempts)
        .input('eventType', sql.VarChar, row.eventType)
        .input('correlationId', sql.BigInt, row.correlationId)
        .input('failReason', sql.NVarChar, row.failReason)
        .input('cId', sql.VarChar, row.cId)
        .input('ownerType', sql.VarChar, row.ownerType)
        .input('cName', sql.NVarChar, row.cName)
        .query(`
            INSERT INTO dbo.NotifyLog (
                notify_id, serial_id, mqtt_serial, dbkey, level, value, point,
                message, alarm_type, event_time, status, sent_at, delivered_count,
                attempts, created_at, event_type, correlation_id, fail_reason,
                c_id, owner_type, c_name
            )
            OUTPUT INSERTED.log_id
            VALUES (
                @notifyId, @serialId, @mqttSerial, @dbkey, @level, @value, @point,
                @message, @alarmType, @eventTime, @status, @sentAt, 0,
                @attempts, GETDATE(), @eventType, @correlationId, @failReason,
                @cId, @ownerType, @cName
            )
        `);
    return res.recordset[0]?.log_id ?? null;
}

async function main() {
    const pool = await connectToDb();
    console.log(`seed_notifylog: serials=${SERIALS.join(',')} dryRun=${DRY_RUN} realChannels=${REAL_CHANNELS} withFailures=${WITH_FAILURES}`);

    // ดึง config จริงทั้งหมด (รวม Normal) แล้ว filter serial ใน JS
    // (mssql ไม่รองรับ array param ใน IN — filter ฝั่ง JS ชัดเจนกว่า)
    const cfgAll = (await pool.request().query(`
        SELECT notify_id, serial_id, mqtt_serial, dbkey, level, point, message,
               alarm_type, c_id, owner_type
        FROM dbo.NotifyConfig
    `)).recordset
        .map((c) => ({ ...c, mqtt_serial: String(c.mqtt_serial).trim().toUpperCase(), dbkey: String(c.dbkey).trim() }))
        .filter((c) => SERIALS.includes(c.mqtt_serial));

    // map Normal config ต่อ (serial|dbkey) — ใช้สร้าง row 'cleared' (notify_id/message/channel
    // ของ Normal config เหมือนที่ worker ทำใน Branch A)
    const normalByKey = new Map();
    for (const c of cfgAll) {
        if (String(c.level).trim() === 'Normal') normalByKey.set(`${c.mqtt_serial}|${c.dbkey}`, c);
    }
    const allCfg = cfgAll.filter((c) => String(c.level).trim() !== 'Normal');

    if (allCfg.length === 0) {
        console.warn('ไม่พบ NotifyConfig สำหรับ serial ที่ระบุ — ยกเลิก');
        await sql.close();
        return;
    }

    // cache ชื่อ owner
    const nameCache = new Map();
    const nameOf = async (ownerType, cId) => {
        const key = `${ownerType}|${cId}`;
        if (!nameCache.has(key)) nameCache.set(key, await resolveName(pool, ownerType, cId));
        return nameCache.get(key);
    };

    const t0 = Date.now();
    let made = 0;
    let failureBudget = WITH_FAILURES ? 1 : 0; // ใส่ตัวอย่าง failed อย่างน้อย 1 ต่อรัน

    // group config ตาม (serial,dbkey) เพื่อไล่ทีละ flow
    for (const cfg of allCfg) {
        const cName = await nameOf(cfg.owner_type, cfg.c_id);
        const alarmType = REAL_CHANNELS ? (cfg.alarm_type || '') : '';
        const baseTime = new Date(t0 - made * 7 * 60 * 1000); // ไล่ย้อนหลังทีละ 7 นาที

        // --- raise ---
        const raiseTime = new Date(baseTime.getTime());
        const raiseLogId = await insertRow(pool, {
            notifyId: cfg.notify_id, serialId: cfg.serial_id,
            mqttSerial: cfg.mqtt_serial, dbkey: cfg.dbkey, level: cfg.level,
            value: fakeValue(cfg.dbkey, cfg.level), point: cfg.point,
            message: cfg.message || `${cfg.level} Alert`,
            alarmType, eventTime: raiseTime,
            status: 'sent', sentAt: raiseTime, attempts: 1,
            eventType: 'raise', correlationId: null, failReason: null,
            cId: cfg.c_id, ownerType: cfg.owner_type, cName,
        });
        made++;

        // --- escalate (ผูก correlation กับ raise) ---
        const escTime = new Date(baseTime.getTime() + 60 * 1000);
        let escStatus = 'sent', escSentAt = escTime, escAttempts = 1, escFail = null;
        if (failureBudget > 0) {            // โชว์ use case ส่งไม่สำเร็จ 1 ครั้ง
            escStatus = 'failed'; escSentAt = null; escAttempts = 3;
            escFail = 'Web Push: subscription expired or unsubscribed (410 Gone)';
            failureBudget--;
        }
        await insertRow(pool, {
            notifyId: cfg.notify_id, serialId: cfg.serial_id,
            mqttSerial: cfg.mqtt_serial, dbkey: cfg.dbkey, level: cfg.level,
            value: Number((fakeValue(cfg.dbkey, cfg.level) * (DIRECTION[cfg.level] === 'high' ? 1.1 : 0.9)).toFixed(4)),
            point: cfg.point, message: cfg.message || `${cfg.level} Alert`,
            alarmType, eventTime: escTime,
            status: escStatus, sentAt: escSentAt, attempts: escAttempts,
            eventType: 'escalate', correlationId: raiseLogId, failReason: escFail,
            cId: cfg.c_id, ownerType: cfg.owner_type, cName,
        });
        made++;

        // --- cleared (ค่ากลับเข้า Normal; ผูก correlation กับ raise) ---
        // เลียนแบบ worker: level คง peak เดิม, notify_id/message/channel จาก Normal config
        // (ถ้าไม่มี Normal config ของ dbkey นั้น fallback เป็น cfg ของ alarm)
        const normalCfg = normalByKey.get(`${cfg.mqtt_serial}|${cfg.dbkey}`);
        const clearCfg = normalCfg || cfg;
        const clrTime = new Date(baseTime.getTime() + 5 * 60 * 1000);
        await insertRow(pool, {
            notifyId: clearCfg.notify_id, serialId: clearCfg.serial_id,
            mqttSerial: cfg.mqtt_serial, dbkey: cfg.dbkey,
            level: cfg.level,                          // คง peak level เดิมไว้เป็น context
            value: BASELINE[cfg.dbkey] ?? 100, point: 0,
            message: normalCfg?.message || `Cleared (was ${cfg.level})`,
            alarmType: REAL_CHANNELS ? (clearCfg.alarm_type || '') : '',
            eventTime: clrTime,
            status: 'sent', sentAt: clrTime, attempts: 1,
            eventType: 'cleared', correlationId: raiseLogId, failReason: null,
            cId: cfg.c_id, ownerType: cfg.owner_type, cName,
        });
        made++;
    }

    console.log(`เสร็จ: เตรียม/insert ${made} แถว จาก ${allCfg.length} config (${SERIALS.length} อุปกรณ์)`);
    if (DRY_RUN) console.log('** dry-run: ไม่ได้ insert จริง **');
    await sql.close();
}

main().catch(async (e) => {
    console.error('seed_notifylog ERROR:', e.message);
    try { await sql.close(); } catch { /* noop */ }
    process.exit(1);
});
