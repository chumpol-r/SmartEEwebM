// Adds dbo.NotifyLog.fail_reason — a human-readable, English explanation of
// WHY a notification failed to deliver (web push / LINE / smart). Written by
// the dispatchers on failure, shown verbatim on the Notify Log page.
//
// Idempotent: safe to run multiple times. No ORM/migration tool in this
// project, so schema changes are plain scripts (see wiki/db).
//
//   node scripts/add_fail_reason_column.js
const { connectToDb } = require('../db');

async function runMigration() {
    try {
        const pool = await connectToDb();
        console.log('Connected to database.');

        const checkResult = await pool.request().query(`
            SELECT COL_LENGTH('dbo.NotifyLog', 'fail_reason') AS ColLength
        `);

        if (checkResult.recordset[0].ColLength === null) {
            console.log("Column 'fail_reason' does not exist. Adding it...");
            await pool.request().query(`
                ALTER TABLE dbo.NotifyLog
                ADD fail_reason NVARCHAR(255) NULL
            `);
            console.log("Column 'fail_reason' added successfully.");
        } else {
            console.log("Column 'fail_reason' already exists.");
        }

        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
