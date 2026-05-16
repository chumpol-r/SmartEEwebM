const { connectToDb, sql } = require('../db');

async function listTables() {
    try {
        const pool = await connectToDb();
        console.log("Connected to DB");

        const result = await pool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE'
        `);

        console.log("Tables:", result.recordset.map(row => row.TABLE_NAME));

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await sql.close();
    }
}

listTables();
