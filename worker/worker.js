// Standalone worker process — runs the MQTT notifier and the web push
// dispatcher in a single Node process, separate from the HTTP API.
//
// Why a separate process:
//   * Restarting the API (nodemon) doesn't disconnect MQTT or interrupt
//     in-flight push sends.
//   * API and worker have independent log streams — easier to read.
//   * Each can be scaled / restarted on its own.
//
// Deployment (Windows Server / IIS context):
//   * The API can be hosted by IIS via iisnode (web.config wraps index.js).
//   * iisnode is HTTP-only — it has no place to run a long-lived background
//     worker. Run this file as a separate Windows Service instead, e.g. via
//     `node-windows` or NSSM:
//       nssm install SmartEEWorker "C:\Program Files\nodejs\node.exe" "C:\Workspaces\SmartEEweb\worker\worker.js"
//       nssm set    SmartEEWorker AppDirectory "C:\Workspaces\SmartEEweb\worker"
//       nssm start  SmartEEWorker
//   * On Linux, use PM2 / systemd to keep this process alive.
//
// In single-process / legacy setups, set ENABLE_MQTT_WORKER=true in the API's
// .env and DON'T start this file — index.js will boot both pieces itself.
//
// STANDALONE: this folder is self-contained — it carries its own copy of db.js
// and utils/ (crypto, lineApi, failureReason, smartEeNotify) plus its own .env,
// so it can run/deploy without the server/ folder present. NOTE: db.js and
// utils/crypto.js are duplicated from server/ — keep the two copies in sync.

const path = require('path');
// Load this folder's own .env (standalone) regardless of the process cwd.
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const webpush = require('web-push');
const { connectToDb, getPool } = require('./db');

const LOG_PREFIX = '[worker]';

// ---- Health/status HTTP server -------------------------------------------
// The worker runs on its own port (WORKER_PORT) — separate from the API — so
// it can be monitored, health-checked and restarted independently. If this
// port (or the whole worker) dies, the frontend and API keep running.
//   dev  default 3005, prod (PM2 env) 3004.
const WORKER_PORT = parseInt(process.env.WORKER_PORT || '3005', 10);

// Live component status, surfaced by GET /status. Updated as main() boots.
const status = {
    startedAt: new Date().toISOString(),
    components: {
        db: false,
        mqttNotifier: false,
        webpushDispatcher: false,
        lineDispatcher: false,
        smartLineDispatcher: false,
    },
};

function startHealthServer() {
    const server = http.createServer((req, res) => {
        const url = (req.url || '').split('?')[0];
        res.setHeader('Content-Type', 'application/json');
        if (url === '/health') {
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok' }));
            return;
        }
        if (url === '/status') {
            res.writeHead(200);
            res.end(JSON.stringify({
                status: 'ok',
                uptimeSec: Math.round(process.uptime()),
                startedAt: status.startedAt,
                webpushEnabled,
                components: status.components,
            }));
            return;
        }
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'not found' }));
    });
    // EADDRINUSE etc. must not crash the worker — log and keep the loops alive.
    server.on('error', (err) => {
        console.error(`${LOG_PREFIX} health server error:`, err.message);
    });
    server.listen(WORKER_PORT, () => {
        console.log(`${LOG_PREFIX} health server on http://localhost:${WORKER_PORT} (/health, /status)`);
    });
    return server;
}

// ---- Last-resort process guards (C2) -------------------------------------
// A long-lived background worker must not die from a stray rejection or throw
// in a callback we didn't wrap. Log loudly; for a truly unknown thrown error
// (corrupt state) exit so the supervisor (PM2/NSSM) restarts us clean. A
// rejected promise is usually a transient DB/network hiccup — log and stay up.
process.on('unhandledRejection', (reason) => {
    console.error(`${LOG_PREFIX} unhandledRejection:`, reason);
});
process.on('uncaughtException', (err) => {
    console.error(`${LOG_PREFIX} uncaughtException — exiting for restart:`, err);
    process.exit(1);
});

// ---- VAPID (mirrors the setup in index.js) -------------------------------
// Both processes need their own VAPID configuration: index.js uses it to
// expose the public key, this process uses it to actually sign push requests.
function normalizeVapidSubject(raw) {
    const s = String(raw || '').trim();
    if (!s) return 'mailto:admin@example.com';
    if (s.startsWith('mailto:') || s.startsWith('https://')) return s;
    if (s.includes('@')) return `mailto:${s}`;
    return `https://${s}`;
}
const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT     = normalizeVapidSubject(process.env.VAPID_SUBJECT);
const webpushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (webpushEnabled) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log(`${LOG_PREFIX} VAPID configured (subject=${VAPID_SUBJECT})`);
} else {
    console.warn(`${LOG_PREFIX} VAPID keys missing — push will not deliver until VAPID_* env vars are set`);
}

async function main() {
    // 1) DB pool — the MQTT notifier writes to NotifyLog, the dispatcher
    //    reads pending rows and updates them. Both look at global.dbPool.
    // connectToDb sets global.dbPool and owns auto-reconnect; don't capture
    // the pool reference here — it can be rebuilt. Use getPool() at shutdown.
    // 0) Health/status HTTP server — start first so a supervisor can probe the
    //    process while the heavier components below are still booting.
    const healthServer = startHealthServer();

    await connectToDb();
    status.components.db = true;

    // 2) MQTT notifier (insert NotifyLog when MQTT data breaches a threshold).
    const mqttNotifier = require('./workers/mqttNotifier');
    await mqttNotifier.start();
    status.components.mqttNotifier = true;

    // 3) Web push dispatcher (pick up pending NotifyLog rows, send webpush).
    let dispatcher = null;
    if (webpushEnabled) {
        dispatcher = require('./workers/webpushDispatcher');
        dispatcher.start();
        status.components.webpushDispatcher = true;
    } else {
        console.warn(`${LOG_PREFIX} dispatcher NOT started (VAPID missing)`);
    }

    // 4) LINE dispatcher (per-subscription cursor over NotifyLog → LINE Messaging API).
    //    Independent of VAPID — runs whenever there are active LINE subscriptions.
    const lineDispatcher = require('./workers/lineDispatcher');
    lineDispatcher.start();
    status.components.lineDispatcher = true;

    // 5) Smart EE LINE dispatcher (channel='smart'): same cursor/scope flow but
    //    forwards messages through the smarteepro.com relay (not LINE API direct).
    const smartLineDispatcher = require('./workers/smartLineDispatcher');
    smartLineDispatcher.start();
    status.components.smartLineDispatcher = true;

    // ---- Graceful shutdown ------------------------------------------------
    // Stop the loops first so they don't write to a closed pool, then close
    // the pool, then exit. SIGINT covers Ctrl+C during dev; SIGTERM is what
    // PM2 / systemd / nssm send when stopping the service.
    let shuttingDown = false;
    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`${LOG_PREFIX} ${signal} received, shutting down...`);
        try {
            if (healthServer) healthServer.close();
            if (dispatcher) dispatcher.stop();
            lineDispatcher.stop();
            smartLineDispatcher.stop();
            await mqttNotifier.stop();
            const pool = getPool();
            if (pool) await pool.close();
        } catch (err) {
            console.error(`${LOG_PREFIX} shutdown error:`, err.message);
        } finally {
            process.exit(0);
        }
    }
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    console.log(`${LOG_PREFIX} ready — MQTT notifier + webpush dispatcher running (port ${WORKER_PORT})`);
}

main().catch(err => {
    console.error(`${LOG_PREFIX} fatal startup error:`, err);
    process.exit(1);
});
