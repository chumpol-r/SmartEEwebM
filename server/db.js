const sql = require('mssql');

const config = {
    user: 'userdb',
    password: 'dbpassword',
    server: '10.0.0.77',
    database: 'db_energy_oee',
    options: {
        encrypt: false, // Use true for Azure SQL
        trustServerCertificate: true // Change to false for production
    }
};

async function connectToDb() {
    try {
        const pool = await sql.connect(config);
        console.log('Connected to SQL Server');
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
