// Production static server for the built SPA (client/dist).
//
// `vite preview` is a dev-only tool and is NOT meant for production. This is a
// minimal Express static server with gzip + SPA fallback so the frontend can
// run as its own process on its own port — if it dies, the API and worker keep
// running, and vice versa.
//
// Run:  npm run build  &&  npm run serve   (or via PM2: smartee-frontend)
// Port: FRONTEND_PORT (default 4173).
//
// NOTE: client/package.json is "type": "module", so this file is ESM.

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import compression from 'compression';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.FRONTEND_PORT || '4173', 10);
const DIST_DIR = path.join(__dirname, 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');

if (!fs.existsSync(INDEX_HTML)) {
    console.error(`[frontend] dist not found at ${DIST_DIR} — run "npm run build" first.`);
    process.exit(1);
}

const app = express();
app.use(compression());

// Only Vite's content-hashed files under /assets/ are safe to cache forever.
// Everything else (index.html, sw.js, manifest, config/app-config.json which
// index.js rewrites from the DB at startup) must stay fresh — otherwise service
// worker updates and runtime config changes never reach clients.
app.use(
    express.static(DIST_DIR, {
        index: false,
        setHeaders: (res, filePath) => {
            const normalized = filePath.replace(/\\/g, '/');
            if (normalized.includes('/assets/')) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else {
                res.setHeader('Cache-Control', 'no-cache');
            }
        },
    })
);

// SPA fallback: every non-asset route returns index.html so react-router can
// handle client-side routing on refresh / deep links.
app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(INDEX_HTML);
});

const server = app.listen(PORT, () => {
    console.log(`[frontend] serving ${DIST_DIR} on http://localhost:${PORT}`);
});

function shutdown(signal) {
    console.log(`[frontend] ${signal} received, shutting down...`);
    server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
