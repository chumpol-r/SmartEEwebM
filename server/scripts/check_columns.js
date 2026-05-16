const { connectToDb, sql } = require('./db');

async function checkColumns() {
    try {
        const pool = await connectToDb();
        const result = await pool.request().query("SELECT DISTINCT top 100 c_column FROM colquartery WHERE dt_job_time > '2025-01-01'");
        console.log("Distinct columns:");
        result.recordset.forEach(row => console.log(row.c_column));
        
        // Also check some sensor data
        const senRes = await pool.request().query("SELECT TOP 5 n_production, c_column, dt_job_time, n_unit FROM colquartery WHERE c_column LIKE '%CO2%' OR c_column LIKE '%Temp%' OR c_column LIKE '%Humid%' ORDER BY dt_job_time DESC");
        console.log("\nSample sensor data:");
        console.table(senRes.recordset);
        
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkColumns();
