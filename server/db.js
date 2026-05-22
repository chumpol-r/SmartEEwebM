const sql = require('mssql/msnodesqlv8');

const config = {
    connectionString:
        'Driver={ODBC Driver 17 for SQL Server};' +
        'Server=INNOTUC01\\SQLEXPRESS;' +
        'Database=db_energy_oee;' +
        'Trusted_Connection=Yes;' +
        'Encrypt=Yes;' +
        'TrustServerCertificate=Yes;'
};

async function connectToDb() {
    try {
        const pool = await sql.connect(config);
        console.log('Connected to SQL Server (INNOTUC01\\SQLEXPRESS)');
        return pool;
    } catch (err) {
        console.error('Database connection failed:', err);
        throw err;
    }
}

module.exports = {
    sql,
    connectToDb
};
