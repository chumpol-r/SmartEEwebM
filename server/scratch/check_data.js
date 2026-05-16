const { connectToDb, sql } = require('../db');

async function debugData() {
    try {
        const pool = await connectToDb();
        const res = await pool.request()
            .query("SELECT TOP 20 dt_job_time, c_column, n_production, n_avg FROM colquartery WHERE c_column = 'Temperature' AND dt_job_time >= DATEADD(day, -1, GETDATE()) ORDER BY dt_job_time DESC");
        
        console.log("TEMPERATURE DATA IN LAST 24 HOURS:");
        console.table(res.recordset);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

debugData();
