// Alternative db.js using msnodesqlv8 for Windows Authentication
const sql = require('mssql/lib/msnodesqlv8');
require('dotenv').config();

// Connection string for msnodesqlv8 (uses ODBC)
const connectionString = `Driver={ODBC Driver 17 for SQL Server};Server=${process.env.DB_SERVER || '.'};Database=${process.env.DB_NAME || 'db_energy_oee_test'};Trusted_Connection=yes;`;

async function connectToDb() {
    try {
        console.log(`Connecting to SQL Server via ODBC...`);
        console.log(`Connection string: ${connectionString}`);
        const pool = await sql.connect(connectionString);
        console.log('✓ Connected to SQL Server');
        return pool;
    } catch (err) {
        console.error('✗ Database connection failed:', err.message);
        throw err;
    }
}

module.exports = {
    sql,
    connectToDb
};
