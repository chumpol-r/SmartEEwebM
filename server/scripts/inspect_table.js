const { connectToDb, sql } = require('../db');

async function inspectTable() {
    try {
        const pool = await connectToDb();
        console.log("Connected to DB");

        const result = await pool.request().query(`
            SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
            WHERE TABLE_NAME = 'CustomViews'
        `);

        console.log("Columns:", result.recordset);

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await sql.close();
    }
}

inspectTable();
