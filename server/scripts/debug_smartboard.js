const { connectToDb } = require('../db');

async function run() {
    try {
        const pool = await connectToDb();
        console.log("Connected to database.");

        const res = await pool.request().query("SELECT boardid, active, len(boardid) as len FROM dbo.Smartboard WHERE boardid LIKE 'E40F52088D258%'");
        console.table(res.recordset);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
