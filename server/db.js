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

// ---- Resilience tunables -------------------------------------------------
// Boot retry: the worker / API may start before SQL Server is ready (e.g. on
// a server reboot where NSSM/PM2 launches us first). Retry with backoff so we
// ride out that window instead of crash-looping. (C3)
const BOOT_MAX_RETRIES   = parseInt(process.env.DB_BOOT_MAX_RETRIES || '10', 10);
const BOOT_RETRY_BASE_MS = parseInt(process.env.DB_BOOT_RETRY_BASE_MS || '2000', 10);
const BOOT_RETRY_CAP_MS  = parseInt(process.env.DB_BOOT_RETRY_CAP_MS || '30000', 10);
// Auto-reconnect: if the live pool drops (SQL restart / failover / network
// blip) keep trying forever — a worker with a dead pool is useless. (C1)
const RECONNECT_BASE_MS  = parseInt(process.env.DB_RECONNECT_BASE_MS || '2000', 10);
const RECONNECT_CAP_MS   = parseInt(process.env.DB_RECONNECT_CAP_MS || '30000', 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (attempt, base, cap) => Math.min(cap, base * 2 ** Math.min(attempt, 10));

const authMode = DB_TRUSTED ? 'WindowsAuth' : `SQLAuth (${DB_USER})`;

function logConnectError(err) {
    const detail = err.originalError
        ? JSON.stringify(err.originalError)
        : (err.message || JSON.stringify(err));
    console.error(`[db] Connection failed: ${detail}`);
}

// Attempt a single connection. Updates global.dbPool and wires the pool-level
// 'error' handler that drives auto-reconnect. Throws on failure so callers can
// retry.
async function connectOnce() {
    const pool = await sql.connect(config);
    console.log(`Connected to SQL Server (${DB_SERVER}/${DB_NAME}, ${authMode})`);
    attachPoolErrorHandler(pool);
    global.dbPool = pool;
    return pool;
}

let reconnecting = false;
function attachPoolErrorHandler(pool) {
    // Without a listener, an 'error' emit would crash the process. We also use
    // it as the trigger for rebuilding the pool. (C1)
    pool.on('error', (err) => {
        console.error(`[db] pool error: ${err && err.message ? err.message : err}`);
        reconnect();
    });
}

// Rebuild the pool in the background, forever, with backoff. Guarded so a
// burst of 'error' events doesn't spawn parallel reconnect loops. (C1)
async function reconnect() {
    if (reconnecting) return;
    reconnecting = true;
    console.warn('[db] pool lost — starting auto-reconnect...');
    let attempt = 0;
    // Best-effort close of the dead pool so sockets/handles don't leak.
    try { if (global.dbPool) await global.dbPool.close(); } catch (_) { /* already dead */ }
    while (true) {
        try {
            await connectOnce();
            console.log('[db] auto-reconnect succeeded');
            break;
        } catch (err) {
            const wait = backoff(attempt++, RECONNECT_BASE_MS, RECONNECT_CAP_MS);
            logConnectError(err);
            console.warn(`[db] reconnect attempt ${attempt} failed — retrying in ${wait}ms`);
            await sleep(wait);
        }
    }
    reconnecting = false;
}

// Boot connection with bounded retry/backoff. (C3)
async function connectToDb() {
    const displayConnStr = config.connectionString.replace(/PWD=[^;]+/, 'PWD=***');
    console.log(`[db] Connecting → ${DB_SERVER}/${DB_NAME} (${authMode})`);
    console.log(`[db] Connection string: ${displayConnStr}`);
    let attempt = 0;
    while (true) {
        try {
            return await connectOnce();
        } catch (err) {
            logConnectError(err);
            if (attempt >= BOOT_MAX_RETRIES) {
                console.error(`[db] giving up after ${attempt + 1} attempt(s)`);
                console.error(`[db] Full error:`, JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
                throw err;
            }
            const wait = backoff(attempt++, BOOT_RETRY_BASE_MS, BOOT_RETRY_CAP_MS);
            console.warn(`[db] boot connect attempt ${attempt} failed — retrying in ${wait}ms`);
            await sleep(wait);
        }
    }
}

// Always returns the current live pool (survives reconnects). Consumers that
// captured a pool reference once should call this instead. (C1)
function getPool() {
    return global.dbPool;
}

module.exports = {
    sql,
    connectToDb,
    getPool,
};
