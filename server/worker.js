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
//       nssm install SmartEEWorker "C:\Program Files\nodejs\node.exe" "C:\Workspaces\SmartEEweb\server\worker.js"
//       nssm set    SmartEEWorker AppDirectory "C:\Workspaces\SmartEEweb\server"
//       nssm start  SmartEEWorker
//   * On Linux / Docker, use PM2 / systemd to keep this process alive.
//
// In single-process / legacy setups, set ENABLE_MQTT_WORKER=true in the API's
// .env and DON'T start this file — index.js will boot both pieces itself.

require('dotenv').config();
const webpush = require('web-push');
const { connectToDb } = require('./db');

const LOG_PREFIX = '[worker]';

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
    const pool = await connectToDb();
    global.dbPool = pool;

    // 2) MQTT notifier (insert NotifyLog when MQTT data breaches a threshold).
    const mqttNotifier = require('./workers/mqttNotifier');
    await mqttNotifier.start();

    // 3) Web push dispatcher (pick up pending NotifyLog rows, send webpush).
    let dispatcher = null;
    if (webpushEnabled) {
        dispatcher = require('./workers/webpushDispatcher');
        dispatcher.start();
    } else {
        console.warn(`${LOG_PREFIX} dispatcher NOT started (VAPID missing)`);
    }

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
            if (dispatcher) dispatcher.stop();
            await mqttNotifier.stop();
            await pool.close();
        } catch (err) {
            console.error(`${LOG_PREFIX} shutdown error:`, err.message);
        } finally {
            process.exit(0);
        }
    }
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    console.log(`${LOG_PREFIX} ready — MQTT notifier + webpush dispatcher running`);
}

main().catch(err => {
    console.error(`${LOG_PREFIX} fatal startup error:`, err);
    process.exit(1);
});
