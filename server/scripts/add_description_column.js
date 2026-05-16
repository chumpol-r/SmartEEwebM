const { connectToDb, sql } = require('../db');

async function runMigration() {
    try {
        const pool = await connectToDb();
        console.log("Connected to database.");

        // Check if column exists
        const checkResult = await pool.request().query(`
            SELECT COL_LENGTH('dbo.Smartboard', 'c_desc') AS ColLength
        `);

        if (checkResult.recordset[0].ColLength === null) {
            console.log("Column 'c_desc' does not exist. Adding it...");
            await pool.request().query(`
                ALTER TABLE dbo.Smartboard
                ADD c_desc NVARCHAR(255) NULL
            `);
            console.log("Column 'c_desc' added successfully.");
        } else {
            console.log("Column 'c_desc' already exists.");
        }

        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

runMigration();
