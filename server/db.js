// SQL Server connection — built from env vars so the same code can target
// dev (local Windows Auth), staging, and production without code changes.
//
// Backwards-compatible: when no env vars are set, falls back to the original
// hard-coded local dev defaults. Set DB_SERVER / DB_NAME / DB_USER / DB_PASS
// in .env to point at a different instance, or set DB_TRUSTED=false to use
// SQL Server authentication (needed on Linux / cloud where Windows Auth
// isn't available).
const sql = require('mssql/msnodesqlv8');
require('dotenv').config();

const DB_SERVER  = process.env.DB_SERVER  || 'INNOTUC01\\SQLEXPRESS';
const DB_NAME    = process.env.DB_NAME    || 'db_energy_oee_dev';
const DB_USER    = process.env.DB_USER    || '';
const DB_PASS    = process.env.DB_PASS    || '';
// Default to trusted (Windows Auth) when no explicit choice was made AND no
// SQL credentials were supplied. Setting DB_TRUSTED=false forces SQL Auth,
// which is what production on Linux / Docker will normally use.
const DB_TRUSTED = process.env.DB_TRUSTED
    ? process.env.DB_TRUSTED.toLowerCase() === 'true'
    : !DB_USER;

const parts = [
    'Driver={ODBC Driver 17 for SQL Server}',
    `Server=${DB_SERVER}`,
    `Database=${DB_NAME}`,
];
if (DB_TRUSTED) {
    parts.push('Trusted_Connection=Yes');
} else {
    parts.push(`UID=${DB_USER}`, `PWD=${DB_PASS}`);
}
parts.push('Encrypt=Yes', 'TrustServerCertificate=Yes');

const config = { connectionString: parts.join(';') + ';' };

async function connectToDb() {
    const authMode = DB_TRUSTED ? 'WindowsAuth' : `SQLAuth (${DB_USER})`;
    const displayConnStr = config.connectionString.replace(/PWD=[^;]+/, 'PWD=***');
    console.log(`[db] Connecting → ${DB_SERVER}/${DB_NAME} (${authMode})`);
    console.log(`[db] Connection string: ${displayConnStr}`);
    try {
        const pool = await sql.connect(config);
        console.log(`Connected to SQL Server (${DB_SERVER}/${DB_NAME}, ${authMode})`);
        return pool;
    } catch (err) {
        const detail = err.originalError
            ? JSON.stringify(err.originalError)
            : (err.message || JSON.stringify(err));
        console.error(`[db] Connection failed: ${detail}`);
        console.error(`[db] Full error:`, JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
        throw err;
    }
}

module.exports = {
    sql,
    connectToDb,
};
