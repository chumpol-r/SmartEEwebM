/**
 * seed_notifylog_demo.js — สร้างข้อมูลตัวอย่าง "เสมือนเหตุการณ์จริง" ลง dbo.NotifyLog
 * สำหรับ **แคปหน้าจอโชว์ลูกค้า** (หน้า Notify Log) ครอบคลุมทุก use case ของการแจ้งเตือน.
 *
 * ต่างจาก seed_notifylog.js (ตัวเดิม) ตรงที่:
 *   - ตัวเดิม: derive จาก NotifyConfig จริงต่อ serial (raise→escalate→clear แบบ mechanical).
 *   - ตัวนี้:  ชุด "incident" ที่ curate มาด้วยมือให้สมจริง — ค่ามิเตอร์ไฟฟ้าจริง,
 *             ข้อความภาษาไทยอ่านรู้เรื่อง, channel หลากหลาย, status sent/pending/failed,
 *             fail_reason ข้อความจริงจาก utils/failureReason.js, เวลากระจายหลายวัน/หลายกะ.
 *
 * ครอบคลุม use case:
 *   • Event: Raised / Escalated / Cleared (+ correlation_id ผูก lifecycle)
 *   • Level: Very High / High / Low / Very Low (+ Cleared ที่คง peak level)
 *   • Channels: device (Web Push) / line (LINE) / smart (Smart EE) และแบบผสม
 *   • Status: sent / pending / failed
 *   • Failure Reason: Web Push 410, timeout, VAPID, LINE token/rate-limit, Smart EE relay
 *   • เคส "status=sent แต่ LINE ส่งไม่สำเร็จ" (LINE-only row มี fail_reason แต่ status ไม่ใช่ failed)
 *   • Auto-cleared (device silent > 10m)
 *   • ชนิดมิเตอร์: กระแสเกิน (overcurrent), แรงดันตก/เกิน, PF ต่ำ, kW Demand peak, kVAR สูง,
 *     phase imbalance
 *
 * ── Scoping (สำคัญมาก) ─────────────────────────────────────────────────────
 *   หน้า Notify Log กรองด้วย c_id = ของ user ที่ล็อกอิน (ยกเว้น Super Group). ดังนั้น
 *   row ที่ insert **ต้องมี c_id ตรงกับ account ที่จะใช้แคปรูป** ไม่งั้นจะไม่โผล่.
 *   - default: auto-detect owner ที่มี NotifyConfig เยอะสุด (fallback: จาก NotifyLog เดิม).
 *   - override: --cid=<c_id> --owner-type=group|site  (resolve ชื่อจาก WebGroup/WebSite ให้)
 *   ถ้าจะล็อกอินเป็น Super Group เห็นทุก org อยู่แล้ว c_id ไหนก็ขึ้น.
 *
 * ── ความปลอดภัย (อ่านก่อนรันจริง) ──────────────────────────────────────────
 *   ⚠️ dispatcher LINE/smart เดิน cursor ตาม log_id ไม่ดู status. ถ้า insert row ที่
 *   alarm_type มี line/smart **ขณะ worker กำลังรันและมี subscription ของ owner นั้น**
 *   → จะถูกส่งออกจริง! สำหรับการ "แคปรูป" แนะนำ:
 *       • ปิด worker ก่อน (อย่ารัน worker.js / ปิด ENABLE_MQTT_WORKER) แล้ว seed ได้ตามสบาย, หรือ
 *       • ใช้ --safe-channels เพื่อ **ล้าง alarm_type ทั้งหมด** (คอลัมน์ Channels จะโชว์ "-"
 *         ตัด channel ออกหมด แลกกับความปลอดภัย 100%).
 *   Web Push: row ที่ status != 'pending' dispatcher จะข้าม → seed ตั้ง status sent/failed อยู่แล้ว.
 *
 * ── การใช้งาน ──────────────────────────────────────────────────────────────
 *   node scripts/seed_notifylog_demo.js                 # auto owner, ข้อมูลครบทุกเคส
 *   node scripts/seed_notifylog_demo.js --dry-run       # พิมพ์อย่างเดียว ไม่ insert
 *   node scripts/seed_notifylog_demo.js --cid=100000123 --owner-type=site
 *   node scripts/seed_notifylog_demo.js --safe-channels # ล้าง channel กัน dispatch
 *   node scripts/seed_notifylog_demo.js --days=5        # กระจายเวลาในช่วง 5 วันล่าสุด
 *   node scripts/seed_notifylog_demo.js --clear         # ลบ demo เดิม (เฉพาะ serial ชุดนี้ + c_id นี้)
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
const SAFE_CHANNELS = hasFlag('--safe-channels');
const CLEAR = hasFlag('--clear');
const DAYS = Math.max(1, parseInt(getOpt('days', '3'), 10) || 3);
const CID_OVERRIDE = getOpt('cid', null);
const OWNER_TYPE_OVERRIDE = getOpt('owner-type', null);

// ---- มิเตอร์จำลอง (ชื่อเสมือนโรงงานจริง) --------------------------------
// mqtt_serial = ที่โชว์ในคอลัมน์ "Serial"; serial_id เป็นเลขจำลอง (ไม่โชว์บนหน้าจอ).
const DEVICES = {
    MDB_MAIN:   { serial: 'MDB-MAIN-01',  serialId: 9001, name: 'ตู้เมนไฟฟ้าหลัก (Main MDB)' },
    LINE_A:     { serial: 'MDB-LINE-A',   serialId: 9002, name: 'สายการผลิต A' },
    CHILLER:    { serial: 'CHILLER-01',   serialId: 9003, name: 'ระบบทำความเย็น (Chiller)' },
    COMP_AIR:   { serial: 'COMP-AIR-02',  serialId: 9004, name: 'เครื่องอัดอากาศ (Air Compressor)' },
    PUMP_WWTP:  { serial: 'PUMP-WWTP',    serialId: 9005, name: 'ปั๊มระบบบำบัดน้ำเสีย' },
};
const ALL_SERIALS = Object.values(DEVICES).map((d) => d.serial);

// ---- helper: timestamp ---------------------------------------------------
// คืน Date ย้อนหลัง daysAgo วัน เวลา hh:mm (กระจายตามกะทำงานจริง)
function ago(daysAgo, hh, mm) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hh, mm, Math.floor(Math.random() * 60), 0);
    return d;
}

// ---- ชุด incident (curate ด้วยมือ) ---------------------------------------
// แต่ละ incident => 1..n row ตามลำดับ; row eventType='raise' จะถูกจับ log_id
// ไปผูกเป็น correlation_id ให้ escalate/cleared ที่ตามมา.
// ฟิลด์ row: eventType, level, value, point, status, channels(csv), failReason, sentAt(bool|Date), attempts, deliveredCount, at(Date), message?
//
// channels: 'device'=Web Push, 'line'=LINE Bot, 'smart'=Smart EE. ผสมด้วย comma.
function buildIncidents(owner) {
    const cap = DAYS; // จำกัด daysAgo ไม่ให้เกินช่วงที่ขอ
    const da = (n) => Math.min(n, cap - 1 >= 0 ? cap : n); // clamp daysAgo เข้าในช่วง
    const incidents = [];

    // 1) Overcurrent ที่ MDB หลัก: raise High → escalate Very High → cleared (เคสครบ lifecycle)
    incidents.push({
        device: DEVICES.MDB_MAIN, dbkey: 'Amp-avr',
        rows: [
            { eventType: 'raise',    level: 'High',      value: 448.62, point: 400, status: 'sent',   channels: 'device,line', deliveredCount: 3, attempts: 1, at: ago(da(2), 9, 14),
              message: 'Average 3-phase current exceeds the limit (overload). Check the main board load.' },
            { eventType: 'escalate', level: 'Very High', value: 512.74, point: 450, status: 'sent',   channels: 'device,line', deliveredCount: 3, attempts: 1, at: ago(da(2), 9, 21),
              message: 'Average current is critically high — risk of breaker trip / equipment damage. Inspect immediately.' },
            { eventType: 'cleared',  level: 'Very High', value: 372.10, point: 0,   status: 'sent',   channels: 'device,line', deliveredCount: 3, attempts: 1, at: ago(da(2), 9, 48),
              message: 'Current has returned to the normal range.' },
        ],
    });

    // 2) แรงดันตก (ยังไม่หาย) — status pending (กำลังรอส่ง)
    incidents.push({
        device: DEVICES.LINE_A, dbkey: 'VoltP-avr',
        rows: [
            { eventType: 'raise', level: 'Low', value: 203.45, point: 210, status: 'pending', channels: 'device', deliveredCount: 0, attempts: 0, at: ago(da(0), 13, 5),
              message: 'Average voltage is below threshold (undervoltage) — may affect Production Line A motors.' },
        ],
    });

    // 3) แรงดันตกรุนแรง — ส่ง Web Push ไม่สำเร็จ (อุปกรณ์ยกเลิก subscription)
    incidents.push({
        device: DEVICES.LINE_A, dbkey: 'VoltP-avr',
        rows: [
            { eventType: 'raise', level: 'Very Low', value: 188.27, point: 200, status: 'failed', channels: 'device', deliveredCount: 0, attempts: 3,
              failReason: 'Web Push: the device is no longer subscribed (it was removed or expired). Ask the user to re-enable notifications.',
              at: ago(da(1), 2, 37),
              message: 'Severe voltage sag detected — risk of machinery shutdown during the night shift.' },
        ],
    });

    // 4) PF ต่ำ — raise → cleared ผ่าน LINE (เคสแจ้งผ่าน LINE ล้วน, สำเร็จ)
    incidents.push({
        device: DEVICES.MDB_MAIN, dbkey: 'PF',
        rows: [
            { eventType: 'raise',   level: 'Low', value: 0.78, point: 0.85, status: 'sent', channels: 'line', deliveredCount: 1, attempts: 1, at: ago(da(2), 14, 2),
              message: 'Power factor below threshold — risk of a utility power-factor penalty.' },
            { eventType: 'cleared', level: 'Low', value: 0.93, point: 0,    status: 'sent', channels: 'line', deliveredCount: 1, attempts: 1, at: ago(da(2), 15, 30),
              message: 'Power factor has recovered to normal (> 0.85).' },
        ],
    });

    // 5) PF ต่ำมาก — status=sent แต่ LINE ส่งไม่ได้ (token หมดอายุ) => มี fail_reason แต่ status ไม่ failed
    incidents.push({
        device: DEVICES.CHILLER, dbkey: 'PF',
        rows: [
            { eventType: 'raise', level: 'Very Low', value: 0.71, point: 0.80, status: 'sent', channels: 'line', deliveredCount: 0, attempts: 2,
              failReason: 'LINE: the channel access token is invalid or has expired. Please reconnect LINE.',
              at: ago(da(1), 10, 12),
              message: 'Power factor is critically low — inspect the Chiller capacitor bank.' },
        ],
    });

    // 6) kW Demand ใกล้ peak — raise High → escalate Very High → cleared ผ่าน Web Push + Smart EE
    incidents.push({
        device: DEVICES.MDB_MAIN, dbkey: 'LastKwDemand',
        rows: [
            { eventType: 'raise',    level: 'High',      value: 283.6, point: 250, status: 'sent', channels: 'device,smart', deliveredCount: 4, attempts: 1, at: ago(da(0), 11, 3),
              message: 'kW Demand is above target — risk of a peak demand charge.' },
            { eventType: 'escalate', level: 'Very High', value: 341.9, point: 300, status: 'sent', channels: 'device,smart', deliveredCount: 4, attempts: 1, at: ago(da(0), 11, 18),
              message: 'kW Demand is very high, approaching the utility contract demand. Shed load immediately.' },
            { eventType: 'cleared',  level: 'Very High', value: 228.4, point: 0,   status: 'sent', channels: 'device,smart', deliveredCount: 4, attempts: 1, at: ago(da(0), 11, 52),
              message: 'kW Demand has dropped below target.' },
        ],
    });

    // 7) kVAR สูง — แจ้งผ่าน Smart EE แต่ relay ปฏิเสธ (gid/pin ผิดหรือ inactive)
    incidents.push({
        device: DEVICES.COMP_AIR, dbkey: 'KVAR',
        rows: [
            { eventType: 'raise', level: 'High', value: 910.3, point: 800, status: 'sent', channels: 'smart', deliveredCount: 0, attempts: 2,
              failReason: 'Smart EE: the relay rejected the request — the Group ID or Pin may be wrong or inactive. Please reconnect.',
              at: ago(da(3 > cap ? cap - 1 : 3), 8, 41),
              message: 'Reactive power (kVAR) is high — inspect the air compressor capacitor bank.' },
        ],
    });

    // 8) Phase imbalance — กระแสเฟส L1 สูงเดี่ยว ๆ → raise → cleared (Web Push สำเร็จ)
    incidents.push({
        device: DEVICES.PUMP_WWTP, dbkey: 'Amp1',
        rows: [
            { eventType: 'raise',   level: 'High', value: 64.8, point: 55, status: 'sent', channels: 'device', deliveredCount: 2, attempts: 1, at: ago(da(1), 16, 9),
              message: 'Phase L1 current is notably higher than the other phases (phase imbalance). Inspect the pump.' },
            { eventType: 'cleared', level: 'High', value: 41.2, point: 0,  status: 'sent', channels: 'device', deliveredCount: 2, attempts: 1, at: ago(da(1), 16, 35),
              message: 'The 3-phase currents are balanced again.' },
        ],
    });

    // 9) แรงดันเกิน (overvoltage) — raise ผ่านหลาย channel, สำเร็จทั้งหมด
    incidents.push({
        device: DEVICES.LINE_A, dbkey: 'VoltP-avr',
        rows: [
            { eventType: 'raise', level: 'Very High', value: 261.0, point: 250, status: 'sent', channels: 'device,line,smart', deliveredCount: 5, attempts: 1, at: ago(da(0), 7, 26),
              message: 'Overvoltage detected — risk of damage to electronic equipment.' },
        ],
    });

    // 10) Web Push timeout — อุปกรณ์ออฟไลน์/ไม่มีเน็ต (failed)
    incidents.push({
        device: DEVICES.CHILLER, dbkey: 'Amp-avr',
        rows: [
            { eventType: 'raise', level: 'High', value: 392.5, point: 350, status: 'failed', channels: 'device', deliveredCount: 0, attempts: 3,
              failReason: 'Web Push: delivery timed out — the device may be offline or have no internet.',
              at: ago(da(2), 21, 14),
              message: 'Chiller current exceeded the threshold during the night.' },
        ],
    });

    // 11) LINE rate-limited — ส่งถี่เกิน (status sent, จะ retry; โชว์เหตุผล)
    incidents.push({
        device: DEVICES.MDB_MAIN, dbkey: 'KVAR',
        rows: [
            { eventType: 'raise', level: 'Very High', value: 1180.0, point: 1000, status: 'sent', channels: 'line', deliveredCount: 0, attempts: 1,
              failReason: 'LINE: temporarily rate-limited by LINE. It will be retried shortly.',
              at: ago(da(1), 12, 48),
              message: 'kVAR is very high at the main board. Check the power-factor compensation system.' },
        ],
    });

    // 12) Auto-cleared — อุปกรณ์เงียบเกิน 10 นาที (worker เคลียร์อัตโนมัติ)
    incidents.push({
        device: DEVICES.PUMP_WWTP, dbkey: 'VoltP-avr',
        rows: [
            { eventType: 'raise',   level: 'Low', value: 206.3, point: 215, status: 'sent', channels: 'device', deliveredCount: 1, attempts: 1, at: ago(da(0), 5, 2),
              message: 'Wastewater pump voltage is below threshold.' },
            { eventType: 'cleared', level: 'Low', value: 0,     point: 0,   status: 'sent', channels: 'device', deliveredCount: 1, attempts: 1, at: ago(da(0), 5, 19),
              message: 'Auto-cleared (device silent > 10m)' },
        ],
    });

    return incidents;
}

// ---- resolve owner -------------------------------------------------------
async function resolveName(pool, ownerType, cId) {
    if (!cId) return null;
    const table = String(ownerType).toUpperCase() === 'GROUP' ? 'WebGroup' : 'WebSite';
    const r = await pool.request()
        .input('cid', sql.VarChar, String(cId).trim())
        .query(`SELECT TOP 1 c_name FROM dbo.${table} WHERE LTRIM(RTRIM(c_id)) = @cid`);
    return r.recordset[0]?.c_name?.trim() ?? null;
}

async function detectOwner(pool) {
    if (CID_OVERRIDE) {
        const ownerType = OWNER_TYPE_OVERRIDE || 'site';
        const name = await resolveName(pool, ownerType, CID_OVERRIDE);
        return { cId: String(CID_OVERRIDE).trim(), ownerType, cName: name };
    }
    // owner ที่มี NotifyConfig เยอะสุด = องค์กรที่ใช้งานระบบแจ้งเตือนจริง
    const cfg = await pool.request().query(`
        SELECT TOP 1 LTRIM(RTRIM(c_id)) AS cId, owner_type AS ownerType, COUNT(*) AS n
        FROM dbo.NotifyConfig
        WHERE c_id IS NOT NULL AND LTRIM(RTRIM(c_id)) <> ''
        GROUP BY LTRIM(RTRIM(c_id)), owner_type
        ORDER BY COUNT(*) DESC
    `);
    if (cfg.recordset[0]) {
        const { cId, ownerType } = cfg.recordset[0];
        return { cId, ownerType, cName: await resolveName(pool, ownerType, cId) };
    }
    // fallback: จาก NotifyLog เดิม
    const log = await pool.request().query(`
        SELECT TOP 1 LTRIM(RTRIM(c_id)) AS cId, owner_type AS ownerType, c_name AS cName, COUNT(*) AS n
        FROM dbo.NotifyLog
        WHERE c_id IS NOT NULL AND LTRIM(RTRIM(c_id)) <> ''
        GROUP BY LTRIM(RTRIM(c_id)), owner_type, c_name
        ORDER BY COUNT(*) DESC
    `);
    if (log.recordset[0]) {
        const { cId, ownerType, cName } = log.recordset[0];
        return { cId, ownerType, cName: cName?.trim() ?? null };
    }
    return null;
}

// ---- insert --------------------------------------------------------------
async function insertRow(pool, owner, device, dbkey, row) {
    const alarmType = SAFE_CHANNELS ? '' : (row.channels || '');
    if (DRY_RUN) {
        const fr = row.failReason ? `  fail="${row.failReason.slice(0, 40)}…"` : '';
        console.log(`  [dry] ${row.eventType.padEnd(8)} ${device.serial.padEnd(12)} ${dbkey.padEnd(11)} ${row.level.padEnd(9)} val=${String(row.value).padStart(8)} [${(alarmType || '-').padEnd(18)}] ${row.status.padEnd(7)} corr=${row.correlationId ?? '-'}${fr}`);
        return 9000000 + Math.floor(Math.random() * 1000); // log_id ปลอมไว้ทดสอบ correlation flow
    }
    const sentAt = row.status === 'sent' ? (row.at || new Date()) : null;
    const res = await pool.request()
        .input('notifyId',      sql.Int,            null)
        .input('serialId',      sql.Int,            device.serialId)
        .input('mqttSerial',    sql.VarChar,        device.serial)
        .input('dbkey',         sql.VarChar,        dbkey)
        .input('level',         sql.VarChar,        row.level)
        .input('value',         sql.Decimal(18, 4), row.value)
        .input('point',         sql.Decimal(18, 4), row.point)
        .input('message',       sql.NVarChar,       row.message)
        .input('alarmType',     sql.VarChar(50),    alarmType)
        .input('eventTime',     sql.DateTime,       row.at)
        .input('status',        sql.VarChar(20),    row.status)
        .input('sentAt',        sql.DateTime,       sentAt)
        .input('deliveredCount', sql.Int,           row.deliveredCount ?? 0)
        .input('attempts',      sql.Int,            row.attempts ?? 1)
        .input('eventType',     sql.VarChar,        row.eventType)
        .input('correlationId', sql.BigInt,         row.correlationId ?? null)
        .input('failReason',    sql.NVarChar,       row.failReason ?? null)
        .input('cId',           sql.VarChar,        owner.cId)
        .input('ownerType',     sql.VarChar,        owner.ownerType)
        .input('cName',         sql.NVarChar,       owner.cName)
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
                @message, @alarmType, @eventTime, @status, @sentAt, @deliveredCount,
                @attempts, GETDATE(), @eventType, @correlationId, @failReason,
                @cId, @ownerType, @cName
            )
        `);
    return res.recordset[0]?.log_id ?? null;
}

async function clearDemo(pool, owner) {
    if (DRY_RUN) { console.log('  [dry] จะลบ demo row เดิม (serial ชุดนี้ + c_id นี้)'); return 0; }
    const reqq = pool.request().input('cId', sql.VarChar, owner.cId);
    const inList = ALL_SERIALS.map((s, i) => { reqq.input(`s${i}`, sql.VarChar, s); return `@s${i}`; }).join(',');
    const r = await reqq.query(`
        DELETE FROM dbo.NotifyLog
        WHERE LTRIM(RTRIM(c_id)) = @cId AND mqtt_serial IN (${inList})
    `);
    return r.rowsAffected[0] ?? 0;
}

// ---- main ----------------------------------------------------------------
async function main() {
    const pool = await connectToDb();

    const owner = await detectOwner(pool);
    if (!owner || !owner.cId) {
        console.error('✗ หา owner (c_id) ไม่ได้ — ระบุเองด้วย --cid=<c_id> --owner-type=site|group');
        await sql.close();
        process.exit(1);
    }

    console.log('seed_notifylog_demo');
    console.log(`  owner : c_id=${owner.cId} type=${owner.ownerType} name=${owner.cName || '(ไม่พบชื่อ)'}`);
    console.log(`  opts  : days=${DAYS} safeChannels=${SAFE_CHANNELS} dryRun=${DRY_RUN} clear=${CLEAR}`);
    console.log('');

    if (CLEAR) {
        const n = await clearDemo(pool, owner);
        console.log(`  ลบ demo เดิม ${n} แถว\n`);
    }

    const incidents = buildIncidents(owner);
    let made = 0;
    for (const inc of incidents) {
        let raiseLogId = null;
        for (const row of inc.rows) {
            // escalate/cleared ผูก correlation กับ raise ของ incident เดียวกัน
            if (row.eventType !== 'raise') row.correlationId = raiseLogId;
            const logId = await insertRow(pool, owner, inc.device, inc.dbkey, row);
            if (row.eventType === 'raise') raiseLogId = logId;
            made++;
        }
    }

    console.log(`\n✓ ${DRY_RUN ? 'เตรียม (dry-run)' : 'insert'} ${made} แถว จาก ${incidents.length} incident`);
    if (!SAFE_CHANNELS && !DRY_RUN) {
        console.log('⚠️  row มี channel line/smart — ถ้า worker รันอยู่+มี subscription จะถูกส่งจริง.');
        console.log('   ถ้าไม่ต้องการ ให้รันใหม่ด้วย --clear --safe-channels (หรือปิด worker ก่อน seed).');
    }
    if (DRY_RUN) console.log('** dry-run: ไม่ได้ insert จริง **');
    await sql.close();
}

main().catch(async (e) => {
    console.error('seed_notifylog_demo ERROR:', e.message);
    try { await sql.close(); } catch { /* noop */ }
    process.exit(1);
});
