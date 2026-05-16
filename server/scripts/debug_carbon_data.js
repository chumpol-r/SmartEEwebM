const { connectToDb, sql } = require('../db');

async function debugData() {
    try {
        const pool = await connectToDb();
        console.log("Connected to DB");

        const targetDate = '2025-11-26';

        // 1. List Meters to find IDs
        console.log("\n--- Listing Meters ---");
        const metersRes = await pool.request().query(`
            SELECT c_serial_id, c_name FROM WebSerial
            UNION
            SELECT boardid as c_serial_id, c_desc as c_name FROM Smartboard WHERE active='B'
        `);
        console.log("Meters found:", metersRes.recordset.length);

        const targetMeters = metersRes.recordset.filter(m =>
            ['Meter3', 'Meter4', 'Meter5'].some(name => m.c_name && m.c_name.includes(name))
        );
        console.log("Target Meters:", targetMeters);

        // Check available columns in ColQuartery for these meters
        if (targetMeters.length > 0) {
            const meterIds = targetMeters.map(m => `'${m.c_serial_id}'`).join(',');
            console.log(`\n--- Checking Available Columns in ColQuartery for ${targetDate} ---`);

            const result = await pool.request().query(`
                SELECT DISTINCT n_column
                FROM dbo.ColQuartery 
                WHERE DATEDIFF(day, dt_job_time, '${targetDate}') = 0
                AND (c_serial_id IN (${meterIds}) OR n_production IN (SELECT n_id FROM ColConfig WHERE c_serial_id IN (${meterIds})))
            `);

            console.log("Available Columns:", result.recordset.map(r => r.n_column));
        }

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await sql.close();
    }
}

debugData();
