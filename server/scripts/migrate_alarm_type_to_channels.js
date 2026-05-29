// Migration: repurpose `alarm_type` from a single presentation enum
// (Dialog/Email/SMS) into a CSV of notification channels.
//
// New semantics:
//   ''            -> do not send anywhere (admin must opt-in)
//   'device'      -> webpush to subscribed devices
//   'line'        -> LINE Messaging
//   'device,line' -> both
//
// Legacy values (Dialog/Email/SMS) were never wired to any dispatcher,
// so we clear them to '' rather than guess. Admins re-pick via UI.
//
// Safe to run multiple times.

const { connectToDb } = require('../db');

async function run() {
    const pool = await connectToDb();
    console.log('Connected.');

    // 1) Make sure the column is wide enough for CSV like "device,line".
    //    Existing schema is likely VARCHAR(20) which is too tight.
    const colLen = await pool.request().query(`
        SELECT CHARACTER_MAXIMUM_LENGTH AS len
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME   = 'NotifyConfig'
          AND COLUMN_NAME  = 'alarm_type'
    `);
    const currentLen = colLen.recordset[0]?.len ?? 0;
    if (currentLen >= 0 && currentLen < 50) {
        console.log(`NotifyConfig.alarm_type is VARCHAR(${currentLen}); widening to VARCHAR(50).`);
        await pool.request().query(`
            ALTER TABLE dbo.NotifyConfig
            ALTER COLUMN alarm_type VARCHAR(50) NULL
        `);
    } else {
        console.log(`NotifyConfig.alarm_type already VARCHAR(${currentLen}); leaving as-is.`);
    }

    const logLen = await pool.request().query(`
        SELECT CHARACTER_MAXIMUM_LENGTH AS len
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME   = 'NotifyLog'
          AND COLUMN_NAME  = 'alarm_type'
    `);
    const currentLogLen = logLen.recordset[0]?.len ?? 0;
    if (currentLogLen >= 0 && currentLogLen < 50) {
        console.log(`NotifyLog.alarm_type is VARCHAR(${currentLogLen}); widening to VARCHAR(50).`);
        await pool.request().query(`
            ALTER TABLE dbo.NotifyLog
            ALTER COLUMN alarm_type VARCHAR(50) NULL
        `);
    } else {
        console.log(`NotifyLog.alarm_type already VARCHAR(${currentLogLen}); leaving as-is.`);
    }

    // 2) Clear legacy single-value enums so they don't accidentally match
    //    LIKE '%device%' / '%line%' filters later.
    const cleared = await pool.request().query(`
        UPDATE dbo.NotifyConfig
        SET alarm_type = ''
        WHERE alarm_type IN ('Dialog', 'Email', 'SMS')
    `);
    console.log(`NotifyConfig: cleared ${cleared.rowsAffected[0]} legacy row(s).`);

    const clearedLog = await pool.request().query(`
        UPDATE dbo.NotifyLog
        SET alarm_type = ''
        WHERE alarm_type IN ('Dialog', 'Email', 'SMS')
    `);
    console.log(`NotifyLog: cleared ${clearedLog.rowsAffected[0]} legacy row(s).`);

    console.log('Done.');
    process.exit(0);
}

run().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
