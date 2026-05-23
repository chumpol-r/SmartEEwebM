require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const { connectToDb, sql } = require('./db');
const { generateId } = require('./utils/idGenerator');

const app = express();
const PORT = process.env.PORT || 3002;

// ===== Web Push (VAPID) setup =====
// Keys come from .env (dev) or host environment variables (production).
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const webpushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (webpushEnabled) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('[webpush] VAPID configured');
} else {
    console.warn('[webpush] VAPID keys missing — web push disabled (set VAPID_* in .env)');
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Middleware to ensure DB connection
app.use(async (req, res, next) => {
    try {
        if (!global.dbPool) {
            global.dbPool = await connectToDb();
        }
        req.db = global.dbPool;
        next();
    } catch (err) {
        return res.status(500).send('Database connection error');
    }
});

const { Decrypt, Encrypt, EncryptToken, DecryptToken } = require('./utils/crypto');

// Middleware to authenticate token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    console.log("Auth header received:", authHeader ? "Present" : "Missing");

    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) {
        console.log("No token provided");
        return res.sendStatus(401);
    }

    console.log("Token received (first 20 chars):", token.substring(0, 20) + "...");

    // Decrypt token to get user ID (use DecryptToken for base64 encoded tokens)
    const userId = DecryptToken(token);
    console.log("Decrypted userId:", userId);

    if (!userId) {
        console.log("Token decryption failed for token:", token.substring(0, 20) + "...");
        return res.status(403).send("Token decryption failed");
    }

    req.user = { id: userId };
    console.log("Auth success for user:", userId);
    next();
}

// --- Middleware for Permission Check ---
const requirePermission = (menuId) => async (req, res, next) => {
    try {
        // Ensure user is authenticated first
        if (!req.user || !req.user.id) {
            // Try to authenticate from token
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send('Unauthorized - No token provided');
            }
            const userId = DecryptToken(token);
            if (!userId) {
                return res.status(403).send('Unauthorized - Invalid token');
            }
            req.user = { id: userId };
        }

        const userId = req.user.id;

        // Get User Role & Group/Site ID
        // Also get Group/Site details to determine level and super-status
        const userRes = await req.db.request()
            .input('uid', sql.UniqueIdentifier, userId)
            .query("SELECT c_type, c_id, c_email FROM WebUser WHERE u_id = @uid");

        if (userRes.recordset.length === 0) {
            return res.status(403).send('User not found');
        }

        const role = userRes.recordset[0].c_type;
        let targetId = userRes.recordset[0].c_id; // Could be GroupID or SiteID
        const email = userRes.recordset[0].c_email || '';

        // Determine User Level (Group or Site) and Super Group Status
        let isSuperGroup = false;
        let userLevel = 'UNKNOWN'; // 'GROUP' or 'SITE'
        let groupId = null;
        let siteId = null;

        // Check if ID exists in WebGroup
        const groupRes = await req.db.request()
            .input('id', sql.VarChar, targetId)
            .query("SELECT c_active FROM WebGroup WHERE c_id = @id");

        if (groupRes.recordset.length > 0) {
            userLevel = 'GROUP';
            groupId = targetId;
            // Super Group Check: c_active = 'Z' (e.g. TAT)
            if (groupRes.recordset[0].c_active === 'Z') {
                isSuperGroup = true;
            }
        } else {
            // Check if ID exists in WebSite
            const siteRes = await req.db.request()
                .input('id', sql.VarChar, targetId)
                .query("SELECT c_id FROM WebSite WHERE c_id = @id");

            if (siteRes.recordset.length > 0) {
                userLevel = 'SITE';
                siteId = targetId;
                // Site users are never Super Group
                isSuperGroup = false;

                // Resolve Parent Group ID for Site User (if needed)
                const parentRes = await req.db.request()
                    .input('siteId', sql.VarChar, siteId)
                    .query("SELECT main_id FROM WebMainSub WHERE sub_id = @siteId AND sub_type = 'S' AND main_type = 'G'");
                if (parentRes.recordset.length > 0) {
                    groupId = parentRes.recordset[0].main_id;
                }
            }
        }

        // Trim IDs
        if (targetId) targetId = String(targetId).trim();
        if (groupId) groupId = String(groupId).trim();
        if (siteId) siteId = String(siteId).trim();

        console.log(`[DEBUG] requirePermission(${menuId}) - User: ${userId} (${email}) - Level: ${userLevel} - Group: ${groupId} - Site: ${siteId} - Super: ${isSuperGroup}`);

        // SUPER GROUP BYPASS: Super Group users get FULL ACCESS to everything
        if (isSuperGroup) {
            console.log(`[DEBUG] SuperGroup detected - Granting FULL ACCESS for menu ${menuId}`);
            req.userContext = {
                userId,
                userLevel: 'GROUP',
                targetId,
                groupId,
                siteId: null,
                role,
                perms: { view: true, insert: true, update: true, delete: true, admin: true },
                isSuperGroup: true
            };
            return next();
        }

        // Decrypt Role
        let decryptedRole = '';
        try {
            decryptedRole = Decrypt(role);
            if (decryptedRole.startsWith(email)) {
                decryptedRole = decryptedRole.substring(email.length);
            }
        } catch (e) {
            // Ignore decryption error
        }

        // Check Permissions
        // Admin (c_admin='Y') has full access

        // [SHARED PERMISSION LOGIC] - Use groupId (which is already resolved in previous block) if available
        // If it's a SITE user, groupId will be the Parent Group.
        // If it's a GROUP user, groupId will be the targetId.
        const effectivePermId = groupId || targetId;

        const permRes = await req.db.request()
            .input('role', sql.VarChar, role)
            .input('decryptedRole', sql.VarChar, decryptedRole)
            .input('menuId', sql.Int, menuId)
            .input('targetId', sql.VarChar, effectivePermId)
            .query(`
                SELECT c_view, c_insert, c_update, c_delete, c_admin 
                FROM WebPermission 
                WHERE n_menu = @menuId 
                AND (c_type = @role OR c_type = @decryptedRole)
                AND n_site = @targetId
            `);

        let perms = {
            view: false, insert: false, update: false, delete: false, admin: false
        };

        if (permRes.recordset.length > 0) {
            const p = permRes.recordset[0];
            perms.admin = p.c_admin === 'Y';
            perms.view = p.c_view === 'Y' || perms.admin;
            perms.insert = p.c_insert === 'Y' || perms.admin;
            perms.update = p.c_update === 'Y' || perms.admin;
            perms.delete = p.c_delete === 'Y' || perms.admin;
        } else {
            // If no explicit permission exists, DENY access by default
            console.log(`[DEBUG] No explicit permissions for menu ${menuId} at site ${targetId}, DENYING access`);
            perms.view = false;
        }

        // method check
        if (req.method === 'GET' && !perms.view) return res.status(403).send('Access Denied (View)');
        if (req.method === 'POST' && !perms.insert) return res.status(403).send('Access Denied (Insert)');
        if (req.method === 'PUT' && !perms.update) return res.status(403).send('Access Denied (Update)');
        if (req.method === 'DELETE' && !perms.delete) return res.status(403).send('Access Denied (Delete)');

        req.userContext = {
            userId,
            userLevel, // 'GROUP' or 'SITE'
            targetId,  // The User's Direct ID (Group or Site)
            groupId,   // The User's Group (Direct or Parent)
            siteId,    // The User's Site (if Site Level)
            role,
            perms,
            isSuperGroup
        };

        next();
    } catch (err) {
        console.error('Permission Middleware Error:', err);
        res.status(500).send('Internal Server Error during permission check');
    }
};

// Get Meters - Filtered by user's group/site permissions
app.get('/api/getallmeters', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.request().query('SELECT * FROM dbo.WebSerial');
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.get('/api/meters', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const siteCode = req.query.siteCode || '%'; // Default to all if not provided

        // 1. Get user's c_id from WebUser
        const userRes = await req.db.request()
            .input('u_id', sql.UniqueIdentifier, userId)
            .query("SELECT c_id FROM WebUser WHERE u_id = @u_id");

        if (userRes.recordset.length === 0) {
            return res.status(404).send('User not found');
        }

        const targetId = String(userRes.recordset[0].c_id).trim();
        console.log('Meters API - User targetId:', targetId);

        // 2. Determine user level (GROUP or SITE) and Super Group status
        // Uses the SAME logic as requirePermission middleware
        let isSuperGroup = false;
        let userLevel = 'UNKNOWN';
        let groupId = null;
        let siteId = null;

        // Check if ID exists in WebGroup
        const groupRes = await req.db.request()
            .input('id', sql.VarChar, targetId)
            .query("SELECT c_active FROM WebGroup WHERE c_id = @id");

        if (groupRes.recordset.length > 0) {
            userLevel = 'GROUP';
            groupId = targetId;
            // Super Group Check: c_active = 'Z' (same as requirePermission)
            if (groupRes.recordset[0].c_active === 'Z') {
                isSuperGroup = true;
            }
        } else {
            // Check if ID exists in WebSite
            const siteRes = await req.db.request()
                .input('id', sql.VarChar, targetId)
                .query("SELECT c_id FROM WebSite WHERE c_id = @id");

            if (siteRes.recordset.length > 0) {
                userLevel = 'SITE';
                siteId = targetId;
                isSuperGroup = false;

                // Resolve Parent Group ID for Site User
                const parentRes = await req.db.request()
                    .input('siteId', sql.VarChar, siteId)
                    .query("SELECT main_id FROM WebMainSub WHERE sub_id = @siteId AND sub_type = 'S' AND main_type = 'G'");
                if (parentRes.recordset.length > 0) {
                    groupId = String(parentRes.recordset[0].main_id).trim();
                }
            }
        }

        console.log(`Meters API - Level: ${userLevel}, GroupID: ${groupId}, SiteID: ${siteId}, SuperGroup: ${isSuperGroup}`);

        // 3. Get all meters from getmeter stored procedure
        const allMeters = await req.db.request()
            .input('site_code', sql.VarChar, siteCode)
            .query(`exec dbo.getmeter @site_code`);

        // Load c_name from WebSerial for all display names (safe because used only for metadata mapping)
        const globalWebSerialRes = await req.db.request().query("SELECT c_serial_id, c_name FROM WebSerial");
        const globalDisplayMap = new Map();
        globalWebSerialRes.recordset.forEach(r => {
            const sid = String(r.c_serial_id || '').trim();
            const stripped = sid.includes('\\') ? sid.split('\\').pop() : sid;
            if (r.c_name && String(r.c_name).trim() !== '') {
                globalDisplayMap.set(sid.toUpperCase(), String(r.c_name).trim());
                globalDisplayMap.set(stripped.toUpperCase(), String(r.c_name).trim());
            }
        });

        // 4. Super Group: return all meters (with c_name from WebSerial as displayName)
        if (isSuperGroup) {
            console.log('Meters API - Super Group (c_active=Z), returning all meters');

            const metersWithDisplay = allMeters.recordset.map(m => {
                const serial = String(m.serial || m.val || '').trim();
                const strippedSerial = serial.includes('\\') ? serial.split('\\').pop() : serial;
                const displayName = globalDisplayMap.get(serial.toUpperCase()) 
                    || globalDisplayMap.get(strippedSerial.toUpperCase()) 
                    || strippedSerial;
                return { ...m, val: String(m.val || '').trim(), serial, displayName };
            });
            const uniqueMeters = [...new Map(metersWithDisplay.map(m => [m.val, m])).values()];
            console.log('Meters API - After dedup:', uniqueMeters.length, 'from', metersWithDisplay.length);
            return res.json(uniqueMeters);
        }

        // 5. Non-Super: Get allowed serials via WebMainSub hierarchy
        // Same approach as Settings page: Group -> Sites -> Serials (I)
        const getAllowedSerials = async (parentId, visited = new Set()) => {
            if (visited.has(parentId)) return [];
            visited.add(parentId);

            const subRes = await req.db.request()
                .input('parentId', sql.VarChar, parentId)
                .query(`SELECT sub_id, sub_type FROM WebMainSub WHERE main_id = @parentId`);

            let serials = [];
            for (const row of subRes.recordset) {
                const subId = String(row.sub_id).trim();
                if (row.sub_type === 'G' || row.sub_type === 'S') {
                    const childSerials = await getAllowedSerials(subId, visited);
                    serials = serials.concat(childSerials);
                } else if (row.sub_type === 'I') {
                    serials.push(subId);
                }
            }
            return serials;
        };

        // For SITE user: traverse from their siteId only
        // For GROUP user: traverse from their groupId (Group -> Sites -> Serials)
        const startId = (userLevel === 'SITE') ? siteId : (groupId || targetId);
        console.log(`Meters API - Traversing hierarchy from: ${startId} (userLevel=${userLevel})`);

        const allowedSerials = await getAllowedSerials(startId);

        console.log('Meters API - Allowed serial IDs from WebMainSub:', allowedSerials.length);

        if (allowedSerials.length === 0) {
            console.log('Meters API - No allowed serials, returning empty array');
            return res.json([]);
        }

        // 6. Lookup WebSerial to get actual serial names AND c_name for displayName
        let webSerialData = [];
        const chunkSize = 500;
        for (let i = 0; i < allowedSerials.length; i += chunkSize) {
            const chunk = allowedSerials.slice(i, i + chunkSize);
            const serialRes = await req.db.request()
                .query(`SELECT c_id, c_serial_id, c_name FROM WebSerial WHERE c_id IN (${chunk.map(s => `'${s}'`).join(',')})`);
            webSerialData = webSerialData.concat(serialRes.recordset);
        }

        // globalDisplayMap is used for displayName mapping instead of creating a local one.

        // Build allowed set with all variations
        const actualSerialNames = webSerialData.map(r => String(r.c_serial_id).toUpperCase());
        const strippedSerialNames = actualSerialNames.map(s => s.includes('\\') ? s.split('\\').pop() : s);

        const allowedSerialsSet = new Set([
            ...allowedSerials.map(s => String(s).toUpperCase()),
            ...actualSerialNames,
            ...strippedSerialNames
        ]);

        console.log('Meters API - Combined allowed set size:', allowedSerialsSet.size);

        // 7a. Build prefix list from allowed serials for board-to-sensor matching
        // WebSerial stores board IDs (e.g. 'E4JEJVELW68') but getmeter returns
        // sensor serials with suffixes (e.g. 'E4JEJVELW68_001').
        // We need prefix matching to include all sensors on allowed boards.
        const allowedPrefixes = [...allowedSerialsSet].filter(s => s.length >= 5);

        // 7. Filter meters and add displayName
        const filteredMeters = allMeters.recordset.filter(m => {
            const meterVal = String(m.val || '').trim().toUpperCase();
            const meterSerial = String(m.serial || '').trim().toUpperCase();
            const cleanVal = meterVal.includes('\\') ? meterVal.split('\\').pop() : meterVal;
            const cleanSerial = meterSerial.includes('\\') ? meterSerial.split('\\').pop() : meterSerial;

            // Exact match
            if (allowedSerialsSet.has(meterVal) ||
                allowedSerialsSet.has(meterSerial) ||
                allowedSerialsSet.has(cleanVal) ||
                allowedSerialsSet.has(cleanSerial)) {
                return true;
            }

            // Prefix match: check if meter serial starts with any allowed serial
            // e.g. meter serial 'E4JEJVELW68_001' starts with allowed 'E4JEJVELW68'
            for (const prefix of allowedPrefixes) {
                if (cleanSerial.startsWith(prefix + '_') || cleanSerial.startsWith(prefix + '\\') ||
                    cleanVal.startsWith(prefix + '_') || cleanVal.startsWith(prefix + '\\') ||
                    meterSerial.startsWith(prefix + '_') || meterSerial.startsWith(prefix + '\\')) {
                    return true;
                }
            }

            return false;
        }).map(m => {
            const meterSerial = String(m.serial || m.val || '').trim();
            const cleanSerial = meterSerial.includes('\\') ? meterSerial.split('\\').pop() : meterSerial;
            // Try full serial match first, then stripped match
            const displayName = globalDisplayMap.get(meterSerial.toUpperCase()) 
                || globalDisplayMap.get(cleanSerial.toUpperCase()) 
                || cleanSerial;
            return { ...m, val: String(m.val || '').trim(), serial: meterSerial, displayName };
        });

        console.log('Meters API - Total meters:', allMeters.recordset.length);
        console.log('Meters API - Filtered meters count:', filteredMeters.length);

        // Deduplicate by 'val' - keep first occurrence
        const uniqueMeters = [...new Map(filteredMeters.map(m => [m.val, m])).values()];
        console.log('Meters API - After dedup:', uniqueMeters.length);

        res.json(uniqueMeters);
    } catch (err) {
        console.error('Meters API Error:', err);
        res.status(500).send(err.message);
    }
});

// DEBUG: Meters Permission Debug Endpoint (SIMPLIFIED)
app.get('/api/meters/debug', authenticateToken, async (req, res) => {
    const debugInfo = {
        step: 'start',
        userId: null,
        userGroupId: null,
        level1: [],
        level2: [],
        metersCount: 0,
        sampleMeter: null,
        errors: []
    };

    try {
        debugInfo.userId = req.user?.id;
        debugInfo.step = 'got userId';

        // Step 1: Get user's c_id
        const userRes = await req.db.request()
            .input('u_id', sql.UniqueIdentifier, req.user.id)
            .query("SELECT c_id, c_email FROM WebUser WHERE u_id = @u_id");

        debugInfo.step = 'got user info';

        if (userRes.recordset.length === 0) {
            debugInfo.errors.push('User not found');
            return res.json(debugInfo);
        }

        debugInfo.userGroupId = userRes.recordset[0].c_id;
        debugInfo.userEmail = userRes.recordset[0].c_email;
        debugInfo.step = 'got group id';

        // Step 2: Level 1 WebMainSub
        const l1Res = await req.db.request()
            .input('cid', sql.NVarChar, String(debugInfo.userGroupId))
            .query("SELECT sub_id FROM WebMainSub WHERE main_id = @cid");
        debugInfo.level1 = l1Res.recordset.map(r => r.sub_id);
        debugInfo.step = 'got level1';

        // Step 3: Level 2 WebMainSub (if level1 has data)
        if (debugInfo.level1.length > 0) {
            for (const subId of debugInfo.level1) {
                const l2Res = await req.db.request()
                    .input('sid', sql.NVarChar, String(subId))
                    .query("SELECT sub_id FROM WebMainSub WHERE main_id = @sid");
                debugInfo.level2 = debugInfo.level2.concat(l2Res.recordset.map(r => r.sub_id));
            }
            debugInfo.step = 'got level2';
        }

        // Step 3.5: Lookup WebSerial to get actual serial names from level2 IDs
        if (debugInfo.level2.length > 0) {
            const serialRes = await req.db.request()
                .query(`SELECT c_id, c_serial_id FROM WebSerial WHERE c_id IN (${debugInfo.level2.map(s => `'${s}'`).join(',')})`);
            debugInfo.webSerialLookup = serialRes.recordset.map(r => ({ c_id: r.c_id, c_serial_id: r.c_serial_id }));
            debugInfo.actualSerialNames = serialRes.recordset.map(r => r.c_serial_id);
        }

        // Step 4: Get meters sample
        const mRes = await req.db.request()
            .input('site_code', sql.VarChar, '%')
            .query("exec dbo.getmeter @site_code");
        debugInfo.metersCount = mRes.recordset.length;
        debugInfo.sampleMeter = mRes.recordset[0] || null;
        debugInfo.first5Vals = mRes.recordset.slice(0, 5).map(m => m.val);
        debugInfo.first5Serials = mRes.recordset.slice(0, 5).map(m => m.serial);
        debugInfo.step = 'complete';


        res.json(debugInfo);
    } catch (err) {
        debugInfo.errors.push(err.message);
        debugInfo.errorStack = err.stack;
        res.json(debugInfo); // Return debug info even on error
    }
});


// Get Data (The main chart data) - Rewritten for PostgreSQL
app.get('/api/data', async (req, res) => {
    try {
        const {
            paraData, // 'data', 'datatable'
            paraChart, // 'unit', 'Demand', 'CompareUnit', 'estimatemax', 'CompareUnitDetail', 'CompareUnitPeak'
            paraMeter, // Meter ID (comma separated)
            chartColumn, // 'kWh', 'LastkWDemand'
            chartTime, // 'day', 'week', 'month', 'year'
            timeStart,
            timeEnd,
            chartMode // Optional
        } = req.query;

        // DEBUG LOG - MODIFIED 2026-01-13 14:32
        console.log(`[API/DATA v2] timeStart=${timeStart}, paraMeter=${paraMeter}`);

        const column = chartColumn || 'kWh';
        const meters = paraMeter ? paraMeter.split(',').filter(m => m.trim()) : [];

        console.log(`[API/DATA] Parsed meters:`, meters, `column:`, column);

        if (meters.length === 0) {
            console.log(`[API/DATA] No meters - returning empty`);
            return res.json([]);
        }

        let result;
        const metersPlaceholders = meters.map((_, i) => `$${i + 3}`).join(',');

        // Handle different chart types
        if (paraChart === 'smartCompare') {
            console.log(`[API/DATA] Handling smartCompare chart for column: ${column}`);

            // Logic: c_ prefix means cumulative. Energy keys (KWH, KVAH, KVARH) are also cumulative.
            const isCumulative = column.toLowerCase().startsWith('c_') ||
                ['kwh', 'kvah', 'kvarh'].some(k => column.toLowerCase().includes(k));

            const aggCol = isCumulative ? 'n_max' : 'n_avg';
            console.log(`[API/DATA] Smart Aggregation: Using ${aggCol} for ${column}`);

            const request = req.db.request();
            request.input('column', sql.VarChar, column);
            const startStr = timeStart.split(' ')[0];
            request.input('startTime', sql.VarChar, startStr);

            const endStr = timeEnd ? timeEnd.split(' ')[0] + ' 23:59:59' : null;
            if (chartTime !== 'day' && endStr) {
                request.input('endTime', sql.VarChar, endStr);
            }

            const safeMeters = meters.filter(m => !isNaN(m)).map(m => parseInt(m)).join(',');
            if (!safeMeters) return res.json([]);

            const dateCondition = (chartTime === 'day')
                ? 'dt_job_time BETWEEN @startTime AND DATEADD(day, 1, @startTime)'
                : 'dt_job_time BETWEEN @startTime AND @endTime';

            // We use MAX or AVG to be semantically correct if duplicates exist, 
            // but given the original SUM logic, we use SUM to keep current behavior for unique rows.
            // Using SUM(aggCol) is consistent with the original query's style.
            const query = `
                SELECT 
                    FORMAT(dt_job_time, 'yyyy-MM-ddTHH:mm:ss') as times,
                    n_production as meter,
                    ISNULL(SUM(CASE WHEN n_oldst = 0 THEN ${aggCol} ELSE 0 END), 0) as value
                FROM colquartery
                WHERE c_column = @column 
                AND ${dateCondition}
                AND n_production IN (${safeMeters})
                GROUP BY dt_job_time, n_production
                ORDER BY dt_job_time
            `;

            const result = await request.query(query);
            res.json(result.recordset);
            return;
        }

        if (paraChart === 'estimatemax' || paraChart === 'unit') {
            console.log(`[API/DATA] Handling estimatemax/unit chart`);
            // Check DB Type
            const isPostgres = process.env.DB_TYPE === 'postgresql'; // Or check req.db.config... but we know it's MSSQL here or based on db.js

            let query = '';
            // MSSQL Query
            // Note: colquartery table structure: dt_job_time (datetime), n_production (int - meter id), c_column (varchar - 'kWh'), n_unit (float)
            query = `
                SELECT 
                    dt_job_time as times,
                    n_production as meter,
                    ISNULL(SUM(CASE WHEN n_oldst = 0 THEN n_unit ELSE 0 END), 0) as value
                FROM colquartery
                WHERE c_column = @column 
                AND dt_job_time BETWEEN @startTime AND DATEADD(day, 1, @startTime)
                AND n_production IN (${meters.join(',')})
                GROUP BY dt_job_time, n_production
                ORDER BY dt_job_time
            `;

            // Execute with parameters
            const request = req.db.request();
            request.input('column', sql.VarChar, column);
            // Use VarChar to avoid timezone conversion issues with sql.Date
            // timeStart format: 'YYYY-MM-DD HH:mm:ss'
            const startStr = timeStart.split(' ')[0]; // Just date part 'YYYY-MM-DD'
            console.log(`[API/DATA] startStr for query: ${startStr}, chartTime: ${chartTime}`);
            request.input('startTime', sql.VarChar, startStr);

            // For week/month/year, add endTime parameter
            const endStr = timeEnd ? timeEnd.split(' ')[0] + ' 23:59:59' : null;
            if (chartTime !== 'day' && endStr) {
                request.input('endTime', sql.VarChar, endStr);
                console.log(`[API/DATA] endStr for query: ${endStr}`);
            }

            // Note: meters are injected directly into IN clause because they are dynamic count.
            // meters array is filtered by trim() and sanitized by simple check earlier?
            // meters comes from query param. Should validate they are numbers to prevent injection.
            const safeMeters = meters.filter(m => !isNaN(m)).map(m => parseInt(m)).join(',');

            if (!safeMeters) return res.json([]);

            // Day: use DATEADD(day, 1, @startTime) for 1-day range
            // Week/Month/Year: use @endTime for full date range
            const dateCondition = (chartTime === 'day')
                ? 'dt_job_time BETWEEN @startTime AND DATEADD(day, 1, @startTime)'
                : 'dt_job_time BETWEEN @startTime AND @endTime';

            query = `
                SELECT 
                    FORMAT(dt_job_time, 'yyyy-MM-ddTHH:mm:ss') as times,
                    n_production as meter,
                    ISNULL(SUM(CASE WHEN n_oldst = 0 THEN n_unit ELSE 0 END), 0) as value
                FROM colquartery
                WHERE c_column = @column 
                AND ${dateCondition}
                AND n_production IN (${safeMeters})
                GROUP BY dt_job_time, n_production
                ORDER BY dt_job_time
            `;

            const result = await request.query(query);
            console.log(`[API/DATA] Query returned ${result.recordset.length} rows. First row:`, result.recordset[0]);
            res.json(result.recordset);
            return;
        }

        // CompareMeter Chart - Returns pivoted data for multiple meters comparison
        if (paraChart === 'CompareMeter') {
            const safeMeters = meters.filter(m => !isNaN(m)).map(m => parseInt(m));

            if (safeMeters.length === 0) return res.json([]);

            // Query all meters data
            const query = `
                SELECT 
                    FORMAT(dt_job_time, 'yyyy-MM-ddTHH:mm:ss') as times,
                    n_production as meter,
                    ISNULL(SUM(CASE WHEN n_oldst = 0 THEN n_unit ELSE 0 END), 0) as value
                FROM colquartery
                WHERE c_column = @column 
                AND dt_job_time BETWEEN @startTime AND @endTime
                AND n_production IN (${safeMeters.join(',')})
                GROUP BY dt_job_time, n_production
                ORDER BY dt_job_time, n_production
            `;

            const request = req.db.request();
            request.input('column', sql.VarChar, column);
            request.input('startTime', sql.VarChar, timeStart.split(' ')[0]);
            request.input('endTime', sql.VarChar, timeEnd.split(' ')[0] + ' 23:59:59');

            const result = await request.query(query);

            // Pivot data: group by time slot, with each meter as a column
            const pivotedData = {};
            const meterNames = new Set();

            result.recordset.forEach(row => {
                const timeSlot = new Date(row.times);
                let key;

                if (chartTime === 'day') {
                    key = timeSlot.getHours();
                } else if (chartTime === 'week') {
                    key = timeSlot.getDay() || 7; // Sunday = 7
                } else if (chartTime === 'month') {
                    key = timeSlot.getDate();
                } else if (chartTime === 'year') {
                    key = timeSlot.getMonth() + 1;
                }

                if (!pivotedData[key]) {
                    pivotedData[key] = { Times: key };
                }

                // Use meter ID as key
                const meterKey = String(row.meter);
                meterNames.add(meterKey);
                pivotedData[key][meterKey] = (pivotedData[key][meterKey] || 0) + (row.value || 0);
            });

            // Convert to array sorted by time
            const resultArray = Object.values(pivotedData).sort((a, b) => a.Times - b.Times);

            console.log(`[API/DATA CompareMeter] Returned ${resultArray.length} time slots for ${meterNames.size} meters`);
            res.json(resultArray);
            return;
        }

        // Report Chart - Pivot multiple columns (KW, KWH, Volt, Amp, PF)
        if (paraChart === 'Report') {
            const columns = column.split(',').map(c => c.trim().replace(/[\[\]]/g, ''));
            const safeMeters = meters.filter(m => !isNaN(m)).map(m => parseInt(m)).join(',');

            if (!safeMeters) return res.json([]);

            // Build pivot query for all requested columns
            const pivotColumns = columns.map(col => {
                if (col.toLowerCase() === 'kwh') {
                    return `ISNULL(MAX(CASE WHEN c_column = 'KWH' THEN n_unit END), 0) as [${col}]`;
                } else {
                    return `ISNULL(MAX(CASE WHEN c_column = '${col}' THEN n_avg END), 0) as [${col}]`;
                }
            }).join(', ');

            const query = `
                SELECT 
                    FORMAT(dt_job_time, 'dd/MM/yyyy HH:mm') as Times,
                    ${pivotColumns}
                FROM colquartery
                WHERE dt_job_time BETWEEN @startTime AND @endTime
                AND n_production IN (${safeMeters})
                GROUP BY dt_job_time
                ORDER BY dt_job_time
            `;

            const request = req.db.request();
            request.input('startTime', sql.DateTime, timeStart);
            request.input('endTime', sql.DateTime, timeEnd);
            const result = await request.query(query);

            // Add header row for legacy compatibility
            const headerRow = { Times: 'Time' };
            columns.forEach(col => headerRow[col] = col);

            res.json([headerRow, ...result.recordset]);
            return;
        }

        // Billing Chart - Returns OnPeak, OffPeak, Holiday usage for TOU billing
        if (paraChart === 'Billing') {
            const safeMeters = meters.filter(m => !isNaN(m)).map(m => parseInt(m)).join(',');

            if (!safeMeters) return res.json([]);

            // OnPeak: 9:00-22:00 on weekdays (Mon-Fri)
            // OffPeak: 22:00-9:00 on weekdays
            // Holiday: All day on weekends (Sat-Sun)
            const query = `
                SELECT 
                    CAST(dt_job_time AS DATE) as day,
                    SUM(CASE 
                        WHEN DATEPART(WEEKDAY, dt_job_time) IN (1, 7) THEN 0  -- Weekend = Holiday
                        WHEN DATEPART(HOUR, dt_job_time) >= 9 AND DATEPART(HOUR, dt_job_time) < 22 
                        THEN CASE WHEN n_oldst = 0 THEN n_unit ELSE 0 END
                        ELSE 0 
                    END) as OnPeak,
                    SUM(CASE 
                        WHEN DATEPART(WEEKDAY, dt_job_time) IN (1, 7) THEN 0  -- Weekend = Holiday
                        WHEN DATEPART(HOUR, dt_job_time) < 9 OR DATEPART(HOUR, dt_job_time) >= 22 
                        THEN CASE WHEN n_oldst = 0 THEN n_unit ELSE 0 END
                        ELSE 0 
                    END) as OffPeak,
                    SUM(CASE 
                        WHEN DATEPART(WEEKDAY, dt_job_time) IN (1, 7)  -- Weekend = Holiday
                        THEN CASE WHEN n_oldst = 0 THEN n_unit ELSE 0 END
                        ELSE 0 
                    END) as Holiday
                FROM colquartery
                WHERE c_column = 'KWH'
                AND dt_job_time BETWEEN @startTime AND @endTime
                AND n_production IN (${safeMeters})
                GROUP BY CAST(dt_job_time AS DATE)
                ORDER BY CAST(dt_job_time AS DATE)
            `;

            const request = req.db.request();
            request.input('startTime', sql.VarChar, timeStart.split(' ')[0]);
            request.input('endTime', sql.VarChar, timeEnd.split(' ')[0] + ' 23:59:59');

            const result = await request.query(query);
            console.log(`[API/DATA Billing] Returned ${result.recordset.length} days`);
            res.json(result.recordset);
            return;
        }

        // MaxDmPeak_OnPeak - Returns max demand during OnPeak hours
        if (paraChart === 'MaxDmPeak_OnPeak') {
            const safeMeters = meters.filter(m => !isNaN(m)).map(m => parseInt(m)).join(',');

            if (!safeMeters) return res.json([]);

            // Find max demand during OnPeak hours (9:00-22:00 on weekdays)
            const query = `
                SELECT TOP 1
                    dt_job_time as Times,
                    n_production as Meter,
                    ISNULL(MAX(n_max), 0) as MaxDemand
                FROM colquartery
                WHERE c_column = 'LastKwDemand'
                AND dt_job_time BETWEEN @startTime AND @endTime
                AND n_production IN (${safeMeters})
                AND DATEPART(WEEKDAY, dt_job_time) NOT IN (1, 7)  -- Exclude weekends
                AND DATEPART(HOUR, dt_job_time) >= 9 AND DATEPART(HOUR, dt_job_time) < 22  -- OnPeak hours
                GROUP BY dt_job_time, n_production
                ORDER BY ISNULL(MAX(n_max), 0) DESC
            `;

            const request = req.db.request();
            request.input('startTime', sql.VarChar, timeStart.split(' ')[0]);
            request.input('endTime', sql.VarChar, timeEnd.split(' ')[0] + ' 23:59:59');

            const result = await request.query(query);
            console.log(`[API/DATA MaxDmPeak_OnPeak] Result:`, result.recordset[0]);
            res.json(result.recordset);
            return;
        }

        if (paraChart === 'Demand') {
            const query = `
                SELECT 
                    dt_job_time as times,
                    n_production as meter,
                    ISNULL(MAX(n_max), 0) as value
                FROM colquartery
                WHERE c_column = @column
                AND dt_job_time BETWEEN @startTime AND @endTime
                AND n_production IN (${meters.filter(m => !isNaN(m)).map(m => parseInt(m)).join(',')})
                GROUP BY dt_job_time, n_production
                ORDER BY dt_job_time
            `;
            const request = req.db.request();
            request.input('column', sql.VarChar, column);
            request.input('startTime', sql.Date, timeStart.split(' ')[0]);
            request.input('endTime', sql.Date, timeEnd.split(' ')[0]);
            const result = await request.query(query);
            res.json(result.recordset);
        } else {
            const query = `
                SELECT 
                    CAST(dt_job_time AS DATE) as times,
                    n_production as meter,
                    ISNULL(SUM(CASE WHEN n_oldst = 0 THEN n_unit ELSE 0 END), 0) as value
                FROM colquartery
                WHERE c_column = @column
                AND dt_job_time BETWEEN @startTime AND @endTime
                AND n_production IN (${meters.filter(m => !isNaN(m)).map(m => parseInt(m)).join(',')})
                GROUP BY CAST(dt_job_time AS DATE), n_production
                ORDER BY CAST(dt_job_time AS DATE)
            `;
            const request = req.db.request();
            request.input('column', sql.VarChar, column);
            request.input('startTime', sql.Date, timeStart.split(' ')[0]);
            request.input('endTime', sql.Date, timeEnd.split(' ')[0]);
            const result = await request.query(query);
            res.json(result.recordset);
        }
    } catch (err) {
        console.error('Data API Error:', err);
        res.status(500).send(err.message);
    }
});

// System Config API - Returns baseUrl for QR codes and other system settings
app.get('/api/system/config', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const configPath = path.join(__dirname, 'data/system-config.json');

        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            res.json(config);
        } else {
            // Default fallback
            res.json({ baseUrl: 'https://smarteepro.com' });
        }
    } catch (err) {
        console.error('System Config API Error:', err);
        res.json({ baseUrl: 'https://smarteepro.com' });
    }
});

// Get Config (Baht/Unit)
app.get('/api/config', async (req, res) => {
    try {
        const { siteCode, date } = req.query;
        // VB: EXEC [dbo].[GetConfig] 'siteCode','date'
        const result = await req.db.request()
            .query(`EXEC [dbo].[GetConfig] '${siteCode}', '${date}'`);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Realtime API
app.get('/api/realtime', async (req, res) => {
    try {
        const { meters } = req.query; // Comma separated IDs
        if (!meters) return res.json([]);

        // Logic from Realtime.aspx.vb Load_Data
        // select j.c_machine_id,(select c_name from [dbo].[WebSerial] where c_serial_id=iif(j.c_serial_id='10001',j.c_machine_id,j.c_serial_id)) from dbo.jobcurrent as j where j.n_production in (" & meter.Value & ")"

        // We need to be careful with SQL injection here if meters is just a string. 
        // But for now let's assume it's a comma separated list of integers.
        // Better to use a split and parameterized query, but `IN` clause is tricky with params in mssql node.
        // We will sanitize it to be safe.
        const safeMeters = meters.split(',').map(m => parseInt(m)).filter(n => !isNaN(n)).join(',');

        if (!safeMeters) return res.json([]);

        const query = `
            select 
                j.c_machine_id,
                (select c_name from [dbo].[WebSerial] where c_serial_id=iif(j.c_serial_id='10001',j.c_machine_id,j.c_serial_id)) as machine_name,
                j.c_serial_id,
                j.n_production
            from dbo.jobcurrent as j 
            where j.n_production in (${safeMeters})
        `;

        const result = await req.db.request().query(query);

        // In the original code, it then connects to a "NetworkVariableDataSource" (likely OPC/Modbus via a DLL or another service).
        // Since we don't have that DLL/Service in Node.js, we might need to query the DB for the latest data if it's being logged there.
        // The original code has a commented out section `Load_data_old` which queries `dbo.ColQuartery` and `dbo.JobCurrent`.
        // Let's implement a fallback to query `dbo.ColQuartery` or similar if we can't access the live feed.
        // The user said "connect to database", so likely the data is in the DB.

        // Let's try to fetch the latest data from `dbo.ColQuartery` or `dbo.RowData` as seen in `Load_data_old`.
        // "SELECT ... FROM [dbo].[ColQuartery] ..."

        const dataQuery = `
            SELECT 
                D1.[c_serial_id],
                D1.[c_machine_id],
                MAX(CASE WHEN n_column = 7 THEN n_val END) as OEE,
                MAX(CASE WHEN n_column = 8 THEN n_val END) as P,
                MAX(CASE WHEN n_column = 9 THEN n_val END) as A,
                MAX(CASE WHEN n_column = 10 THEN n_val END) as Q,
                MAX(D1.dt_job_time) as last_time
            FROM [dbo].[ColQuartery] as D1
            WHERE D1.n_production IN (${safeMeters})
            AND D1.n_column IN (7,8,9,10)
            GROUP BY D1.[c_serial_id], D1.[c_machine_id]
        `;

        const dataResult = await req.db.request().query(dataQuery);

        // Merge results
        const combined = result.recordset.map(machine => {
            const data = dataResult.recordset.find(d => d.c_machine_id === machine.c_machine_id && d.c_serial_id === machine.c_serial_id) || {};
            return {
                ...machine,
                ...data,
                OEE: data.OEE || 0,
                P: data.P || 0,
                A: data.A || 0,
                Q: data.Q || 0
            };
        });

        res.json(combined);

    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Billing Rates API - Get rates for user's group
app.get('/api/billing/rates', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { date } = req.query;

        // Get user's c_id (Group ID)
        const userRes = await req.db.request()
            .input('uid', sql.UniqueIdentifier, userId)
            .query("SELECT c_id FROM WebUser WHERE u_id = @uid");

        if (userRes.recordset.length === 0) {
            return res.status(404).send('User not found');
        }

        const groupId = userRes.recordset[0].c_id;

        // Try to get rates for this specific group first
        let result = await req.db.request()
            .input('groupId', sql.VarChar, groupId)
            .input('date', sql.VarChar, date)
            .query(`
                SELECT TOP 1 * FROM dbo.Baht 
                WHERE Site_code = @groupId AND Times <= @date 
                ORDER BY Times DESC
            `);

        // If no group-specific rates found, try default rates (Site_code = '%')
        if (result.recordset.length === 0) {
            result = await req.db.request()
                .input('date', sql.VarChar, date)
                .query(`
                    SELECT TOP 1 * FROM dbo.Baht 
                    WHERE Site_code = '%' AND Times <= @date 
                    ORDER BY Times DESC
                `);
        }

        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Billing Rates API - Save rates for user's group
app.post('/api/billing/rates', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { startDate, endDate, rates } = req.body;

        // Get user's c_id (Group ID)
        const userRes = await req.db.request()
            .input('uid', sql.UniqueIdentifier, userId)
            .query("SELECT c_id FROM WebUser WHERE u_id = @uid");

        if (userRes.recordset.length === 0) {
            return res.status(404).send('User not found');
        }

        const groupId = userRes.recordset[0].c_id;
        console.log(`Saving billing rates for group: ${groupId}`);

        // Delete existing rates for this group in date range
        await req.db.request()
            .input('groupId', sql.VarChar, groupId)
            .input('startDate', sql.VarChar, startDate)
            .input('endDate', sql.VarChar, endDate)
            .query(`DELETE FROM dbo.Baht WHERE Site_code = @groupId AND Times BETWEEN @startDate AND @endDate`);

        // Insert for Start Date
        await req.db.request()
            .input('times', sql.VarChar, startDate)
            .input('onPeak', sql.Decimal(18, 4), rates.onPeak)
            .input('offPeak', sql.Decimal(18, 4), rates.offPeak)
            .input('holiday', sql.Decimal(18, 4), rates.holiday)
            .input('demand', sql.Decimal(18, 4), rates.demand)
            .input('ft', sql.Decimal(18, 4), rates.ft)
            .input('service', sql.Decimal(18, 4), rates.service)
            .input('vat', sql.Decimal(18, 4), rates.vat)
            .input('siteCode', sql.VarChar, groupId)
            .query(`
                INSERT INTO dbo.Baht (Times, OnPeak, OffPeak, Holiday, Demand, FT, Service, n_Vat, Site_code)
                VALUES (@times, @onPeak, @offPeak, @holiday, @demand, @ft, @service, @vat, @siteCode)
            `);

        // Insert for End Date (if different from start)
        if (startDate !== endDate) {
            await req.db.request()
                .input('times', sql.VarChar, endDate)
                .input('onPeak', sql.Decimal(18, 4), rates.onPeak)
                .input('offPeak', sql.Decimal(18, 4), rates.offPeak)
                .input('holiday', sql.Decimal(18, 4), rates.holiday)
                .input('demand', sql.Decimal(18, 4), rates.demand)
                .input('ft', sql.Decimal(18, 4), rates.ft)
                .input('service', sql.Decimal(18, 4), rates.service)
                .input('vat', sql.Decimal(18, 4), rates.vat)
                .input('siteCode', sql.VarChar, groupId)
                .query(`
                    INSERT INTO dbo.Baht (Times, OnPeak, OffPeak, Holiday, Demand, FT, Service, n_Vat, Site_code)
                    VALUES (@times, @onPeak, @offPeak, @holiday, @demand, @ft, @service, @vat, @siteCode)
                `);
        }

        console.log(`Billing rates saved successfully for group: ${groupId}`);
        res.json({ success: true, groupId });
    } catch (err) {
        console.error('Failed to save billing rates:', err);
        res.status(500).send(err.message);
    }
});

// Sites API - Filtered by user's group
app.get('/api/sites', requirePermission(33), async (req, res) => {
    try {
        const { siteCode } = req.query;
        const { isSuperGroup, userLevel, groupId, siteId } = req.userContext;

        console.log(`[DEBUG] /api/sites - userLevel=${userLevel}, groupId=${groupId}, siteId=${siteId}, isSuperGroup=${isSuperGroup}`);

        let query = "";

        if (isSuperGroup) {
            // Super Group: See ALL Groups (for comprehensive management)
            // Rename 'c_id' to 'val', 'c_name' to 'name' to match frontend expectation
            query = "SELECT c_id as val, c_name as name FROM WebGroup WHERE c_active = 'Y' ORDER BY c_name";
        } else if (userLevel === 'GROUP') {
            // Group Level: See THEIR OWN Group
            query = `SELECT c_id as val, c_name as name FROM WebGroup WHERE c_id = '${groupId}' AND c_active = 'Y'`;
        } else if (userLevel === 'SITE') {
            // Site Level: See THEIR PARENT Group
            // (Assuming Site Users are allowed to see permissions of their group, or at least see the scope)
            if (groupId) {
                query = `SELECT c_id as val, c_name as name FROM WebGroup WHERE c_id = '${groupId}' AND c_active = 'Y'`;
            } else {
                // Fallback if no parent group found
                console.log(`[DEBUG] /api/sites - Site User ${req.user.id} has no parent group`);
                return res.json([]);
            }
        } else {
            // Fallback: No groups
            console.log(`[DEBUG] /api/sites - Fallback to empty array`);
            return res.json([]);
        }

        console.log(`[DEBUG] /api/sites - Query: ${query}`);
        const result = await req.db.request().query(query);
        console.log(`[DEBUG] /api/sites - Result count: ${result.recordset.length}`);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Total Meter Groups API
app.get('/api/total/groups', async (req, res) => {
    try {
        const { siteCode } = req.query;
        // Logic from Total.aspx.vb loadgrid_management
        const query = `
            SELECT 
                [c_group_name],
                (select c_name from WebSite where c_id = H.c_serial_id) as c_site_name,
                [c_tap_row],
                [c_group_active],
                format(c_date,'dd/MM/yyyy') as c_date,
                n_id 
            FROM dbo.EEGroupHeader as H 
            WHERE c_id in (
                SELECT [sub_id] FROM dbo.webmainsub 
                WHERE sub_type = 'T' 
                and main_id like '${siteCode || '%'}' 
                or main_id in (SELECT [c_id] FROM WebSite where c_id in (select sub_id from dbo.webmainsub where main_id like '${siteCode || '%'}')) 
            )
        `;
        const result = await req.db.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.post('/api/total/groups', async (req, res) => {
    try {
        const { name, siteId } = req.body;
        // Logic from Total.aspx.vb btn_add_total_ServerClick
        await req.db.request().query(`exec dbo.CreateTotalMeter '${name}', '${siteId}'`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.get('/api/total/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Get Header
        const headerRes = await req.db.request().query(`SELECT * FROM dbo.EEGroupHeader WHERE n_id = ${id}`);
        const header = headerRes.recordset[0];

        // Get Items
        const itemsRes = await req.db.request().query(`
            SELECT 
                c_serial_id,
                c_meter_name,
                isnull(n_multiple,1) as n_multiple 
            FROM [dbo].[EEGroupItem] 
            WHERE n_group = ${id}
        `);

        res.json({ header, items: itemsRes.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.put('/api/total/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, items } = req.body; // items: [{ meterId, multiplier }]

        // Update Header
        await req.db.request().query(`UPDATE dbo.EEGroupHeader SET c_group_name = '${name}', c_tap_row = '${items.length}' WHERE n_id = ${id}`);

        // Delete Items
        await req.db.request().query(`DELETE FROM dbo.EEGroupItem WHERE n_group = ${id}`);

        // Insert Items
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await req.db.request().query(`
                INSERT INTO dbo.EEGroupItem (n_group, c_meter_name, c_show, c_main, n_multiple, c_serial_id) 
                VALUES (${id}, '${item.name || item.meterId}', ${i + 1}, 1, ${item.multiplier}, '${item.meterId}')
            `);
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.delete('/api/total/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Logic from Total.aspx.vb cmdDeleteUser_ServerClick
        await req.db.request().query(`DELETE FROM [dbo].[EEGroupItem] WHERE n_group = ${id}`);
        await req.db.request().query(`DELETE FROM [dbo].[WebMainSub] WHERE sub_id = (select c_id from [dbo].[EEGroupHeader] where n_id = ${id})`);
        await req.db.request().query(`DELETE FROM [dbo].[EEGroupHeader] WHERE n_id = ${id}`);
        await req.db.request().query(`DELETE FROM [dbo].[JobData] WHERE c_serial_id = (select c_id from [dbo].[EEGroupHeader] where n_id = ${id})`);
        await req.db.request().query(`DELETE FROM [dbo].[JobCurrent] WHERE c_serial_id = (select c_id from [dbo].[EEGroupHeader] where n_id = ${id})`);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// ========== SMARTBOARD DELETE API ==========
// Delete board with LIKE pattern (includes active='B' records) and cleanup WebSerial
app.delete('/api/smartboards/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const boardId = id;

        // 1. Delete from Smartboard with LIKE pattern (includes boardid + 'B' records)
        await req.db.request()
            .input('boardId', sql.VarChar, boardId + '%')
            .query("DELETE FROM [dbo].[Smartboard] WHERE boardid LIKE @boardId");

        // 2. Check if serial exists in WebSerial and delete if exact match
        const serialCheck = await req.db.request()
            .input('serialId', sql.VarChar, boardId)
            .query("SELECT c_id FROM [dbo].[WebSerial] WHERE c_serial_id = @serialId");

        if (serialCheck.recordset.length > 0) {
            const webSerialId = serialCheck.recordset[0].c_id;

            // Delete from WebMainSub (serial links)
            await req.db.request()
                .input('subId', sql.VarChar, webSerialId)
                .query("DELETE FROM [dbo].[WebMainSub] WHERE sub_id = @subId AND sub_type = 'I'");

            // Delete from WebSerial
            await req.db.request()
                .input('serialId', sql.VarChar, boardId)
                .query("DELETE FROM [dbo].[WebSerial] WHERE c_serial_id = @serialId");
        }

        res.json({ success: true, message: 'Board deleted successfully' });
    } catch (err) {
        console.error("Delete board error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========== SETTINGS DELETE APIs ==========

// Delete Serial - also cleanup WebMainSub
app.delete('/api/settings/serials/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Delete from WebMainSub first (serial links)
        await req.db.request()
            .input('subId', sql.VarChar, id)
            .query("DELETE FROM [dbo].[WebMainSub] WHERE sub_id = @subId AND sub_type = 'I'");

        // Delete from WebSerial
        await req.db.request()
            .input('id', sql.VarChar, id)
            .query("DELETE FROM [dbo].[WebSerial] WHERE c_id = @id");

        res.json({ success: true, message: 'Serial deleted successfully' });
    } catch (err) {
        console.error("Delete serial error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Delete Site - only if no serials linked, also cleanup WebMainSub
app.delete('/api/settings/sites/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if any serials are linked to this site
        const serialCheck = await req.db.request()
            .input('siteId', sql.VarChar, id)
            .query("SELECT COUNT(*) as count FROM [dbo].[WebMainSub] WHERE main_id = @siteId AND sub_type = 'I'");

        if (serialCheck.recordset[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete site: There are serials still linked to this site. Please remove all serials first.'
            });
        }

        // Delete site links from WebMainSub (site as sub - linked to group)
        await req.db.request()
            .input('subId', sql.VarChar, id)
            .query("DELETE FROM [dbo].[WebMainSub] WHERE sub_id = @subId AND sub_type = 'S'");

        // Delete from WebSite
        await req.db.request()
            .input('id', sql.VarChar, id)
            .query("DELETE FROM [dbo].[WebSite] WHERE c_id = @id");

        res.json({ success: true, message: 'Site deleted successfully' });
    } catch (err) {
        console.error("Delete site error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Delete Group - only Super Group can delete
app.delete('/api/settings/groups/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Get user's c_id
        const userResult = await req.db.request()
            .input('uid', sql.VarChar, userId)
            .query("SELECT c_id FROM WebUser WHERE u_id = @uid");

        if (userResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const effectiveId = userResult.recordset[0].c_id;

        // Check if user is Super Group (c_active = 'Z')
        const superGroupCheck = await req.db.request()
            .input('gid', sql.VarChar, effectiveId)
            .query("SELECT c_active FROM WebGroup WHERE c_id = @gid AND c_active = 'Z'");

        const isSuperGroup = superGroupCheck.recordset.length > 0;

        if (!isSuperGroup) {
            return res.status(403).json({
                success: false,
                message: 'Only Super Group users can delete groups'
            });
        }

        // Check if any sites are linked to this group
        const siteCheck = await req.db.request()
            .input('groupId', sql.VarChar, id)
            .query("SELECT COUNT(*) as count FROM [dbo].[WebMainSub] WHERE main_id = @groupId AND sub_type = 'S'");

        if (siteCheck.recordset[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete group: There are sites still linked to this group. Please remove all sites first.'
            });
        }

        // Delete from WebGroup
        await req.db.request()
            .input('id', sql.VarChar, id)
            .query("DELETE FROM [dbo].[WebGroup] WHERE c_id = @id");

        res.json({ success: true, message: 'Group deleted successfully' });
    } catch (err) {
        console.error("Delete group error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Profile API
app.get('/api/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        console.log('Profile API - Token received:', token ? 'Yes' : 'No');
        if (!token) return res.status(401).send('Unauthorized');

        let userId;
        try {
            userId = DecryptToken(token);
            console.log('Profile API - User ID:', userId);
        } catch (decryptErr) {
            console.error('Profile API - Decrypt error:', decryptErr.message);
            return res.status(401).send('Invalid token');
        }

        const result = await req.db.request()
            .input('u_id', sql.UniqueIdentifier, userId)
            .query("SELECT u_id, c_name, c_email, c_type, c_picture FROM WebUser WHERE u_id = @u_id");

        console.log('Profile API - Query result count:', result.recordset.length);

        if (result.recordset.length === 0) return res.status(404).send('User not found');

        const user = result.recordset[0];

        // Decrypt c_type (role) before returning
        let decryptedType = user.c_type;
        try {
            decryptedType = Decrypt(user.c_type);
            // Remove email prefix if present
            if (decryptedType.startsWith(user.c_email)) {
                decryptedType = decryptedType.substring(user.c_email.length);
            }
            console.log('Profile API - Decrypted type:', decryptedType);
        } catch (e) {
            console.log('Profile API - Could not decrypt c_type, using as-is');
        }

        res.json({
            u_id: user.u_id,
            c_name: user.c_name,
            c_email: user.c_email,
            c_type: decryptedType,
            c_picture: user.c_picture
        });
    } catch (err) {
        console.error('Profile API - Error:', err.message);
        res.status(500).send(err.message);
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).send('Unauthorized');

        const userId = DecryptToken(token);
        const { name, email, picture } = req.body; // picture is base64 string or filename

        let query = "UPDATE WebUser SET c_name = @name, c_email = @email";
        if (picture) {
            query += ", c_picture = @picture";
        }
        query += " WHERE u_id = @u_id";

        const request = req.db.request()
            .input('u_id', sql.UniqueIdentifier, userId)
            .input('name', sql.VarChar, name)
            .input('email', sql.VarChar, email);

        if (picture) {
            request.input('picture', sql.VarChar(sql.MAX), picture);
        }

        await request.query(query);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.put('/api/profile/password', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).send('Unauthorized');

        const userId = DecryptToken(token);
        const { oldPassword, newPassword } = req.body;

        // Verify old password
        const userRes = await req.db.request()
            .input('u_id', sql.UniqueIdentifier, userId)
            .query("SELECT c_pass FROM WebUser WHERE u_id = @u_id");

        if (userRes.recordset.length === 0) return res.status(404).send('User not found');

        const dbPass = Decrypt(userRes.recordset[0].c_pass);
        if (dbPass !== oldPassword) {
            return res.status(400).json({ message: 'Incorrect old password' });
        }

        // Update password
        const newPassEncrypted = Encrypt(newPassword);
        await req.db.request()
            .input('u_id', sql.UniqueIdentifier, userId)
            .input('pass', sql.VarChar, newPassEncrypted)
            .query("UPDATE WebUser SET c_pass = @pass WHERE u_id = @u_id");

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Exported Views API - Fetch views exported to menu from WebMenu
app.get('/api/menus/exported-views', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get User Info & specific C_ID (Group/Site)
        const userRes = await req.db.request()
            .input('u_id', sql.UniqueIdentifier, userId)
            .query("SELECT c_type, c_id, c_email FROM WebUser WHERE u_id = @u_id");

        if (userRes.recordset.length === 0) return res.status(404).send('User not found');

        const role = userRes.recordset[0].c_type;
        let targetId = userRes.recordset[0].c_id; // Explicit Group/Site ID
        const email = userRes.recordset[0].c_email;

        // [SHARED PERMISSION LOGIC]
        let effectiveGroupId = targetId;

        const siteCheck = await req.db.request()
            .input('id', sql.VarChar, targetId)
            .query("SELECT c_id FROM WebSite WHERE c_id = @id");

        if (siteCheck.recordset.length > 0) {
            const parentRes = await req.db.request()
                .input('siteId', sql.VarChar, targetId)
                .query("SELECT main_id FROM WebMainSub WHERE sub_id = @siteId AND sub_type = 'S' AND main_type = 'G'");

            if (parentRes.recordset.length > 0) {
                effectiveGroupId = parentRes.recordset[0].main_id;
            }
        }

        let decryptedRole = '';
        try {
            decryptedRole = Decrypt(role);
            if (decryptedRole.startsWith(email)) decryptedRole = decryptedRole.substring(email.length);
        } catch (e) { }

        // 2. Query Exported Views (aspx LIKE 'SavedView/%')
        const permRes = await req.db.request()
            .input('role', sql.VarChar, role)
            .input('decryptedRole', sql.VarChar, decryptedRole)
            .input('targetId', sql.VarChar, effectiveGroupId)
            .query(`
                SELECT DISTINCT m.id, m.parent as viewId, m.name 
                FROM WebPermission p
                JOIN WebMenu m ON p.n_menu = m.id
                WHERE (p.c_type = @role OR p.c_type = @decryptedRole) 
                AND p.n_site = @targetId 
                AND (p.c_view = 'Y' OR p.c_admin = 'Y')
                AND m.used = '1'
                AND m.aspx LIKE 'SavedView/%'
            `);

        res.json(permRes.recordset);
    } catch (err) {
        console.error('Exported Views API Error:', err);
        res.status(500).send(err.message);
    }
});

// User Permissions API
// User Permissions API - Revised to match specific Group/Site scope
app.get('/api/user/permissions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get User Info & specific C_ID (Group/Site)
        const userRes = await req.db.request()
            .input('u_id', sql.UniqueIdentifier, userId)
            .query("SELECT c_type, c_id, c_email FROM WebUser WHERE u_id = @u_id");

        if (userRes.recordset.length === 0) return res.status(404).send('User not found');

        const role = userRes.recordset[0].c_type;
        let targetId = userRes.recordset[0].c_id; // Explicit Group/Site ID
        const email = userRes.recordset[0].c_email;

        // [SHARED PERMISSION LOGIC]
        // Determine if targetId is a Site, if so, resolve to Parent Group ID
        // WebGroups are 2XXXXXXXX, WebSites are 1XXXXXXXX
        let effectiveGroupId = targetId;

        // Check if ID exists in WebSite (implies it's a site)
        // OR check ID range. Let's use DB check to be safe.
        const siteCheck = await req.db.request()
            .input('id', sql.VarChar, targetId)
            .query("SELECT c_id FROM WebSite WHERE c_id = @id");

        if (siteCheck.recordset.length > 0) {
            // It's a Site User. Find the Parent Group.
            const parentRes = await req.db.request()
                .input('siteId', sql.VarChar, targetId)
                .query("SELECT main_id FROM WebMainSub WHERE sub_id = @siteId AND sub_type = 'S' AND main_type = 'G'");

            if (parentRes.recordset.length > 0) {
                effectiveGroupId = parentRes.recordset[0].main_id;
                console.log(`[DEBUG] /api/user/permissions - Site User ${targetId} resolved to Group ${effectiveGroupId}`);
            } else {
                console.log(`[DEBUG] /api/user/permissions - Site User ${targetId} has no Parent Group!`);
            }
        }

        let decryptedRole = '';
        try {
            decryptedRole = Decrypt(role);
            if (decryptedRole.startsWith(email)) decryptedRole = decryptedRole.substring(email.length);
        } catch (e) { }

        // Check if effectiveGroupId is a Super Group (c_active = 'Z')
        let isSuperGroup = false;
        try {
            const groupCheck = await req.db.request()
                .input('gid', sql.VarChar, effectiveGroupId)
                .query("SELECT c_active FROM WebGroup WHERE c_id = @gid");
            if (groupCheck.recordset.length > 0 && groupCheck.recordset[0].c_active === 'Z') {
                isSuperGroup = true;
                console.log(`[DEBUG] /api/user/permissions - Group ${effectiveGroupId} is a Super Group`);
            }
        } catch (e) {
            console.error('[DEBUG] /api/user/permissions - Error checking Super Group status:', e.message);
        }

        const usedCondition = isSuperGroup ? "m.used IN ('1', '2')" : "m.used = '1'";

        // 2. Get Permissions for THIS effectiveGroupId
        // Always query against effectiveGroupId to ensure shared permissions
        const permRes = await req.db.request()
            .input('role', sql.VarChar, role)
            .input('decryptedRole', sql.VarChar, decryptedRole)
            .input('targetId', sql.VarChar, effectiveGroupId)
            .query(`
                SELECT DISTINCT p.n_menu 
                FROM WebPermission p
                JOIN WebMenu m ON p.n_menu = m.id
                WHERE (p.c_type = @role OR p.c_type = @decryptedRole) 
                AND p.n_site = @targetId -- Strict check against Group ID
                AND (p.c_view = 'Y' OR p.c_admin = 'Y')
                AND ${usedCondition}
            `);

        const allowedMenuIds = permRes.recordset.map(r => parseInt(r.n_menu, 10));
        res.json(allowedMenuIds);
    } catch (err) {
        console.error('Permissions API - Error:', err.message);
        res.status(500).send(err.message);
    }
});

// Detailed Permission API for a specific menu
app.get('/api/user/permissions/:menuId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const menuId = parseInt(req.params.menuId);

        // 1. Get User Info
        const userRes = await req.db.request()
            .input('u_id', sql.UniqueIdentifier, userId)
            .query("SELECT c_type, c_id, c_email FROM WebUser WHERE u_id = @u_id");

        if (userRes.recordset.length === 0) return res.status(404).send('User not found');

        const role = userRes.recordset[0].c_type;
        const targetId = userRes.recordset[0].c_id;
        const email = userRes.recordset[0].c_email;

        // [SHARED PERMISSION LOGIC]
        // Determine if targetId is a Site, if so, resolve to Parent Group ID
        let effectiveGroupId = targetId;

        // Check if ID exists in WebSite (implies it's a site)
        const siteCheck = await req.db.request()
            .input('id', sql.VarChar, targetId)
            .query("SELECT c_id FROM WebSite WHERE c_id = @id");

        if (siteCheck.recordset.length > 0) {
            // It's a Site User. Find the Parent Group.
            const parentRes = await req.db.request()
                .input('siteId', sql.VarChar, targetId)
                .query("SELECT main_id FROM WebMainSub WHERE sub_id = @siteId AND sub_type = 'S' AND main_type = 'G'");

            if (parentRes.recordset.length > 0) {
                effectiveGroupId = parentRes.recordset[0].main_id;
            }
        }

        let decryptedRole = '';
        try {
            decryptedRole = Decrypt(role);
            if (decryptedRole.startsWith(email)) decryptedRole = decryptedRole.substring(email.length);
        } catch (e) { }

        // 2. Check Permissions against effectiveGroupId
        const permRes = await req.db.request()
            .input('role', sql.VarChar, role)
            .input('decryptedRole', sql.VarChar, decryptedRole)
            .input('menuId', sql.Int, menuId)
            .input('targetId', sql.VarChar, effectiveGroupId)
            .query(`
                SELECT c_view, c_insert, c_update, c_delete, c_admin 
                FROM WebPermission 
                WHERE n_menu = @menuId 
                AND (c_type = @role OR c_type = @decryptedRole)
                AND n_site = @targetId
            `);

        let perms = { view: false, insert: false, update: false, delete: false, admin: false };

        if (permRes.recordset.length > 0) {
            const p = permRes.recordset[0];
            perms.admin = p.c_admin === 'Y';
            perms.view = p.c_view === 'Y' || perms.admin;
            perms.insert = p.c_insert === 'Y' || perms.admin;
            perms.update = p.c_update === 'Y' || perms.admin;
            perms.delete = p.c_delete === 'Y' || perms.admin;
        }

        res.json(perms);
    } catch (err) {
        console.error('Detailed Permission API - Error:', err.message);
        res.status(500).send(err.message);
    }
});

// Permission API


app.post('/api/permissions/groups', requirePermission(33), async (req, res) => {
    try {
        const { name, siteId } = req.body;
        // Logic from Permission.aspx.vb psnew_ServerClick
        // It seems it just adds to the dropdown in legacy, but doesn't insert into DB until saved?
        // Actually legacy code inserts into WebPermission? No, it just adds to dropdown.
        // But to persist, we probably need to insert a dummy record or just handle it in frontend.
        // Wait, legacy code: dt.Rows.InsertAt(dr, 0) -> then loadgrid.
        // Real persistence happens in pmsv_ServerClick (Save).
        // So for "Create Group", we might just return success and let frontend handle the "New Group" state until saved.
        // OR we can insert a dummy record.
        // Let's look at legacy pmsv_ServerClick: it inserts/updates based on n_site, c_type, n_menu.

        // For now, we will just return success. The actual creation happens when saving permissions.
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.get('/api/permissions/matrix', requirePermission(33), async (req, res) => {
    try {
        const { siteCode, groupName } = req.query;
        // Logic from Permission.aspx.vb loadgrid
        // Updated: For exported views: show "SYSTEM / viewname" if Super Group, else "creator_name / viewname"
        // Also add isExportedView flag to allow frontend to add separator
        // Permissions Matrix
        // Enforce restriction for Site Users
        const { userLevel, siteId: userSiteId, isSuperGroup } = req.userContext;

        if (!isSuperGroup && userLevel === 'SITE' && siteCode !== userSiteId) {
            return res.status(403).send('Access Denied: You can only view permissions for your own site');
        }

        let sqlQuery = `
            SELECT 
                '${groupName}' as name,  
                m.id as menu, 
                CASE 
                    WHEN m.parent NOT LIKE '%[^0-9]%' AND m.parent IS NOT NULL AND LEN(m.parent) > 0 THEN 
                        CASE 
                            WHEN cv.is_super_group = 1 THEN 'SYSTEM / ' + m.name
                            ELSE COALESCE(cv.creator_name, 'Unknown') + ' / ' + m.name
                        END
                    WHEN COALESCE(m.parent,'') = '' THEN m.name
                    ELSE m.parent + ' / ' + m.name
                END as menuname,
                CASE WHEN m.parent NOT LIKE '%[^0-9]%' AND m.parent IS NOT NULL AND LEN(m.parent) > 0 THEN 1 ELSE 0 END as isExportedView,
                COALESCE(t.c_view,'') as "view", 
                COALESCE(t.c_insert,'') as "insert", 
                COALESCE(t.c_update,'') as "update", 
                COALESCE(t.c_delete,'') as "delete", 
                COALESCE(t.c_admin,'') as "admin"
            FROM WebMenu As m 
            LEFT OUTER JOIN WebPermission As t 
            ON m.id = t.n_menu AND t.c_type = '${groupName}' AND t.n_site = '${siteCode}'
            LEFT OUTER JOIN CustomViews As cv
            ON m.parent NOT LIKE '%[^0-9]%' AND m.parent IS NOT NULL AND LEN(m.parent) > 0 AND CAST(m.parent AS INT) = cv.id
            WHERE m.used = '1'
            ORDER BY CASE WHEN m.parent NOT LIKE '%[^0-9]%' AND m.parent IS NOT NULL AND LEN(m.parent) > 0 THEN 1 ELSE 0 END, m.id
        `;

        console.log(`[DEBUG] /api/permissions/matrix Query: ${sqlQuery}`);
        const result = await req.db.request().query(sqlQuery);
        console.log(`[DEBUG] /api/permissions/matrix Result: ${result.recordset.length} rows`);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.post('/api/permissions/matrix', requirePermission(33), async (req, res) => {
    try {
        const { siteCode, groupName, permissions } = req.body;
        // permissions: [{ menuId, view, insert, update, delete, admin }]

        // Logic from Permission.aspx.vb pmsv_ServerClick
        for (const p of permissions) {
            const checkSql = `select count('') as cnt from [WebPermission] where [n_site]='${siteCode}' and [c_type] = '${groupName}' and [n_menu] = ${p.menuId}`;
            const checkRes = await req.db.request().query(checkSql);

            if (checkRes.recordset[0].cnt == 0) {
                // Insert
                await req.db.request().query(`
                    insert into [WebPermission] ([n_site],[c_type],[n_menu],[c_view],[c_insert],[c_update],[c_delete],[c_admin]) 
                    values ('${siteCode}', '${groupName}', ${p.menuId}, 
                    '${p.view ? 'Y' : ''}', '${p.insert ? 'Y' : ''}', '${p.update ? 'Y' : ''}', '${p.delete ? 'Y' : ''}', '${p.admin ? 'Y' : ''}')
                `);
            } else {
                // Update
                await req.db.request().query(`
                    update [WebPermission] set 
                    [c_view] = '${p.view ? 'Y' : ''}',
                    [c_insert] = '${p.insert ? 'Y' : ''}',
                    [c_update] = '${p.update ? 'Y' : ''}',
                    [c_delete] = '${p.delete ? 'Y' : ''}',
                    [c_admin] = '${p.admin ? 'Y' : ''}'
                    where [n_site] = '${siteCode}' and [c_type] = '${groupName}' and [n_menu] = ${p.menuId}
                `);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Smartboard API
// Smartboard API
app.get('/api/smartboards', requirePermission(39), async (req, res) => {
    try {
        console.log("=== API SMARTBOARDS HIT ===");
        console.log("Query:", req.query);
        console.log("Auth:", req.headers.authorization ? req.headers.authorization.substring(0, 40) : "NO TOKEN");
        console.log("UserContext:", req.userContext);

        const { search } = req.query;
        const { groupId, siteId, userLevel, isSuperGroup } = req.userContext;

        let sqlQuery = `
            SELECT TOP 500 [boardid] 
            ,(select 'Sub Meter = '+convert(varchar,count('')) from [dbo].[Smartboard] where boardid like s.boardid+'%' and active='Y') as [active] 
            ,isnull((select c_name from [dbo].[WebGroup] where c_id=s.command),s.command) as [command] 
            ,[mtype],[address],format([datein],'dd/MM/yyyy HH:mm') as dateon,[datein] 
            ,format([dateup],'dd/MM/yyyy HH:mm') as dateup 
            ,isnull([c_desc],'') as [description]
            FROM [dbo].[Smartboard] as S 
            WHERE active = 'B' and boardid <> 'xxxxxxxxxxxxxxx' 
        `;

        let groupName = '';
        if (userLevel === 'GROUP' && !isSuperGroup) {
            const grpRes = await req.db.request().input('gid', sql.VarChar, groupId).query('SELECT c_name FROM WebGroup WHERE c_id = @gid');
            if (grpRes.recordset.length > 0) groupName = grpRes.recordset[0].c_name;
        }

        // Filter Logic
        if (!isSuperGroup) {
            if (userLevel === 'GROUP') {
                // Group Level: Show Smartboards belonging to this Group (by ID or Name) OR via its Sites
                sqlQuery += ` AND (
                    s.command = @groupId 
                    OR s.command = @groupName
                    OR EXISTS (
                        SELECT 1 FROM WebMainSub subSite 
                        JOIN WebMainSub subItem ON subSite.sub_id = subItem.main_id 
                        JOIN WebSerial ws ON subItem.sub_id = ws.c_id
                        WHERE subSite.main_id = @groupId AND subSite.sub_type = 'S' AND subItem.sub_type = 'I' AND ws.c_serial_id = s.boardid
                    )
                    OR EXISTS (
                        SELECT 1 FROM WebMainSub subDirect 
                        JOIN WebSerial ws ON subDirect.sub_id = ws.c_id
                        WHERE subDirect.main_id = @groupId AND subDirect.sub_type = 'I' AND ws.c_serial_id = s.boardid
                    )
                ) `;
            } else if (userLevel === 'SITE') {
                // Site Level: Show Smartboards linked to this Site
                sqlQuery += ` AND EXISTS (
                    SELECT 1 FROM WebMainSub sub 
                    JOIN WebSerial ws ON sub.sub_id = ws.c_id
                    WHERE sub.main_id = @siteId AND sub.sub_type = 'I' AND ws.c_serial_id = s.boardid
                ) `;
            }
        }

        if (search) {
            sqlQuery += ` and (boardid like '%${search}%' or c_desc like '%${search}%')`;
        }
        sqlQuery += " order by datein desc";

        const request = req.db.request();
        if (!isSuperGroup) {
            if (userLevel === 'GROUP') {
                request.input('groupId', sql.VarChar, groupId);
                request.input('groupName', sql.VarChar, groupName);
                console.log(`[DEBUG] Smartboards Query (GROUP): groupId=${groupId}, groupName=${groupName}`);
            }
            if (userLevel === 'SITE') {
                request.input('siteId', sql.VarChar, siteId);
                console.log(`[DEBUG] Smartboards Query (SITE): siteId=${siteId}`);
            }
        }

        console.log('[DEBUG] Smartboard Query:', sqlQuery);
        const result = await request.query(sqlQuery);
        console.log(`[DEBUG] Smartboards Found: ${result.recordset.length}`);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.post('/api/smartboards', requirePermission(39), async (req, res) => {
    try {
        const { serial, description } = req.body;
        // Logic from SmartBoard.aspx.vb btn_save_Click (First part: Create Board)
        const check = await req.db.request().query(`select top 1 '' from dbo.smartboard where boardid = '${serial}'`);
        if (check.recordset.length === 0) {
            await req.db.request().query(`
                insert into dbo.smartboard (boardid,active,command,mtype,address,datein,c_desc) 
                values ('${serial}', 'B', '', '', '', getdate(), '${description || ''}')
            `);
        } else {
            // If exists but not active 'B', reset it? Legacy code deletes others.
            await req.db.request().query(`delete from dbo.smartboard where boardid like '${serial}%' and active <> 'B'`);
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.get('/api/smartboards/:id', requirePermission(39), async (req, res) => {
    try {
        const { id } = req.params;
        // Logic from SmartBoard.aspx.vb loadconfig
        // Also join WebSerial to get channel names (c_name)
        const sqlQuery = `
            select sb.boardid, sb.active, sb.command, sb.mtype, sb.address,
                   ws.c_name as channelName
            from dbo.smartboard sb
            left join dbo.WebSerial ws 
                on ws.c_serial_id COLLATE DATABASE_DEFAULT = sb.boardid COLLATE DATABASE_DEFAULT
                OR ws.c_serial_id COLLATE DATABASE_DEFAULT LIKE '%\\' + sb.boardid COLLATE DATABASE_DEFAULT
                OR (
                    len(sb.boardid) > 2 AND 
                    ws.c_serial_id COLLATE DATABASE_DEFAULT LIKE '%\\' + left(sb.boardid, len(sb.boardid)-2) + '_0' + right(sb.boardid, 2) COLLATE DATABASE_DEFAULT
                )
            where sb.boardid like '${id}%' 
            order by case when left(sb.boardid,1)='I' then iif(sb.active='B',0, iif(sb.active='Y',1, 2) ) else 9 end, sb.boardid
        `;
        const result = await req.db.request().query(sqlQuery);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.put('/api/smartboards/:id', requirePermission(39), async (req, res) => {
    try {
        const { id } = req.params;
        const { channels, description } = req.body; // Array of channels config (up to 20)

        // Logic from SmartBoard.aspx.vb btn_save_Click (Second part: Save Config)

        // 1. Delete existing channels
        await req.db.request()
            .input('idPattern', sql.VarChar, id + '%')
            .query("delete from dbo.smartboard where boardid like @idPattern and active <> 'B'");

        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            const suffix = (id.startsWith('I') && ch.address) ? String(ch.address).padStart(2, '0') : ch.id;
            const boardId = id.startsWith('I') ? id + suffix : id + ch.id;

            await req.db.request()
                .input('boardId', sql.VarChar, String(boardId))
                .input('active', sql.VarChar, ch.enable ? 'Y' : 'N')
                .input('command', sql.VarChar, ch.enable ? String(ch.command || '') : '')
                .input('mtype', sql.VarChar, ch.enable ? String(ch.type || '') : '')
                .input('address', sql.VarChar, ch.enable ? String(ch.address || '') : '')
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.smartboard WHERE boardid = @boardId)
                    BEGIN
                        UPDATE dbo.smartboard 
                        SET active = @active, command = @command, mtype = @mtype, address = @address
                        WHERE boardid = @boardId
                    END
                    ELSE
                    BEGIN
                        INSERT INTO dbo.smartboard (boardid, active, command, mtype, address) 
                        VALUES (@boardId, @active, @command, @mtype, @address)
                    END
                `);
        }

        // Cleanup
        await req.db.request()
            .input('desc', sql.NVarChar, description || '')
            .input('idPattern', sql.VarChar, id + '%')
            .query("update dbo.smartboard set address='X', dateup=getdate(), c_desc=@desc where boardid like @idPattern and active = 'B'");

        // Save channel names to WebSerial.c_name
        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            if (ch.name !== undefined && ch.name !== null) {
                const suffix = (id.startsWith('I') && ch.address) ? String(ch.address).padStart(2, '0') : ch.id;
                const boardId = id.startsWith('I') ? id + suffix : id + ch.id;

                await req.db.request()
                    .input('channelName', sql.NVarChar, String(ch.name || ''))
                    .input('boardId', sql.VarChar, String(boardId))
                    .query(`
                        UPDATE dbo.WebSerial 
                        SET c_name = @channelName 
                        WHERE c_serial_id COLLATE DATABASE_DEFAULT = @boardId COLLATE DATABASE_DEFAULT
                           OR c_serial_id COLLATE DATABASE_DEFAULT LIKE '%\\' + @boardId COLLATE DATABASE_DEFAULT
                           OR (
                               len(@boardId) > 2 AND 
                               c_serial_id COLLATE DATABASE_DEFAULT LIKE '%\\' + left(@boardId, len(@boardId)-2) + '_0' + right(@boardId, 2) COLLATE DATABASE_DEFAULT
                           )
                    `);
            }
        }

        // Sync with WebMainSub (Legacy logic)
        // ...

        res.json({ success: true });
    } catch (err) {
        console.error("Error in PUT /api/smartboards/:id:", err);
        console.error("Request Body:", req.body);
        res.status(500).send(err.message); // Send error message to client
    }
});

app.delete('/api/smartboards/:id', requirePermission(39), async (req, res) => {
    try {
        const { id } = req.params;
        await req.db.request().query(`update dbo.smartboard set command='',mtype='',address='',dateup=getdate() where active = 'B' and boardid like '${id}%'`);
        await req.db.request().query(`delete from dbo.WebMainSub where sub_id in (select c_id from dbo.WebSerial where c_serial_id like '${id}%')`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.get('/api/meter-types', async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');

        // Try reading from new TXT file first
        const txtPath = path.join(__dirname, 'data/meter_types.txt');

        if (fs.existsSync(txtPath)) {
            const fileContent = fs.readFileSync(txtPath, 'utf8');
            const lines = fileContent.split('\n');
            const meters = [];

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                // Match "ID : Name" format (e.g. "793 : Water Meter Vector")
                const match = trimmedLine.match(/^(\d+)\s*:\s*(.+)$/);
                if (match) {
                    meters.push({
                        id: match[1],
                        name: match[2].trim()
                    });
                } else {
                    // It's a header/category
                    // Remove content in parentheses and trim
                    let header = trimmedLine.replace(/\s*\(.*?\)\s*/g, '').trim();
                    if (header) {
                        meters.push({
                            id: `HEADER_${header}_${Math.random().toString(36).substr(2, 9)}`, // Unique ID
                            name: `---- ${header} ----`,
                            disabled: true
                        });
                    }
                }
            }
            return res.json(meters);
        }

        // Fallback to old XML file if TXT doesn't exist
        const xmlPath = path.join(__dirname, '../Project_SmartEE-Anywhere/build/data/meterlist.xml');

        if (fs.existsSync(xmlPath)) {
            const xmlData = fs.readFileSync(xmlPath, 'utf8');
            // Simple regex parsing since we don't want to add xml2js dependency if not needed
            // <dt><n_id>...</n_id><c_name>...</c_name></dt>
            const matches = xmlData.match(/<dt>[\s\S]*?<\/dt>/g);
            if (matches) {
                const meters = matches.map(m => {
                    const idMatch = m.match(/<n_id>(.*?)<\/n_id>/);
                    const nameMatch = m.match(/<c_name>(.*?)<\/c_name>/);
                    return {
                        id: idMatch ? idMatch[1] : '',
                        name: nameMatch ? nameMatch[1] : ''
                    };
                });
                return res.json(meters);
            }
        }

        res.json([]);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Setting API
// Groups - OLD DUPLICATE REMOVED (now handled with auth at line 3355+)
// app.get('/api/settings/groups', async (req, res) => {
//     -- Removed: Duplicate endpoint without authentication
// });

app.post('/api/settings/groups', async (req, res) => {
    try {
        const { name, active, subIds } = req.body;
        // Generate New ID
        const idRes = await req.db.request().query("Select Right('20000000' + CONVERT(VARCHAR,CONVERT(INT,ISNULL(MAX(CAST(c_id AS INT)),0)) + 1),9) as New_ID From WebGroup");
        const newId = idRes.recordset[0].New_ID;

        await req.db.request().query(`insert into WebGroup (c_id,c_name,c_active) values ('${newId}', '${name}', '${active ? 'Y' : 'N'}')`);

        if (subIds && subIds.length > 0) {
            for (const subId of subIds) {
                let subType = 'I';
                if (parseInt(subId) < 200000000 && parseInt(subId) > 100000000) subType = 'S';
                await req.db.request().query(`insert into WebMainSub (main_id,main_type,sub_id,sub_type) values ('${newId}', 'G', '${subId}', '${subType}')`);
            }
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.put('/api/settings/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, active, subIds } = req.body;

        await req.db.request().query(`Update WebGroup set c_name ='${name}', c_active = '${active ? 'Y' : 'N'}' Where c_id = '${id}'`);

        if (subIds) {
            await req.db.request().query(`Delete From WebMainSub Where main_id ='${id}'`);
            for (const subId of subIds) {
                let subType = 'I';
                if (parseInt(subId) < 200000000 && parseInt(subId) > 100000000) subType = 'S';
                await req.db.request().query(`insert into WebMainSub (main_id,main_type,sub_id,sub_type) values ('${id}', 'G', '${subId}', '${subType}')`);
            }
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.delete('/api/settings/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await req.db.request().query(`Delete From WebGroup where c_id = '${id}'`);
        await req.db.request().query(`Delete From WebMainSub Where main_id ='${id}'`);
        await req.db.request().query(`Delete From WebPermission Where n_site ='${id}'`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Sites
app.get('/api/settings/sites', async (req, res) => {
    try {
        const { search } = req.query;
        let sql = "select c_name, c_active, c_id from WebSite";
        if (search && search !== '%') {
            sql += ` where c_id like '${search}' or c_id in (select sub_id from dbo.webmainsub where main_id like '${search}')`;
        }
        sql += " order by c_id asc";
        const result = await req.db.request().query(sql);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.post('/api/settings/sites', async (req, res) => {
    try {
        const { name, active, subIds, parentId } = req.body;
        const idRes = await req.db.request().query("Select Right('10000000' + CONVERT(VARCHAR,CONVERT(INT,ISNULL(MAX(CAST(c_id AS INT)),0)) + 1),9) as New_ID From WebSite");
        const newId = idRes.recordset[0].New_ID;

        await req.db.request().query(`insert into WebSite (c_id,c_name,c_active) values ('${newId}', '${name}', '${active ? 'Y' : 'N'}')`);

        if (parentId && parentId !== '%') {
            await req.db.request().query(`insert into WebMainSub (main_id,main_type,sub_id,sub_type) values ('${parentId}', 'G', '${newId}', 'S')`);
            // Auto Insert System permission
            await req.db.request().query(`insert into [dbo].[WebPermission] ([n_site], [c_type], [n_menu], [c_view], [c_insert], [c_update], [c_delete], [c_admin]) Select ${newId},'System',[id],'','','','','Y' from [dbo].[WebMenu] Where used = 1`);
        }

        if (subIds && subIds.length > 0) {
            for (const subId of subIds) {
                await req.db.request().query(`insert into WebMainSub (main_id,main_type,sub_id,sub_type) values ('${newId}', 'S', '${subId}', 'I')`);
            }
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.put('/api/settings/sites/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, active, subIds } = req.body;

        await req.db.request().query(`Update WebSite set c_name ='${name}', c_active = '${active ? 'Y' : 'N'}' Where c_id = '${id}'`);

        if (subIds) {
            await req.db.request().query(`Delete From WebMainSub Where main_id ='${id}'`);
            for (const subId of subIds) {
                await req.db.request().query(`insert into WebMainSub (main_id,main_type,sub_id,sub_type) values ('${id}', 'S', '${subId}', 'I')`);
            }
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.delete('/api/settings/sites/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await req.db.request().query(`Delete From WebSite where c_id = '${id}'`);
        await req.db.request().query(`Delete From WebMainSub Where main_id ='${id}'`);
        await req.db.request().query(`Delete From WebPermission Where n_site ='${id}'`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Serials
app.get('/api/settings/serials', async (req, res) => {
    try {
        const { search } = req.query;
        let sql = `
            select c_serial_id, c_name
            ,(select top 1 convert(varchar,datein,103) + ' ' + convert(varchar,datein,108) from dbo.smartboard where boardid=substring(c_serial_id, 1, len(c_serial_id)-2) ) as c_datein
            ,convert(varchar,dt_stop,103) + ' ' + convert(varchar,dt_stop,108) as c_stop ,c_active, c_id 
            from WebSerial as w 
        `;
        if (search && search !== '%') {
            sql += ` where c_id in (select sub_id from WebMainSub where main_id like '${search}' or main_id in (select sub_id from dbo.webmainsub where main_id like '${search}')) or substring(c_serial_id, 1, len(c_serial_id)-2) in (select boardid from dbo.[Smartboard] where command = '${search}' and active = 'B')`;
        }
        sql += " order by convert(int,c_id) desc";
        const result = await req.db.request().query(sql);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.post('/api/settings/serials', async (req, res) => {
    try {
        const { serial, parentId } = req.body;
        // Logic from Setting.aspx.vb loadnew_serial
        // 1. Check if exists in Smartboard
        const sbCheck = await req.db.request().query(`select command from Smartboard where boardid='${serial}' and active='B'`);
        if (sbCheck.recordset.length > 0) {
            // 2. Insert into WebSerial
            const checkWs = await req.db.request().query(`select top 1 '' from [WebSerial] where c_serial_id like '${serial}%'`);
            if (checkWs.recordset.length === 0) {
                await req.db.request().query(`
                    insert into [WebSerial] ([c_id],[c_serial_id],[c_name],[c_active]) 
                    select format((select convert(int,max([c_id])) + convert(int,right([boardid],2)) from [WebSerial]),'000000000'),[boardid],[boardid],'Y' from [Smartboard] 
                    where boardid like '${serial}%' and active='Y';
                    update [Smartboard] set command = '${parentId || '%'}' where boardid = '${serial}';
                `);

                // 3. Link to Site
                if (parentId) {
                    await req.db.request().query(`
                        insert into WebMainSub (main_id,main_type,sub_id,sub_type) 
                        select '${parentId}','S',c_id,'I' from [WebSerial] where c_serial_id like '${serial}%'
                     `);
                }
                res.json({ success: true });
            } else {
                res.status(400).json({ message: 'Serial already used' });
            }
        } else {
            res.status(404).json({ message: 'Serial not found in Smartboard' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.put('/api/settings/serials/:id', async (req, res) => {
    try {
        const { id } = req.params; // c_serial_id
        const { name, active } = req.body;
        await req.db.request().query(`Update WebSerial set c_name ='${name}', c_active = '${active ? 'Y' : 'N'}' Where c_serial_id = '${id}'`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.delete('/api/settings/serials/:id', async (req, res) => {
    try {
        const { id } = req.params; // c_id
        await req.db.request().query(`Delete From WebSerial where c_id = '${id}'`);
        // Note: Legacy code deletes from WebGroup? Typo in legacy? 
        // Case "I" -> Delete From WebGroup where c_id = ... 
        // I think it meant WebSerial. I will assume WebSerial.
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});



// --- System Config API ---
app.get('/api/system/config', async (req, res) => {
    try {
        // Note: SystemSettings table already created during PostgreSQL migration

        // Get Base URL
        const result = await req.db.request().query("SELECT settingvalue FROM systemsettings WHERE settingkey = 'BaseURL'");
        let baseUrl = 'http://localhost:5173'; // Default

        if (result.recordset.length > 0) {
            baseUrl = result.recordset[0].SettingValue;
        } else {
            // Insert default if missing
            await req.db.request().query(`INSERT INTO SystemSettings (SettingKey, SettingValue) VALUES ('BaseURL', '${baseUrl}')`);
        }

        res.json({ baseUrl });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.post('/api/system/config', async (req, res) => {
    try {
        const { baseUrl } = req.body;
        if (!baseUrl) return res.status(400).json({ message: "Base URL is required" });

        // Update or Insert
        const check = await req.db.request().query("SELECT * FROM SystemSettings WHERE SettingKey = 'BaseURL'");
        if (check.recordset.length > 0) {
            await req.db.request().query(`UPDATE SystemSettings SET SettingValue = '${baseUrl}' WHERE SettingKey = 'BaseURL'`);
        } else {
            await req.db.request().query(`INSERT INTO SystemSettings (SettingKey, SettingValue) VALUES ('BaseURL', '${baseUrl}')`);
        }
        res.json({ success: true, baseUrl });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});



// --- QR Code / Device Registration Endpoints ---

// Get All Users
app.get('/api/users', requirePermission(32), async (req, res) => {
    try {
        const { groupId, siteId, userLevel, isSuperGroup } = req.userContext;

        let sqlQuery = `
            SELECT u.*, g.c_name as group_name 
            FROM WebUser u
            LEFT JOIN WebGroup g ON u.c_id = g.c_id
        `;

        if (!isSuperGroup) {
            if (userLevel === 'GROUP') {
                // Group Level: Users in Group OR Users in Sites under Group
                // Note: Site Users have c_id = SiteID. Site is linked to Group via WebMainSub (G->S)
                sqlQuery += ` 
                    WHERE u.c_id = @groupId 
                    OR u.c_id IN (
                        SELECT sub_id FROM WebMainSub 
                        WHERE main_id = @groupId AND sub_type = 'S'
                    )
                `;
            } else if (userLevel === 'SITE') {
                // Site Level: Users in same Site
                sqlQuery += ` WHERE u.c_id = @siteId `;
            }
        }

        sqlQuery += ` ORDER BY u.c_name`;

        const request = req.db.request();
        if (!isSuperGroup) {
            if (userLevel === 'GROUP') request.input('groupId', sql.VarChar, groupId);
            if (userLevel === 'SITE') request.input('siteId', sql.VarChar, siteId);
        }

        const result = await request.query(sqlQuery);
        const users = result.recordset.map(u => {
            let role = u.c_type;
            try {
                role = Decrypt(u.c_type);
                // Remove email prefix if present
                if (role.startsWith(u.c_email)) {
                    role = role.substring(u.c_email.length);
                }
            } catch (e) { }
            return {
                id: u.u_id,
                cid: u.c_id,
                name: u.c_name,
                email: u.c_email,
                role: role,
                group: u.group_name || '-',
                active: u.c_active,
                picture: u.c_picture,
                requestDate: u.dt_request
            };
        });
        res.json(users);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Create User
app.post('/api/users', requirePermission(32), async (req, res) => {
    try {
        const { name, email, password, role, active } = req.body;

        // Check if email exists
        const check = await req.db.request()
            .input('email', sql.VarChar, email)
            .query("SELECT * FROM WebUser WHERE c_email = @email");

        if (check.recordset.length > 0) {
            return res.status(400).json({ message: "Email already exists" });
        }
        const encryptedPass = Encrypt(password);
        // Prepend email to role before encryption
        const fullRole = email + role;
        const encryptedRole = Encrypt(fullRole);

        await req.db.request()
            .input('name', sql.VarChar, name)
            .input('email', sql.VarChar, email)
            .input('pass', sql.VarChar, encryptedPass)
            .input('type', sql.VarChar, encryptedRole)
            .input('active', sql.VarChar, active || 'Y')
            .query(`
                INSERT INTO WebUser (u_id, c_name, c_email, c_pass, c_type, c_active, dt_request)
                VALUES (NEWID(), @name, @email, @pass, @type, @active, GETDATE())
            `);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Update User
app.put('/api/users/:id', requirePermission(32), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role, active, password } = req.body;

        // Prepend email to role before encryption
        const fullRole = email + role;

        let query = `
            UPDATE WebUser 
            SET c_name = @name, 
                c_email = @email, 
                c_type = @type, 
                c_active = @active
        `;

        const request = req.db.request()
            .input('id', sql.VarChar, id)
            .input('name', sql.VarChar, name)
            .input('email', sql.VarChar, email)
            .input('type', sql.VarChar, Encrypt(fullRole))
            .input('active', sql.VarChar, active);

        if (password) {
            query += `, c_pass = @pass`;
            request.input('pass', sql.VarChar, Encrypt(password));
        }

        query += ` WHERE u_id = @id`;

        await request.query(query);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Delete User
app.delete('/api/users/:id', requirePermission(32), async (req, res) => {
    try {
        const { id } = req.params;
        await req.db.request()
            .input('id', sql.VarChar, id)
            .query("DELETE FROM WebUser WHERE u_id = @id");
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Get Roles
app.get('/api/roles', authenticateToken, async (req, res) => {
    try {
        // Get distinct roles from WebPermission that are NOT encrypted (readable)
        // Or just get all and try to decrypt?
        // Actually, we want the "Group Names".
        // Inspect showed: 'System', 'Admin', 'NU', 'Viewer', 'OK', 'Administrator', 'owner'
        // And some encrypted ones.
        // We should probably filter out the encrypted ones if we want a clean list of groups.
        // Or just return all distinct c_type.

        const result = await req.db.request().query("SELECT DISTINCT c_type FROM WebPermission");
        const roles = result.recordset
            .map(r => r.c_type)
            .filter(r => {
                // Filter out likely encrypted strings (long, special chars)
                // Or just try to decrypt? If it decrypts to something valid, maybe show that?
                // But 'System' decrypts to garbage usually.
                // Simple heuristic: if it contains spaces or is short, it's likely a group name.
                // Encrypted strings are usually long and have no spaces (except maybe decrypted).
                // Let's just return all for now, frontend can filter.
                return r.length < 50; // Arbitrary length check?
            });

        res.json(roles);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});



// Get All Serials (Top 100 for initial view) - Filtered by Permission
app.get('/api/settings/all-serials', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get c_id for permission check
        const userRes = await req.db.request()
            .input('uid', sql.UniqueIdentifier, userId)
            .query("SELECT c_id FROM WebUser WHERE u_id = @uid");

        if (userRes.recordset.length === 0) {
            return res.status(404).send('User not found');
        }

        const targetId = String(userRes.recordset[0].c_id).trim();

        // Determine user level and Super Group status (same as requirePermission)
        let isSuperGroup = false;
        let userLevel = 'UNKNOWN';
        let groupId = null;
        let siteId = null;

        const groupRes = await req.db.request()
            .input('id', sql.VarChar, targetId)
            .query("SELECT c_active FROM WebGroup WHERE c_id = @id");

        if (groupRes.recordset.length > 0) {
            userLevel = 'GROUP';
            groupId = targetId;
            if (groupRes.recordset[0].c_active === 'Z') {
                isSuperGroup = true;
            }
        } else {
            const siteRes = await req.db.request()
                .input('id', sql.VarChar, targetId)
                .query("SELECT c_id FROM WebSite WHERE c_id = @id");

            if (siteRes.recordset.length > 0) {
                userLevel = 'SITE';
                siteId = targetId;
                isSuperGroup = false;

                const parentRes = await req.db.request()
                    .input('siteId', sql.VarChar, siteId)
                    .query("SELECT main_id FROM WebMainSub WHERE sub_id = @siteId AND sub_type = 'S' AND main_type = 'G'");
                if (parentRes.recordset.length > 0) {
                    groupId = String(parentRes.recordset[0].main_id).trim();
                }
            }
        }

        console.log(`[DEBUG] all-serials: User ${userId} -> Level ${userLevel}, GroupID ${groupId}, SiteID ${siteId}, SuperGroup: ${isSuperGroup}`);

        if (isSuperGroup) {
            // Super Group sees all serials
            const result = await req.db.request()
                .query("SELECT TOP 100 * FROM WebSerial ORDER BY c_serial_id");
            return res.json(result.recordset);
        }

        // Non-super: Get serials via WebMainSub hierarchy
        const startId = (userLevel === 'SITE') ? siteId : (groupId || targetId);

        const result = await req.db.request()
            .input('startId', sql.VarChar, startId)
            .query(`
                SELECT TOP 100 s.*,
                (SELECT COUNT(*) FROM Smartboard sb WHERE sb.active='Y' AND (s.c_serial_id LIKE '%'+sb.boardid OR s.c_serial_id = sb.boardid)) as smartboard_active
                FROM WebSerial s
                WHERE s.c_id IN (
                    -- Direct serials linked to startId
                    SELECT ws.sub_id FROM WebMainSub ws
                    WHERE ws.sub_type = 'I' AND ws.main_id = @startId
                    UNION
                    -- Serials linked via sub-sites of startId
                    SELECT ws2.sub_id FROM WebMainSub ws2
                    WHERE ws2.sub_type = 'I' AND ws2.main_id IN (
                        SELECT ms.sub_id FROM WebMainSub ms 
                        WHERE ms.main_id = @startId AND ms.sub_type = 'S'
                    )
                )
                ORDER BY s.c_serial_id
            `);

        console.log(`[DEBUG] all-serials found: ${result.recordset.length}`);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});


// Search Serial List (Partial Match) - Filtered by Permission
app.get('/api/settings/search-serials', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const userId = req.user.id;

        // Get c_id for permission check
        const userRes = await req.db.request()
            .input('uid', sql.VarChar, userId)
            .query("SELECT c_id FROM WebUser WHERE u_id = @uid");

        let targetId = null;
        let isSuperGroup = false;
        let userLevel = 'UNKNOWN';
        let groupId = null;
        let siteId = null;

        if (userRes.recordset.length > 0) {
            targetId = String(userRes.recordset[0].c_id).trim();

            // Check if ID exists in WebGroup
            const groupRes = await req.db.request()
                .input('id', sql.VarChar, targetId)
                .query("SELECT c_active FROM WebGroup WHERE c_id = @id");

            if (groupRes.recordset.length > 0) {
                userLevel = 'GROUP';
                groupId = targetId;
                if (groupRes.recordset[0].c_active === 'Z') {
                    isSuperGroup = true;
                }
            } else {
                // Check if ID exists in WebSite
                const siteRes = await req.db.request()
                    .input('id', sql.VarChar, targetId)
                    .query("SELECT c_id FROM WebSite WHERE c_id = @id");

                if (siteRes.recordset.length > 0) {
                    userLevel = 'SITE';
                    siteId = targetId;
                    isSuperGroup = false;

                    const parentRes = await req.db.request()
                        .input('siteId', sql.VarChar, siteId)
                        .query("SELECT main_id FROM WebMainSub WHERE sub_id = @siteId AND sub_type = 'S' AND main_type = 'G'");
                    if (parentRes.recordset.length > 0) {
                        groupId = String(parentRes.recordset[0].main_id).trim();
                    }
                }
            }
        }

        if (isSuperGroup || !targetId) {
            // Super Group: search all serials
            const result = await req.db.request()
                .input('q', sql.VarChar, `%${q}%`)
                .query("SELECT TOP 50 s.c_id, s.c_serial_id, s.c_name FROM WebSerial s WHERE (s.c_serial_id LIKE @q OR s.c_name LIKE @q) ORDER BY s.c_serial_id");
            return res.json(result.recordset);
        }

        // Non-super: filter by hierarchy
        const startId = (userLevel === 'SITE') ? siteId : (groupId || targetId);

        const result = await req.db.request()
            .input('q', sql.VarChar, `%${q}%`)
            .input('startId', sql.VarChar, startId)
            .query(`
                SELECT TOP 50 s.c_id, s.c_serial_id, s.c_name 
                FROM WebSerial s 
                WHERE (s.c_serial_id LIKE @q OR s.c_name LIKE @q)
                AND s.c_id IN (
                    -- Direct serials linked to startId
                    SELECT ws.sub_id FROM WebMainSub ws
                    WHERE ws.sub_type = 'I' AND ws.main_id = @startId
                    UNION
                    -- Serials linked via sub-sites of startId
                    SELECT ws2.sub_id FROM WebMainSub ws2
                    WHERE ws2.sub_type = 'I' AND ws2.main_id IN (
                        SELECT ms.sub_id FROM WebMainSub ms 
                        WHERE ms.main_id = @startId AND ms.sub_type = 'S'
                    )
                )
                ORDER BY s.c_serial_id
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});


// [DEBUG] Who Am I
app.get('/api/debug/whoami', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const userRes = await req.db.request()
            .input('uid', sql.VarChar, userId)
            .query("SELECT u_id, c_id, c_name, c_email FROM WebUser WHERE u_id = @uid");

        let userInfo = {
            u_id: userId,
            c_id: null,
            name: 'Unknown',
            email: 'Unknown',
            isSuperGroup: false,
            effectiveId: userId
        };

        if (userRes.recordset.length > 0) {
            const u = userRes.recordset[0];
            userInfo.c_id = u.c_id;
            userInfo.name = u.c_name;
            userInfo.email = u.c_email;
            userInfo.effectiveId = u.c_id;

            // Check Super Group
            const groupRes = await req.db.request()
                .input('gid', sql.VarChar, u.c_id)
                .query("SELECT c_active FROM WebGroup WHERE c_id = @gid");

            if (groupRes.recordset.length > 0) {
                userInfo.groupActive = groupRes.recordset[0].c_active;
                if (groupRes.recordset[0].c_active === 'Z') {
                    userInfo.isSuperGroup = true;
                }
            }
        }

        res.json(userInfo);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Get Serial Details (Hierarchy: Serial -> Site -> Group)
app.get('/api/settings/serial-details', authenticateToken, async (req, res) => {
    try {
        const { id } = req.query; // WebSerial c_id
        if (!id) return res.status(400).json({ message: "ID is required" });

        // 1. Find Serial
        const serialRes = await req.db.request()
            .input('id', sql.VarChar, id)
            .query("SELECT * FROM WebSerial WHERE c_id = @id");

        if (serialRes.recordset.length === 0) {
            return res.status(404).json({ message: "Serial not found" });
        }

        const serialData = serialRes.recordset[0];
        const serialId = serialData.c_id;

        // 2. Find Parent Site (User Logic: sub_id=serialId, sub_type='I')
        const siteLinkRes = await req.db.request()
            .input('sid', sql.VarChar, serialId)
            .query("SELECT main_id FROM WebMainSub WHERE sub_id = @sid AND sub_type = 'I'");

        let siteData = null;
        let groupData = null;

        if (siteLinkRes.recordset.length > 0) {
            const siteId = siteLinkRes.recordset[0].main_id;

            // Get Site Details
            const siteRes = await req.db.request()
                .input('id', sql.VarChar, siteId)
                .query("SELECT * FROM WebSite WHERE c_id = @id");

            if (siteRes.recordset.length > 0) {
                siteData = siteRes.recordset[0];

                // 3. Find Parent Group (User Logic: sub_id=siteId, sub_type='S')
                const groupLinkRes = await req.db.request()
                    .input('sid', sql.VarChar, siteId)
                    .query("SELECT main_id FROM WebMainSub WHERE sub_id = @sid AND sub_type = 'S'");

                if (groupLinkRes.recordset.length > 0) {
                    const groupId = groupLinkRes.recordset[0].main_id;
                    // Get Group Details
                    const groupRes = await req.db.request()
                        .input('id', sql.VarChar, groupId)
                        .query("SELECT * FROM WebGroup WHERE c_id = @id");

                    if (groupRes.recordset.length > 0) {
                        groupData = groupRes.recordset[0];
                    }
                }
            }
        }

        res.json({
            serial: serialData,
            site: siteData,
            group: groupData
        });

    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Search Serial Hierarchy
app.get('/api/settings/search-serial', authenticateToken, async (req, res) => {
    try {
        const { serial } = req.query;
        if (!serial) return res.status(400).json({ message: "Serial is required" });

        // 1. Find Serial in WebSerial
        const serialRes = await req.db.request()
            .input('serial', sql.VarChar, serial)
            .query("SELECT * FROM WebSerial WHERE c_serial_id = @serial");

        if (serialRes.recordset.length === 0) {
            return res.json({ found: false });
        }

        const serialData = serialRes.recordset[0];
        const serialId = serialData.c_id;

        // 2. Find Parent Site (WebMainSub: main_type='S', sub_id=serialId)
        const siteLinkRes = await req.db.request()
            .input('sid', sql.VarChar, serialId)
            .query("SELECT main_id FROM WebMainSub WHERE sub_id = @sid AND main_type = 'S'");

        let siteData = null;
        let groupData = null;

        if (siteLinkRes.recordset.length > 0) {
            const siteId = siteLinkRes.recordset[0].main_id;

            // Get Site Details
            const siteRes = await req.db.request()
                .input('id', sql.VarChar, siteId)
                .query("SELECT * FROM WebSite WHERE c_id = @id");

            if (siteRes.recordset.length > 0) {
                siteData = siteRes.recordset[0];

                // 3. Find Parent Group (WebMainSub: main_type='G', sub_id=siteId)
                const groupLinkRes = await req.db.request()
                    .input('sid', sql.VarChar, siteId)
                    .query("SELECT main_id FROM WebMainSub WHERE sub_id = @sid AND main_type = 'G'");

                if (groupLinkRes.recordset.length > 0) {
                    const groupId = groupLinkRes.recordset[0].main_id;
                    // Get Group Details
                    const groupRes = await req.db.request()
                        .input('id', sql.VarChar, groupId)
                        .query("SELECT * FROM WebGroup WHERE c_id = @id");

                    if (groupRes.recordset.length > 0) {
                        groupData = groupRes.recordset[0];
                    }
                }
            }
        }

        res.json({
            found: true,
            serial: serialData,
            site: siteData,
            group: groupData
        });

    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// --- Auth API ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user by email or username
        const result = await req.db.request()
            .input('email', sql.VarChar, email)
            .query(`
                SELECT u.*, g.c_name as group_name 
                FROM WebUser u
                LEFT JOIN WebGroup g ON u.c_id = g.c_id
                WHERE u.c_email = @email OR u.c_name = @email
            `);

        if (result.recordset.length === 0) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const user = result.recordset[0];

        // Decrypt stored password
        const decryptedPass = Decrypt(user.c_pass);

        if (decryptedPass !== password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        if (user.c_active !== 'Y') {
            return res.status(403).json({ message: "Account is inactive" });
        }

        // Generate Token (Encrypt User ID with base64 encoding for safe transport)
        console.log('[Login] User ID to encrypt:', user.u_id, 'Type:', typeof user.u_id);
        const token = EncryptToken(user.u_id.toString());
        console.log('[Login] Generated token length:', token.length, 'Token (first 50):', token.substring(0, 50));

        // Decrypt Role and strip prefix
        let role = user.c_type;
        try {
            role = Decrypt(user.c_type);
            if (role.startsWith(user.c_email)) {
                role = role.substring(user.c_email.length);
            }
        } catch (e) { }

        console.log('[Login] Sending response with token...');
        res.json({
            success: true,
            token,
            user: {
                id: user.u_id,
                name: user.c_name,
                email: user.c_email,
                role: role,
                group: user.group_name || '-',
                picture: user.c_picture
            }
        });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// ========== SCAN PAGE APIs ==========

// Check Serial Status (No Auth Required)
app.get('/api/scan/check', async (req, res) => {
    const { serial } = req.query;

    if (!serial) {
        return res.status(400).json({ status: 'error', message: 'Serial number is required' });
    }

    try {
        // 1. Check if serial exists in Smartboard (hardware exists)
        const boardResult = await req.db.request()
            .input('serial', sql.VarChar, serial)
            .query('SELECT boardid FROM Smartboard WHERE boardid = @serial');

        if (boardResult.recordset.length === 0) {
            return res.json({
                status: 'not_found',
                message: 'This Serial ID is not in the system'
            });
        }

        // 2. Check if serial is registered in WebSerial
        const webSerialResult = await req.db.request()
            .input('serial', sql.VarChar, serial)
            .query('SELECT c_id FROM WebSerial WHERE c_serial_id = @serial');

        if (webSerialResult.recordset.length === 0) {
            return res.json({
                status: 'available',
                message: 'Serial is ready for registration'
            });
        }

        const serialId = webSerialResult.recordset[0].c_id;

        // 3. Check if serial is linked to any Site
        const linkResult = await req.db.request()
            .input('serialId', sql.VarChar, serialId)
            .query(`
                SELECT ws.c_name as siteName, wg.c_name as groupName 
                FROM WebMainSub wms
                JOIN WebSite ws ON wms.main_id = ws.c_id
                LEFT JOIN WebMainSub wms2 ON ws.c_id = wms2.sub_id AND wms2.sub_type = 'S'
                LEFT JOIN WebGroup wg ON wms2.main_id = wg.c_id
                WHERE wms.sub_id = @serialId AND wms.sub_type = 'I'
            `);

        if (linkResult.recordset.length > 0) {
            return res.json({
                status: 'already_linked',
                message: 'This Serial ID is already installed in the system',
                siteName: linkResult.recordset[0].siteName,
                groupName: linkResult.recordset[0].groupName
            });
        }

        return res.json({
            status: 'available',
            message: 'Serial is ready for registration'
        });

    } catch (err) {
        console.error("Scan Check Error:", err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Register Serial for Logged-in User - Auto-add to first Site
app.post('/api/scan/register', authenticateToken, async (req, res) => {
    const { serial } = req.body;
    const userId = req.user.id;

    if (!serial) {
        return res.status(400).json({ success: false, message: 'Serial number is required' });
    }

    try {
        // Get user's c_id from WebUser
        const userResult = await req.db.request()
            .input('uid', sql.UniqueIdentifier, userId)
            .query("SELECT c_id FROM WebUser WHERE u_id = @uid");

        if (userResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const effectiveId = userResult.recordset[0].c_id;
        console.log(`[SCAN] User c_id: ${effectiveId}`);

        // Check if user is in SuperGroup (c_active = 'Z')
        let isSuperGroup = false;
        const groupCheck = await req.db.request()
            .input('gid', sql.VarChar, effectiveId)
            .query("SELECT c_active, c_name FROM WebGroup WHERE c_id = @gid");

        if (groupCheck.recordset.length > 0 && groupCheck.recordset[0].c_active === 'Z') {
            isSuperGroup = true;
            console.log(`[SCAN] User is SuperGroup`);
        }

        // Find user's first Site
        let siteId = null;
        let siteName = null;
        let groupName = null;
        let groupId = null;

        // Check if user's c_id is a Site
        const idNum = parseInt(effectiveId);
        if (idNum >= 100000000 && idNum < 200000000) {
            siteId = effectiveId;
            const siteInfo = await req.db.request()
                .input('sid', sql.VarChar, siteId)
                .query("SELECT c_name FROM WebSite WHERE c_id = @sid");
            if (siteInfo.recordset.length > 0) {
                siteName = siteInfo.recordset[0].c_name;
            }
            // Find parent group
            const parentGroup = await req.db.request()
                .input('sid', sql.VarChar, siteId)
                .query("SELECT main_id FROM WebMainSub WHERE sub_id = @sid AND sub_type = 'S' AND main_type = 'G'");
            if (parentGroup.recordset.length > 0) {
                groupId = parentGroup.recordset[0].main_id;
            }
        } else if (idNum >= 200000000 && idNum < 300000000) {
            // User is Group level - find first Site
            groupId = effectiveId;
            const groupInfo = await req.db.request()
                .input('gid', sql.VarChar, effectiveId)
                .query("SELECT c_name FROM WebGroup WHERE c_id = @gid");
            if (groupInfo.recordset.length > 0) {
                groupName = groupInfo.recordset[0].c_name;
            }

            const siteResult = await req.db.request()
                .input('gid', sql.VarChar, effectiveId)
                .query("SELECT TOP 1 sub_id FROM WebMainSub WHERE main_id = @gid AND sub_type = 'S'");
            if (siteResult.recordset.length > 0) {
                siteId = siteResult.recordset[0].sub_id;
            }
        }

        // If no site found, create a new one (especially for SuperGroup or new groups)
        if (!siteId && groupId) {
            console.log(`[SCAN] No site found, creating new site for group ${groupId}`);

            // Generate new Site ID
            const newSiteIdRes = await req.db.request()
                .query("SELECT RIGHT('100000000' + CONVERT(VARCHAR, CONVERT(INT, ISNULL(MAX(CAST(c_id AS INT)), 100000000)) + 1), 9) as New_ID FROM WebSite");
            siteId = newSiteIdRes.recordset[0].New_ID;
            siteName = `${groupName || 'Auto'} Site`;

            // Create new site
            await req.db.request()
                .input('id', sql.VarChar, siteId)
                .input('name', sql.NVarChar, siteName)
                .query("INSERT INTO WebSite (c_id, c_name, c_active) VALUES (@id, @name, 'Y')");

            // Link site to group
            await req.db.request()
                .input('gid', sql.VarChar, groupId)
                .input('sid', sql.VarChar, siteId)
                .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@gid, 'G', @sid, 'S')");

            // Create System permission for the new site
            await req.db.request()
                .input('sid', sql.VarChar, siteId)
                .query("INSERT INTO [WebPermission] ([n_site], [c_type], [n_menu], [c_view], [c_insert], [c_update], [c_delete], [c_admin]) SELECT @sid, 'System', [id], '', '', '', '', 'Y' FROM [WebMenu] WHERE used = '1'");

            console.log(`[SCAN] Created new site: ${siteId} - ${siteName}`);
        }

        if (!siteId) {
            return res.status(400).json({ success: false, message: 'No Site found for this user. Please create a site first.' });
        }

        // Get Site name if not already
        if (!siteName) {
            const siteInfo = await req.db.request()
                .input('sid', sql.VarChar, siteId)
                .query("SELECT c_name FROM WebSite WHERE c_id = @sid");
            if (siteInfo.recordset.length > 0) {
                siteName = siteInfo.recordset[0].c_name;
            }
        }

        // Get Group name if not already
        if (!groupName && groupId) {
            const groupResult = await req.db.request()
                .input('gid', sql.VarChar, groupId)
                .query("SELECT c_name FROM WebGroup WHERE c_id = @gid");
            if (groupResult.recordset.length > 0) {
                groupName = groupResult.recordset[0].c_name;
            }
        }

        // Also lookup group from site if still not found
        if (!groupName) {
            const groupResult = await req.db.request()
                .input('sid', sql.VarChar, siteId)
                .query(`
                    SELECT wg.c_name 
                    FROM WebMainSub wms 
                    JOIN WebGroup wg ON wms.main_id = wg.c_id 
                    WHERE wms.sub_id = @sid AND wms.sub_type = 'S'
                `);
            if (groupResult.recordset.length > 0) {
                groupName = groupResult.recordset[0].c_name;
            }
        }

        // Register serial if not exists - MSSQL syntax
        let serialId;
        const webSerialCheck = await req.db.request()
            .input('serial', sql.VarChar, serial)
            .query("SELECT c_id FROM WebSerial WHERE c_serial_id = @serial");

        if (webSerialCheck.recordset.length > 0) {
            serialId = webSerialCheck.recordset[0].c_id;
        } else {
            // Generate new serial ID
            const newSerialIdRes = await req.db.request()
                .query("SELECT FORMAT((SELECT CONVERT(INT, MAX([c_id])) + 1 FROM [WebSerial]), '000000000') as New_ID");
            serialId = newSerialIdRes.recordset[0].New_ID || '000000001';

            // Insert new serial - MSSQL syntax (no ON CONFLICT)
            await req.db.request()
                .input('id', sql.VarChar, serialId)
                .input('serial', sql.VarChar, serial)
                .query("INSERT INTO WebSerial (c_id, c_serial_id, c_name, c_active) VALUES (@id, @serial, @serial, 'Y')");

            console.log(`[SCAN] Created new WebSerial: ${serialId} for ${serial}`);
        }

        // Link serial to site - MSSQL syntax (check before insert)
        const linkCheck = await req.db.request()
            .input('main', sql.VarChar, siteId)
            .input('sub', sql.VarChar, serialId)
            .query("SELECT 1 FROM WebMainSub WHERE main_id = @main AND sub_id = @sub");

        if (linkCheck.recordset.length === 0) {
            await req.db.request()
                .input('main', sql.VarChar, siteId)
                .input('sub', sql.VarChar, serialId)
                .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@main, 'S', @sub, 'I')");
            console.log(`[SCAN] Linked serial ${serialId} to site ${siteId}`);
        }

        // Update Smartboard.Command = GroupId where Active = 'B' AND boardid = SerialID
        if (groupId) {
            try {
                await req.db.request()
                    .input('groupId', sql.VarChar, groupId)
                    .input('serial', sql.VarChar, serial)
                    .query("UPDATE [Smartboard] SET command = @groupId WHERE boardid = @serial AND active = 'B'");
                console.log(`[SCAN] Updated Smartboard command to group ${groupId}`);
            } catch (updateErr) {
                console.error("Smartboard update warning:", updateErr.message);
            }
        }

        res.json({
            success: true,
            message: 'This Serial ID has been successfully added to the system',
            groupName: groupName || 'N/A',
            siteName: siteName || 'N/A'
        });

    } catch (err) {
        console.error("Scan Register Error:", err);
        res.status(500).json({ success: false, message: err.message || 'Internal server error' });
    }
});

// Full Registration (New User + Group + Site + Serial)
app.post('/api/scan/full-register', async (req, res) => {
    const { username, password, groupName, serial } = req.body;

    if (!username || !password || !groupName || !serial) {
        return res.status(400).json({ success: false, message: 'Username, password, group name and serial are required' });
    }

    const transaction = new sql.Transaction(req.db);
    try {
        await transaction.begin();
        console.log(`[FullRegister] Starting registration for user: ${username}, serial: ${serial}`);

        // 1. Validate Serial exists in Smartboard
        const boardResult = await transaction.request()
            .input('serial', sql.VarChar, serial)
            .query('SELECT boardid FROM Smartboard WHERE boardid = @serial');

        if (boardResult.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ success: false, message: 'Serial ID not found in system' });
        }

        // 2. Check if username already exists
        const existingUser = await transaction.request()
            .input('name', sql.VarChar, username)
            .query("SELECT u_id FROM WebUser WHERE c_name = @name OR c_email = @name");

        if (existingUser.recordset.length > 0) {
            await transaction.rollback();
            return res.status(400).json({ success: false, message: 'This username already exists' });
        }

        // 3. Create Group - Inline ID Generation
        // Range: 200,000,000 - 299,999,999
        let groupId;
        const groupMaxRes = await transaction.request()
            .query("SELECT MAX(c_id) as maxId FROM WebGroup WHERE c_id >= '200000000' AND c_id < '300000000'");

        if (groupMaxRes.recordset[0].maxId) {
            groupId = (parseInt(groupMaxRes.recordset[0].maxId) + 1).toString();
        } else {
            groupId = '200000001';
        }

        await transaction.request()
            .input('id', sql.VarChar, groupId)
            .input('name', sql.VarChar, groupName)
            .input('active', sql.VarChar, 'Y')
            .query("INSERT INTO WebGroup (c_id, c_name, c_active) VALUES (@id, @name, @active)");

        console.log(`[FullRegister] Created Group: ${groupId}`);

        // 4. Create Site (same name as Group) - Inline ID Generation
        // Range: 100,000,000 - 199,999,999
        let siteId;
        const siteMaxRes = await transaction.request()
            .query("SELECT MAX(c_id) as maxId FROM WebSite WHERE c_id >= '100000000' AND c_id < '200000000'");

        if (siteMaxRes.recordset[0].maxId) {
            siteId = (parseInt(siteMaxRes.recordset[0].maxId) + 1).toString();
        } else {
            siteId = '100000001';
        }

        await transaction.request()
            .input('id', sql.VarChar, siteId)
            .input('name', sql.VarChar, groupName)
            .input('active', sql.VarChar, 'Y')
            .query("INSERT INTO WebSite (c_id, c_name, c_active) VALUES (@id, @name, @active)");

        console.log(`[FullRegister] Created Site: ${siteId}`);

        // 5. Link Group -> Site
        console.log(`[FullRegister] Linking Group ${groupId} to Site ${siteId}`);
        await transaction.request()
            .input('main', sql.VarChar, groupId)
            .input('sub', sql.VarChar, siteId)
            .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@main, 'G', @sub, 'S')");

        // 6. Create User
        // Use crypto.randomUUID() for uniqueidentifier (UUID) column
        const newUserId = require('crypto').randomUUID();
        const encryptedPass = Encrypt(password);
        console.log(`[FullRegister] Creating User: ${newUserId}, Name: ${username}`);

        await transaction.request()
            .input('uid', sql.UniqueIdentifier, newUserId) // Change type to UniqueIdentifier
            .input('cid', sql.VarChar, groupId) // Link to Group (admin level)
            .input('name', sql.VarChar, username)
            .input('pass', sql.VarChar, encryptedPass)
            .input('type', sql.VarChar, Encrypt('System'))
            .input('active', sql.VarChar, 'Y')
            .query(`INSERT INTO WebUser (u_id, c_id, c_name, c_pass, c_type, c_active, c_email) 
                    VALUES (@uid, @cid, @name, @pass, @type, @active, @name)`);

        console.log(`[FullRegister] Created User: ${newUserId}`);

        // 7. Register Serial
        let serialId;
        console.log(`[FullRegister] Checking if WebSerial ${serial} already exists`);
        const webSerialCheck = await transaction.request()
            .input('serial', sql.VarChar, serial)
            .query('SELECT c_id FROM WebSerial WHERE c_serial_id = @serial');

        if (webSerialCheck.recordset.length > 0) {
            serialId = webSerialCheck.recordset[0].c_id;
            console.log(`[FullRegister] Existing Serial Found: ${serialId}`);
        } else {
            // Inline Serial ID Generation
            // Range: 000000001 - 099999999
            console.log(`[FullRegister] Generating new Serial ID`);
            const serialMaxRes = await transaction.request()
                .query("SELECT MAX(c_id) as maxId FROM WebSerial WHERE c_id < '100000000'");

            if (serialMaxRes.recordset[0].maxId) {
                serialId = (parseInt(serialMaxRes.recordset[0].maxId) + 1).toString().padStart(9, '0');
            } else {
                serialId = '000000001';
            }

            console.log(`[FullRegister] Creating Serial: ${serialId}`);
            await transaction.request()
                .input('id', sql.VarChar, serialId)
                .input('serial', sql.VarChar, serial)
                .query("INSERT INTO WebSerial (c_id, c_serial_id, c_name, c_active) VALUES (@id, @serial, @serial, 'Y')");

            console.log(`[FullRegister] Created Serial: ${serialId}`);
        }

        // 8. Link Site -> Serial
        console.log(`[FullRegister] Linking Site ${siteId} to Serial ${serialId}`);
        await transaction.request()
            .input('main', sql.VarChar, siteId)
            .input('sub', sql.VarChar, serialId)
            .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@main, 'S', @sub, 'I')");

        // 8.1 Update Smartboard.Command = GroupName where Active = 'B' AND boardid = SerialID
        try {
            console.log(`[FullRegister] Updating Smartboard command`);
            await transaction.request()
                .input('groupName', sql.NVarChar, groupName)
                .input('serial', sql.VarChar, serial)
                .query("UPDATE [dbo].[Smartboard] SET command = @groupName WHERE boardid = @serial AND active = 'B'");
        } catch (updateErr) {
            console.error("Smartboard update warning:", updateErr.message);
            // Don't fail the whole operation if Smartboard update fails
        }

        // 9. Add System Permission (c_admin = 'Y' for all menus)
        console.log(`[FullRegister] Adding System Permissions for Site ${siteId}`);
        await transaction.request()
            .input('sid', sql.VarChar, siteId)
            .query("INSERT INTO [WebPermission] ([n_site], [c_type], [n_menu], [c_view], [c_insert], [c_update], [c_delete], [c_admin]) SELECT @sid, 'System', [id], '', '', '', '', 'Y' FROM [WebMenu] WHERE used = '1'");

        // 9.1 Add System Permission for Group
        console.log(`[FullRegister] Adding System Permissions for Group ${groupId}`);
        await transaction.request()
            .input('gid', sql.VarChar, groupId)
            .query("INSERT INTO [WebPermission] ([n_site], [c_type], [n_menu], [c_view], [c_insert], [c_update], [c_delete], [c_admin]) SELECT @gid, 'System', [id], '', '', '', '', 'Y' FROM [WebMenu] WHERE used = '1'");

        await transaction.commit();
        console.log(`[FullRegister] Transaction Committed Successfully`);

        // Auto Login - Generate Token (USE EncryptToken for invalid char safety)
        const token = EncryptToken(newUserId);

        res.json({
            success: true,
            message: 'Registration successful!',
            token,
            user: {
                id: newUserId,
                name: username,
                email: username,
                type: 'System'
            },
            groupName,
            siteName: groupName
        });

    } catch (err) {
        console.error("Full Register Error (Original):", err);
        try {
            await transaction.rollback();
            console.log("Full Register: Transaction rolled back successfully");
        } catch (rollbackErr) {
            console.error("Full Register: Transaction rollback failed (expected if aborted):", rollbackErr.message);
        }
        res.status(500).json({ success: false, message: 'Internal server error: ' + err.message });
    }
});

// ========== END SCAN PAGE APIs ==========

// 1. Register Device (Logged In User) - LEGACY
app.post('/api/devices/register', authenticateToken, async (req, res) => {
    const { serial } = req.body;
    const userId = req.user.id; // u_id from token

    if (!serial) return res.status(400).json({ message: "Serial number is required" });

    try {
        // Get user's c_id from WebUser
        const userResult = await req.db.request()
            .input('uid', sql.VarChar, userId)
            .query("SELECT c_id FROM WebUser WHERE u_id = @uid");

        let effectiveId = userId;
        if (userResult.recordset.length > 0) {
            effectiveId = userResult.recordset[0].c_id;
        }

        // 1. Check if serial exists in Smartboard table
        const boardResult = await req.db.request().query(`SELECT boardid, active, command FROM Smartboard WHERE boardid = '${serial}'`);
        if (boardResult.recordset.length === 0) {
            return res.status(404).json({ message: "Serial number not found in system." });
        }

        // 2. Check if already registered in WebSerial
        const webSerialResult = await req.db.request().query(`SELECT c_id FROM WebSerial WHERE c_serial_id = '${serial}'`);
        let serialId;

        if (webSerialResult.recordset.length > 0) {
            serialId = webSerialResult.recordset[0].c_id;
        } else {
            // Register into WebSerial
            serialId = await generateId('serial');
            await req.db.request().query(`
                INSERT INTO WebSerial (c_id, c_serial_id, c_name, c_active)
                VALUES ('${serialId}', '${serial}', '${serial}', 'Y')
            `);
        }

        // 3. Find a Site to link the serial to
        let parentId = null;

        // Check if user is Super Group (c_active = 'Z')
        const superGroupCheck = await req.db.request()
            .input('gid', sql.VarChar, effectiveId)
            .query("SELECT c_active FROM WebGroup WHERE c_id = @gid AND c_active = 'Z'");

        const isSuperGroup = superGroupCheck.recordset.length > 0;

        // Check user level based on c_id range
        const idNum = parseInt(effectiveId);

        if (idNum >= 200000000 && idNum < 300000000) {
            // Group Level - Find a site under this group
            const siteResult = await req.db.request().query(`SELECT sub_id FROM WebMainSub WHERE main_id = '${effectiveId}' AND sub_type = 'S'`);
            if (siteResult.recordset.length > 0) {
                parentId = siteResult.recordset[0].sub_id;
            }
        } else if (idNum >= 100000000 && idNum < 200000000) {
            // Site Level - Use this site directly
            parentId = effectiveId;
        }

        // If no site found yet, try to find from user's permissions
        if (!parentId) {
            // Try to find any Site the user has access to via WebPermission
            const permResult = await req.db.request()
                .input('uid', sql.VarChar, effectiveId)
                .query(`
                    SELECT TOP 1 ws.c_id 
                    FROM WebPermission wp 
                    JOIN WebSite ws ON wp.c_id = ws.c_id 
                    WHERE wp.u_id = @uid AND ws.c_active = 'Y'
                `);

            if (permResult.recordset.length > 0) {
                parentId = permResult.recordset[0].c_id;
            }
        }

        // If still no site and user is Super Group, create a default link or just allow
        if (!parentId && isSuperGroup) {
            // Super Group can add to any site - find the first active site
            const anySiteResult = await req.db.request().query(`SELECT TOP 1 c_id FROM WebSite WHERE c_active = 'Y'`);
            if (anySiteResult.recordset.length > 0) {
                parentId = anySiteResult.recordset[0].c_id;
            }
        }

        // If still no site found, return error
        if (!parentId) {
            return res.status(400).json({ message: "No Site found to link the device. Please contact administrator." });
        }

        // Link in WebMainSub
        const linkCheck = await req.db.request().query(`SELECT * FROM WebMainSub WHERE main_id = '${parentId}' AND sub_id = '${serialId}'`);
        if (linkCheck.recordset.length === 0) {
            await req.db.request().query(`
                INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type)
                VALUES ('${parentId}', 'S', '${serialId}', 'I')
            `);
        }

        res.json({ message: "Device registered successfully", serialId });

    } catch (err) {
        console.error("Registration Error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// 2. Quick Register (New User + Device)
app.post('/api/auth/quick-register', async (req, res) => {
    const { username, password, serial } = req.body;

    if (!username || !password || !serial) {
        return res.status(400).json({ message: "Username, password, and serial are required" });
    }

    const transaction = new sql.Transaction(req.db);
    try {
        await transaction.begin();

        // 1. Validate Serial
        const boardResult = await transaction.request()
            .input('serial', sql.VarChar, serial)
            .query('SELECT boardid FROM Smartboard WHERE boardid = @serial');

        if (boardResult.recordset.length === 0) {
            throw new Error("Invalid Serial Number");
        }

        // 2. Create Group
        const groupId = await generateId('group');
        await transaction.request()
            .input('id', sql.VarChar, groupId)
            .input('name', sql.VarChar, username)
            .query("INSERT INTO WebGroup (c_id, c_name) VALUES (@id, @name)");

        // 3. Create Site
        const siteId = await generateId('site');
        await transaction.request()
            .input('id', sql.VarChar, siteId)
            .input('name', sql.VarChar, username)
            .query("INSERT INTO WebSite (c_id, c_name) VALUES (@id, @name)");

        // Link Group -> Site
        await transaction.request()
            .input('main', sql.VarChar, groupId)
            .input('sub', sql.VarChar, siteId)
            .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@main, 'G', @sub, 'S')");

        // 4. Create User (Linked to Site)
        // Generate a random u_id (assuming it's varchar)
        const newUserId = Math.floor(Math.random() * 1000000000).toString();
        const encryptedPass = Encrypt(password);

        await transaction.request()
            .input('uid', sql.VarChar, newUserId)
            .input('cid', sql.VarChar, siteId) // Link to Site
            .input('name', sql.VarChar, username)
            .input('pass', sql.VarChar, encryptedPass)
            .input('type', sql.VarChar, Encrypt(username + 'Admin'))
            .input('active', sql.VarChar, 'Y')
            .query(`INSERT INTO WebUser (u_id, c_id, c_name, c_pass, c_type, c_active, c_email) 
                    VALUES (@uid, @cid, @name, @pass, @type, @active, @name)`);

        // 5. Register/Link Serial
        const webSerialCheck = await transaction.request()
            .input('serial', sql.VarChar, serial)
            .query('SELECT c_id FROM WebSerial WHERE c_serial_id = @serial');

        let serialId;
        if (webSerialCheck.recordset.length > 0) {
            serialId = webSerialCheck.recordset[0].c_id;
        } else {
            serialId = await generateId('serial');
            await transaction.request()
                .input('id', sql.VarChar, serialId)
                .input('serial', sql.VarChar, serial)
                .query("INSERT INTO WebSerial (c_id, c_serial_id, c_name, c_active) VALUES (@id, @serial, @serial, 'Y')");
        }

        // Link Site -> Serial
        await transaction.request()
            .input('main', sql.VarChar, siteId)
            .input('sub', sql.VarChar, serialId)
            .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@main, 'S', @sub, 'I')");

        await transaction.commit();

        // Return Token (Auto Login)
        // We use the User's u_id for the token, but we return the siteId as the "user id" for the frontend context?
        // Wait, api/login returns `id: user.u_id`.
        // So we should use `newUserId`.
        const token = Encrypt(newUserId);

        res.json({
            message: "Registration successful",
            token,
            user: {
                id: newUserId,
                name: username,
                email: username,
                type: 'Admin'
            }
        });

    } catch (err) {
        await transaction.rollback();
        res.status(500).send(err.message);
    }
});

app.get('/api/custom-views', authenticateToken, async (req, res) => {
    try {
        // Get current user info
        const userId = req.user.id;
        const userRes = await req.db.request()
            .input('uid', sql.VarChar, userId)
            .query("SELECT c_id FROM WebUser WHERE u_id = @uid");

        const userGroupId = userRes.recordset[0]?.c_id || null;

        // Find user's group hierarchy (group they belong to)
        let parentGroupId = null;
        if (userGroupId && userGroupId.startsWith('1')) {
            // Site level - find parent group
            const hierarchyRes = await req.db.request()
                .input('siteId', sql.VarChar, userGroupId)
                .query("SELECT main_id FROM WebMainSub WHERE sub_id = @siteId AND main_type = 'G'");
            parentGroupId = hierarchyRes.recordset[0]?.main_id || null;
        } else if (userGroupId && userGroupId.startsWith('2')) {
            // Already group level
            parentGroupId = userGroupId;
        }

        // Get views the user can access:
        // 1. Views created by this user
        // 2. Views with same group_id as user
        // 3. Views in same group hierarchy
        const result = await req.db.request()
            .input('userId', sql.VarChar, userId)
            .input('userGroupId', sql.VarChar, userGroupId)
            .input('parentGroupId', sql.VarChar, parentGroupId)
            .query(`
                SELECT id, name, updated_at, creator_name,
                       ISNULL(exported_to_menu, 0) as exported_to_menu,
                       created_by, group_id
                FROM CustomViews 
                WHERE created_by = @userId 
                   OR group_id = @userGroupId
                   OR group_id = @parentGroupId
                   OR group_id IN (SELECT sub_id FROM WebMainSub WHERE main_id = @parentGroupId)
                ORDER BY updated_at DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.get('/api/custom-views/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await req.db.request().query(`SELECT * FROM CustomViews WHERE id = ${id}`);
        if (result.recordset.length === 0) return res.status(404).send('View not found');

        const view = result.recordset[0];
        // Parse config if it's a string
        if (view.config) {
            try {
                const config = JSON.parse(view.config);
                view.nodes = config.nodes || [];
                view.edges = config.edges || [];
                view.defaultEdgeStyle = config.defaultEdgeStyle || {};
                view.defaultBoxStyle = config.defaultBoxStyle || {};
                view.defaultMeterStyle = config.defaultMeterStyle || {};
                view.defaultImageStyle = config.defaultImageStyle || {};
                view.defaultCarbonCreditStyle = config.defaultCarbonCreditStyle || {};
                view.defaultCarbonTrendStyle = config.defaultCarbonTrendStyle || {};
                view.defaultAnalysisStyle = config.defaultAnalysisStyle || {};
            } catch (e) {
                console.error("Error parsing view config", e);
                view.nodes = [];
                view.edges = [];
            }
        }
        res.json(view);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.post('/api/custom-views', authenticateToken, async (req, res) => {
    console.log("HIT POST /api/custom-views");
    try {
        const { name, nodes, edges, defaultEdgeStyle, defaultBoxStyle, defaultMeterStyle, defaultImageStyle, defaultCarbonCreditStyle, defaultCarbonTrendStyle, defaultAnalysisStyle } = req.body;
        const config = JSON.stringify({ nodes, edges, defaultEdgeStyle, defaultBoxStyle, defaultMeterStyle, defaultImageStyle, defaultCarbonCreditStyle, defaultCarbonTrendStyle, defaultAnalysisStyle });

        // Get user info for ownership
        const userId = req.user.id;
        const userRes = await req.db.request()
            .input('uid', sql.VarChar, userId)
            .query("SELECT c_id, c_name FROM WebUser WHERE u_id = @uid");

        const groupId = userRes.recordset[0]?.c_id || null;
        const creatorName = userRes.recordset[0]?.c_name || 'Unknown';

        // Check if user is Super Group
        let isSuperGroup = false;
        if (groupId) {
            const groupRes = await req.db.request()
                .input('gid', sql.VarChar, groupId)
                .query("SELECT c_active FROM WebGroup WHERE c_id = @gid AND c_active = 'Z'");
            isSuperGroup = groupRes.recordset.length > 0;
        }

        const result = await req.db.request()
            .input('name', sql.NVarChar, name)
            .input('config', sql.NVarChar(sql.MAX), config)
            .input('created_by', sql.VarChar, userId)
            .input('group_id', sql.VarChar, groupId)
            .input('creator_name', sql.NVarChar, creatorName)
            .input('is_super_group', sql.Bit, isSuperGroup ? 1 : 0)
            .query(`
                INSERT INTO CustomViews (name, config, created_by, group_id, creator_name, is_super_group) 
                OUTPUT INSERTED.id
                VALUES (@name, @config, @created_by, @group_id, @creator_name, @is_super_group)
            `);

        res.json({ id: result.recordset[0].id, success: true });
    } catch (err) {
        console.error("Error saving view:", err);
        res.status(500).send(err.message);
    }
});

app.put('/api/custom-views/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, nodes, edges, defaultEdgeStyle, defaultBoxStyle, defaultMeterStyle, defaultImageStyle, defaultCarbonCreditStyle, defaultCarbonTrendStyle, defaultAnalysisStyle } = req.body;
        const config = JSON.stringify({ nodes, edges, defaultEdgeStyle, defaultBoxStyle, defaultMeterStyle, defaultImageStyle, defaultCarbonCreditStyle, defaultCarbonTrendStyle, defaultAnalysisStyle });

        await req.db.request()
            .input('id', sql.Int, id)
            .input('name', sql.NVarChar, name)
            .input('config', sql.NVarChar(sql.MAX), config)
            .query(`
                UPDATE CustomViews 
                SET name = @name, config = @config, updated_at = GETDATE()
                WHERE id = @id
            `);

        res.json({ success: true });
    } catch (err) {
        console.error("Error updating view:", err);
        res.status(500).send(err.message);
    }
});

app.delete('/api/custom-views/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // First, clean up WebMenu if this view was exported
        await req.db.request()
            .input('viewId', sql.VarChar, id.toString())
            .query("DELETE FROM WebMenu WHERE parent = @viewId");

        // Also clean up related WebPermission entries
        const menuResult = await req.db.request()
            .input('viewId', sql.VarChar, id.toString())
            .query("SELECT id FROM WebMenu WHERE parent = @viewId");

        if (menuResult.recordset.length > 0) {
            const menuId = menuResult.recordset[0].id;
            await req.db.request()
                .input('menuId', sql.Int, menuId)
                .query("DELETE FROM WebPermission WHERE n_menu = @menuId");
        }

        // Delete the view itself
        await req.db.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM CustomViews WHERE id = @id');

        res.json({ success: true });
    } catch (err) {
        console.error("Error deleting view:", err);
        res.status(500).send(err.message);
    }
});

// Export Custom View to Menu
app.post('/api/custom-views/:id/export', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Get user info
        const userRes = await req.db.request()
            .input('uid', sql.VarChar, userId)
            .query("SELECT c_id, c_name FROM WebUser WHERE u_id = @uid");

        const userGroupId = userRes.recordset[0]?.c_id || null;

        // Check if Super Group
        let isSuperGroup = false;
        if (userGroupId) {
            const groupRes = await req.db.request()
                .input('gid', sql.VarChar, userGroupId)
                .query("SELECT c_active FROM WebGroup WHERE c_id = @gid AND c_active = 'Z'");
            isSuperGroup = groupRes.recordset.length > 0;
        }

        // Get view details
        const viewResult = await req.db.request()
            .input('id', sql.Int, id)
            .query("SELECT id, name FROM CustomViews WHERE id = @id");

        if (viewResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: "View not found" });
        }

        const view = viewResult.recordset[0];

        // Check if already exported
        const existingMenu = await req.db.request()
            .input('viewId', sql.VarChar, id.toString())
            .query("SELECT id FROM WebMenu WHERE parent = @viewId");

        if (existingMenu.recordset.length > 0) {
            return res.json({ success: true, message: "Already exported", menuId: existingMenu.recordset[0].id });
        }

        // Get max menu id
        const maxIdResult = await req.db.request()
            .query("SELECT MAX(id) as maxId FROM WebMenu");
        const newMenuId = (maxIdResult.recordset[0].maxId || 100) + 1;

        // Get max treeid for exported views (start at 100+)
        const maxTreeResult = await req.db.request()
            .query("SELECT MAX(treeid) as maxTreeId FROM WebMenu WHERE treeid >= 100");
        const newTreeId = (maxTreeResult.recordset[0].maxTreeId || 99) + 1;

        // Insert into WebMenu (parent stores the custom view id)
        await req.db.request()
            .input('menuId', sql.Decimal, newMenuId)
            .input('treeid', sql.Decimal, newTreeId)
            .input('parent', sql.VarChar, id.toString())
            .input('name', sql.VarChar, view.name)
            .input('aspx', sql.VarChar, `SavedView/${id}`)
            .input('icon', sql.VarChar, 'fa-eye')
            .input('used', sql.VarChar, '1')
            .query(`
                INSERT INTO WebMenu (id, treeid, parent, name, aspx, icon, used)
                VALUES (@menuId, @treeid, @parent, @name, @aspx, @icon, @used)
            `);

        // Add WebPermission entries
        if (isSuperGroup) {
            // Super Group: Add permissions to ALL groups
            const allGroups = await req.db.request()
                .query("SELECT DISTINCT c_id FROM WebGroup WHERE c_active IN ('Y', 'Z')");

            for (const group of allGroups.recordset) {
                // Get all permission types for this group
                const permTypes = await req.db.request()
                    .input('groupId', sql.VarChar, group.c_id)
                    .query("SELECT DISTINCT c_type FROM WebPermission WHERE n_site IN (SELECT sub_id FROM WebMainSub WHERE main_id = @groupId) OR n_site = @groupId");

                // Get all sites in this group
                const sites = await req.db.request()
                    .input('groupId', sql.VarChar, group.c_id)
                    .query("SELECT DISTINCT sub_id FROM WebMainSub WHERE main_id = @groupId AND sub_type = 'S'");

                const siteIds = sites.recordset.map(s => s.sub_id);
                siteIds.push(group.c_id); // Include group itself

                for (const siteId of siteIds) {
                    // Get permission types for this site
                    const sitePermTypes = await req.db.request()
                        .input('siteId', sql.VarChar, siteId)
                        .query("SELECT DISTINCT c_type FROM WebPermission WHERE n_site = @siteId");

                    for (const perm of sitePermTypes.recordset) {
                        // Check if permission already exists
                        const existsPerm = await req.db.request()
                            .input('site', sql.VarChar, siteId)
                            .input('type', sql.VarChar, perm.c_type)
                            .input('menu', sql.Int, newMenuId)
                            .query("SELECT COUNT(*) as cnt FROM WebPermission WHERE n_site = @site AND c_type = @type AND n_menu = @menu");

                        if (existsPerm.recordset[0].cnt === 0) {
                            await req.db.request()
                                .input('site', sql.VarChar, siteId)
                                .input('type', sql.VarChar, perm.c_type)
                                .input('menu', sql.Int, newMenuId)
                                .query(`
                                    INSERT INTO WebPermission (n_site, c_type, n_menu, c_view, c_insert, c_update, c_delete, c_admin)
                                    VALUES (@site, @type, @menu, 'Y', 'N', 'N', 'N', 'N')
                                `);
                        }
                    }
                }
            }
        } else {
            // Regular user: Add permissions only to own group
            let targetGroupId = userGroupId;

            // If user is Site level, find parent group
            if (userGroupId && userGroupId.startsWith('1')) {
                const parentRes = await req.db.request()
                    .input('siteId', sql.VarChar, userGroupId)
                    .query("SELECT main_id FROM WebMainSub WHERE sub_id = @siteId AND main_type = 'G'");
                targetGroupId = parentRes.recordset[0]?.main_id || userGroupId;
            }

            // Get all sites in this group
            const sites = await req.db.request()
                .input('groupId', sql.VarChar, targetGroupId)
                .query("SELECT DISTINCT sub_id FROM WebMainSub WHERE main_id = @groupId AND sub_type = 'S'");

            const siteIds = sites.recordset.map(s => s.sub_id);
            siteIds.push(targetGroupId); // Include group itself

            for (const siteId of siteIds) {
                // Get permission types for this site
                const sitePermTypes = await req.db.request()
                    .input('siteId', sql.VarChar, siteId)
                    .query("SELECT DISTINCT c_type FROM WebPermission WHERE n_site = @siteId");

                for (const perm of sitePermTypes.recordset) {
                    // Check if permission already exists
                    const existsPerm = await req.db.request()
                        .input('site', sql.VarChar, siteId)
                        .input('type', sql.VarChar, perm.c_type)
                        .input('menu', sql.Int, newMenuId)
                        .query("SELECT COUNT(*) as cnt FROM WebPermission WHERE n_site = @site AND c_type = @type AND n_menu = @menu");

                    if (existsPerm.recordset[0].cnt === 0) {
                        await req.db.request()
                            .input('site', sql.VarChar, siteId)
                            .input('type', sql.VarChar, perm.c_type)
                            .input('menu', sql.Int, newMenuId)
                            .query(`
                                INSERT INTO WebPermission (n_site, c_type, n_menu, c_view, c_insert, c_update, c_delete, c_admin)
                                VALUES (@site, @type, @menu, 'Y', 'N', 'N', 'N', 'N')
                            `);
                    }
                }
            }
        }

        // Update CustomViews to mark as exported
        await req.db.request()
            .input('id', sql.Int, id)
            .query("UPDATE CustomViews SET exported_to_menu = 1 WHERE id = @id");

        res.json({ success: true, menuId: newMenuId, treeid: newTreeId });
    } catch (err) {
        console.error("Error exporting view:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Unexport Custom View from Menu
app.post('/api/custom-views/:id/unexport', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Get menu id first for permission cleanup
        const menuResult = await req.db.request()
            .input('viewId', sql.VarChar, id.toString())
            .query("SELECT id FROM WebMenu WHERE parent = @viewId");

        if (menuResult.recordset.length > 0) {
            const menuId = menuResult.recordset[0].id;

            // Delete related permissions
            await req.db.request()
                .input('menuId', sql.Int, menuId)
                .query("DELETE FROM WebPermission WHERE n_menu = @menuId");
        }

        // Delete from WebMenu
        await req.db.request()
            .input('viewId', sql.VarChar, id.toString())
            .query("DELETE FROM WebMenu WHERE parent = @viewId");

        // Update CustomViews to mark as not exported
        await req.db.request()
            .input('id', sql.Int, id)
            .query("UPDATE CustomViews SET exported_to_menu = 0 WHERE id = @id");

        res.json({ success: true });
    } catch (err) {
        console.error("Error unexporting view:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get Custom View for public display (read-only)
app.get('/api/custom-views/:id/public', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await req.db.request()
            .input('id', sql.Int, id)
            .query("SELECT * FROM CustomViews WHERE id = @id");

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'View not found' });
        }

        const view = result.recordset[0];
        if (view.config) {
            try {
                const config = JSON.parse(view.config);
                view.nodes = config.nodes || [];
                view.edges = config.edges || [];
                view.defaultEdgeStyle = config.defaultEdgeStyle || {};
                view.defaultBoxStyle = config.defaultBoxStyle || {};
                view.defaultMeterStyle = config.defaultMeterStyle || {};
                view.defaultImageStyle = config.defaultImageStyle || {};
                view.defaultCarbonCreditStyle = config.defaultCarbonCreditStyle || {};
                view.defaultCarbonTrendStyle = config.defaultCarbonTrendStyle || {};
                view.defaultAnalysisStyle = config.defaultAnalysisStyle || {};
            } catch (e) {
                view.nodes = [];
                view.edges = [];
            }
        }
        res.json(view);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});



// --- Carbon Credit API (Group-Specific) ---

// Helper function to get user's group ID
async function getUserGroupId(db, userId) {
    const userRes = await db.request()
        .input('u_id', sql.UniqueIdentifier, userId)
        .query("SELECT c_id FROM WebUser WHERE u_id = @u_id");

    if (userRes.recordset.length === 0) {
        return null;
    }
    return userRes.recordset[0].c_id;
}

// --- Carbon Credit API ---
app.get('/api/carbon-credit/config', requirePermission(40), async (req, res) => {
    try {
        const { groupId } = req.userContext; // Use userContext from middleware
        // const userId = req.user.id;
        // const groupId = await getUserGroupId(req.db, userId);

        if (!groupId) {
            return res.status(404).send('User group not found');
        }

        // Note: CarbonCreditConfig table already created during PostgreSQL migration

        // Get config for this group
        const result = await req.db.request()
            .input('groupId', sql.NVarChar, groupId)
            .query("SELECT config_data FROM carboncreditconfig WHERE group_id = @groupId ORDER BY id DESC LIMIT 1");

        if (result.recordset.length > 0) {
            res.json(JSON.parse(result.recordset[0].config_data));
        } else {
            res.json({ meters: [], emissionFactor: 0.5 }); // Default - empty for new groups
        }
    } catch (err) {
        console.error('Carbon Credit Config GET Error:', err);
        res.status(500).send(err.message);
    }
});

app.post('/api/carbon-credit/config', requirePermission(40), async (req, res) => {
    try {
        const { groupId } = req.userContext;
        // const userId = req.user.id;
        // const groupId = await getUserGroupId(req.db, userId);

        if (!groupId) {
            return res.status(404).send('User group not found');
        }

        const config = req.body;
        const configStr = JSON.stringify(config);
        const safeConfig = configStr.replace(/'/g, "''");

        // Check if config exists for this group
        const existing = await req.db.request()
            .input('groupId', sql.NVarChar, groupId)
            .query("SELECT id FROM CarbonCreditConfig WHERE group_id = @groupId");

        if (existing.recordset.length > 0) {
            // Update existing
            await req.db.request()
                .input('groupId', sql.NVarChar, groupId)
                .input('config', sql.NVarChar, safeConfig)
                .query(`UPDATE CarbonCreditConfig SET config_data = @config, updated_at = GETDATE() WHERE group_id = @groupId`);
        } else {
            // Insert new
            await req.db.request()
                .input('groupId', sql.NVarChar, groupId)
                .input('config', sql.NVarChar, safeConfig)
                .query(`INSERT INTO CarbonCreditConfig (group_id, config_data) VALUES (@groupId, @config)`);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Carbon Credit Config POST Error:', err);
        res.status(500).send(err.message);
    }
});

app.get('/api/carbon-credit/data', requirePermission(40), async (req, res) => {
    try {
        const { groupId } = req.userContext;

        if (!groupId) {
            return res.status(404).send('User group not found');
        }

        const { timeRange, date } = req.query;
        const targetDate = date ? `'${date}'` : 'GETDATE()';

        // Get Config for this group
        const configRes = await req.db.request()
            .input('groupId', sql.NVarChar, groupId)
            .query("SELECT TOP 1 config_data FROM CarbonCreditConfig WHERE group_id = @groupId ORDER BY id DESC");

        let config = { meters: [], emissionFactor: 0.5 };
        if (configRes.recordset.length > 0) {
            config = JSON.parse(configRes.recordset[0].config_data);
        }

        if (!config.meters || config.meters.length === 0) {
            return res.json([]);
        }

        const meterIds = config.meters.join(',');

        // Determine Date Range and Grouping
        let dateFilter = "";
        let groupBy = "";
        let dateFormat = "";

        if (timeRange === 'day') {
            dateFilter = `DATEDIFF(day, dt_job_time, ${targetDate}) = 0`;
            groupBy = "DATEPART(hour, dt_job_time)";
            dateFormat = "format(dt_job_time, 'HH:00')";
        } else if (timeRange === 'week') {
            dateFilter = `DATEDIFF(week, dt_job_time, ${targetDate}) = 0`;
            groupBy = "CAST(dt_job_time AS DATE)";
            dateFormat = "format(dt_job_time, 'dd/MM')";
        } else if (timeRange === 'month') {
            dateFilter = `DATEDIFF(month, dt_job_time, ${targetDate}) = 0`;
            groupBy = "CAST(dt_job_time AS DATE)";
            dateFormat = "format(dt_job_time, 'dd/MM')";
        } else if (timeRange === 'year') {
            dateFilter = `DATEDIFF(year, dt_job_time, ${targetDate}) = 0`;
            groupBy = "DATEPART(month, dt_job_time)";
            dateFormat = "format(dt_job_time, 'MMM')";
        } else {
            dateFilter = `DATEDIFF(day, dt_job_time, ${targetDate}) = 0`;
            groupBy = "DATEPART(hour, dt_job_time)";
            dateFormat = "format(dt_job_time, 'HH:00')";
        }

        const query = `
            SELECT 
                ${dateFormat} as time,
                SUM(n_val) as energy,
                SUM(n_val) * ${config.emissionFactor} as carbon
            FROM dbo.ColQuartery
            WHERE n_production IN (${meterIds}) 
            AND n_column = 35 
            AND ${dateFilter}
            GROUP BY ${groupBy}, ${dateFormat}
            ORDER BY ${groupBy}
        `;

        const result = await req.db.request().query(query);
        res.json(result.recordset);

    } catch (err) {
        console.error('Carbon Credit Data Error:', err);
        res.status(500).send(err.message);
    }
});


// --- Dashboard Config API (Group-Specific) ---
app.get('/api/dashboard/config', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const groupId = await getUserGroupId(req.db, userId);

        if (!groupId) {
            return res.status(404).send('User not found');
        }

        // Note: DashboardConfig table already created during PostgreSQL migration

        // Get config for this group
        const result = await req.db.request()
            .input('groupId', sql.NVarChar, groupId)
            .query("SELECT cost_rate, currency FROM DashboardConfig WHERE group_id = @groupId");

        if (result.recordset.length > 0) {
            res.json({
                costRate: parseFloat(result.recordset[0].cost_rate) || 4.5,
                currency: result.recordset[0].currency || 'THB'
            });
        } else {
            // Return default values
            res.json({ costRate: 4.5, currency: 'THB' });
        }
    } catch (err) {
        console.error('Dashboard Config GET Error:', err);
        res.status(500).send(err.message);
    }
});

app.put('/api/dashboard/config', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const groupId = await getUserGroupId(req.db, userId);

        if (!groupId) {
            return res.status(404).send('User not found');
        }

        const { costRate, currency } = req.body;
        const rate = parseFloat(costRate) || 4.5;
        const curr = currency || 'THB';

        // Note: DashboardConfig table already created during PostgreSQL migration

        // Check if config exists for this group
        const existing = await req.db.request()
            .input('groupId', sql.NVarChar, groupId)
            .query("SELECT id FROM DashboardConfig WHERE group_id = @groupId");

        if (existing.recordset.length > 0) {
            // Update existing
            await req.db.request()
                .input('groupId', sql.NVarChar, groupId)
                .input('costRate', sql.Decimal(10, 4), rate)
                .input('currency', sql.NVarChar, curr)
                .query(`UPDATE DashboardConfig SET cost_rate = @costRate, currency = @currency, updated_at = GETDATE() WHERE group_id = @groupId`);
        } else {
            // Insert new
            await req.db.request()
                .input('groupId', sql.NVarChar, groupId)
                .input('costRate', sql.Decimal(10, 4), rate)
                .input('currency', sql.NVarChar, curr)
                .query(`INSERT INTO DashboardConfig (group_id, cost_rate, currency) VALUES (@groupId, @costRate, @currency)`);
        }

        res.json({ success: true, costRate: rate, currency: curr });
    } catch (err) {
        console.error('Dashboard Config PUT Error:', err);
        res.status(500).send(err.message);
    }
});


// --- Settings Hierarchy API ---

// 1. Groups - with permission filtering
app.get('/api/settings/groups', requirePermission(34), async (req, res) => {
    try {
        const { groupId, isSuperGroup } = req.userContext;
        console.log(`[DEBUG] GET /api/settings/groups - Super: ${isSuperGroup}, GroupID: ${groupId}`);

        let sqlQuery = "SELECT * FROM WebGroup";
        if (!isSuperGroup) {
            sqlQuery += " WHERE c_id = @groupId";
        }
        sqlQuery += " ORDER BY c_id";

        const request = req.db.request();
        if (!isSuperGroup) {
            request.input('groupId', sql.VarChar, groupId);
        }

        console.log(`[DEBUG] Settings Group Query: ${sqlQuery}`);
        const result = await request.query(sqlQuery);
        console.log(`[DEBUG] Settings Groups Found: ${result.recordset.length}`);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});


app.post('/api/settings/groups', requirePermission(34), async (req, res) => {
    try {
        const { userLevel, isSuperGroup } = req.userContext;
        if (!isSuperGroup && userLevel === 'SITE') {
            return res.status(403).send('Access Denied: Site Users cannot create groups');
        }

        const { name, active } = req.body;
        const id = await generateId('group');
        await req.db.request()
            .input('id', sql.VarChar, id)
            .input('name', sql.VarChar, name)
            .input('active', sql.VarChar, active ? 'Y' : 'N')
            .query("INSERT INTO WebGroup (c_id, c_name, c_active) VALUES (@id, @name, @active)");
        res.json({ success: true, id });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.put('/api/settings/groups/:id', requirePermission(34), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, active } = req.body;
        await req.db.request()
            .input('id', sql.VarChar, id)
            .input('name', sql.VarChar, name)
            .input('active', sql.VarChar, active ? 'Y' : 'N')
            .query("UPDATE WebGroup SET c_name = @name, c_active = @active WHERE c_id = @id");
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.delete('/api/settings/groups/:id', requirePermission(34), async (req, res) => {
    try {
        const { id } = req.params;
        // Delete links first
        await req.db.request().input('id', sql.VarChar, id).query("DELETE FROM WebMainSub WHERE main_id = @id");
        await req.db.request().input('id', sql.VarChar, id).query("DELETE FROM WebGroup WHERE c_id = @id");
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// 2. Sites (Linked to Group)
app.get('/api/settings/groups/:groupId/sites', requirePermission(34), async (req, res) => {
    try {
        const { groupId } = req.params;
        const { groupId: userGroupId, siteId, userLevel, isSuperGroup } = req.userContext;

        if (!isSuperGroup && groupId !== userGroupId) {
            return res.status(403).send('Access Denied: You can only view sites for your own group');
        }

        let sqlQuery = `
            SELECT s.* 
            FROM WebSite s
            JOIN WebMainSub link ON s.c_id = link.sub_id
            WHERE link.main_id = @groupId AND link.sub_type = 'S'
        `;

        // If Site User, restrict to their own site
        if (!isSuperGroup && userLevel === 'SITE') {
            sqlQuery += " AND s.c_id = @siteId";
        }

        sqlQuery += " ORDER BY s.c_name";

        const request = req.db.request();
        request.input('groupId', sql.VarChar, groupId);
        if (!isSuperGroup && userLevel === 'SITE') {
            request.input('siteId', sql.VarChar, siteId);
        }

        const result = await request.query(sqlQuery);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.post('/api/settings/sites', requirePermission(34), async (req, res) => {
    try {
        const { userLevel, isSuperGroup } = req.userContext;
        if (!isSuperGroup && userLevel === 'SITE') {
            return res.status(403).send('Access Denied: Site Users cannot create sites');
        }

        const { name, active, parentId } = req.body; // parentId is Group ID
        const id = await generateId('site');

        const transaction = new sql.Transaction(req.db);
        await transaction.begin();

        try {
            // Create Site
            await transaction.request()
                .input('id', sql.VarChar, id)
                .input('name', sql.VarChar, name)
                .input('active', sql.VarChar, active ? 'Y' : 'N')
                .query("INSERT INTO WebSite (c_id, c_name, c_active) VALUES (@id, @name, @active)");

            // Link to Group
            console.log(`[Settings/Sites POST] Received parentId:`, parentId);
            if (parentId) {
                console.log(`[Settings/Sites POST] Inserting into WebMainSub for main_id: ${parentId}, sub_id: ${id}`);
                await transaction.request()
                    .input('main', sql.VarChar, parentId)
                    .input('sub', sql.VarChar, id)
                    .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@main, 'G', @sub, 'S')");
            } else {
                console.log(`[Settings/Sites POST] parentId not provided, skipping WebMainSub insert!`);
            }

            await transaction.commit();

            // Auto-create WebPermission entries for the new site
            // Create for 'System' AND for the current user's role so they can see what they just created.
            try {
                const userRole = req.userContext.role || 'System';

                await req.db.request()
                    .input('sid', sql.VarChar, id)
                    .input('userRole', sql.VarChar, userRole)
                    .query(`
                        INSERT INTO WebPermission (n_site, c_type, n_menu, c_view, c_insert, c_update, c_delete, c_admin)
                        SELECT @sid, 'System', id, '', '', '', '', 'Y'
                        FROM WebMenu
                        WHERE used = '1'
                        AND id NOT IN (SELECT n_menu FROM WebPermission WHERE n_site = @sid AND c_type = 'System');
                        
                        IF @userRole != 'System'
                        BEGIN
                            INSERT INTO WebPermission (n_site, c_type, n_menu, c_view, c_insert, c_update, c_delete, c_admin)
                            SELECT @sid, @userRole, id, '', '', '', '', 'Y'
                            FROM WebMenu
                            WHERE used = '1'
                            AND id NOT IN (SELECT n_menu FROM WebPermission WHERE n_site = @sid AND c_type = @userRole);
                        END
                    `);
                console.log(`[Settings/Sites POST] Created WebPermission entries for site ${id} (Roles: System, ${userRole})`);
                console.log(`[Settings/Sites POST] Created WebPermission entries for site ${id}`);
            } catch (permErr) {
                console.error(`[Settings/Sites POST] Warning: Failed to create permissions for site ${id}:`, permErr.message);
                // Non-fatal: Site was created successfully, permissions can be fixed manually
            }

            res.json({ success: true, siteId: id, message: 'Site created successfully' });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// [NEW] Get Available Sites (for linking)
// [NEW] Get Available Sites (for linking)
app.get('/api/settings/available-sites', requirePermission(34), async (req, res) => {
    try {
        const { groupId, siteId, userLevel, isSuperGroup } = req.userContext;

        if (isSuperGroup) {
            const result = await req.db.request()
                .query("SELECT * FROM WebSite ORDER BY c_name");
            return res.json(result.recordset);
        }

        // Non-super-group: Get sites from WebMainSub hierarchy
        // If Group Level: Get all sites under their group
        // If Site Level: Get ONLY their site
        let sqlQuery = `
            SELECT s.* FROM WebSite s
            WHERE s.c_id IN (
                SELECT sub_id FROM WebMainSub 
                WHERE main_id = @groupId AND sub_type = 'S'
            )
        `;

        // If Site User, restrict further (though usually site users don't need 'available sites' for linking, 
        // as they can't manage group links. But for consistency:)
        if (userLevel === 'SITE') {
            sqlQuery += ` AND s.c_id = @siteId `;
        }

        sqlQuery += ` ORDER BY s.c_name`;

        const request = req.db.request()
            .input('groupId', sql.VarChar, groupId);

        if (userLevel === 'SITE') {
            request.input('siteId', sql.VarChar, siteId);
        }

        const result = await request.query(sqlQuery);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// [NEW] Get Available Serials (for linking)
app.get('/api/settings/available-serials', requirePermission(34), async (req, res) => {
    try {
        const { groupId, siteId, userLevel, isSuperGroup } = req.userContext;

        if (isSuperGroup) {
            const result = await req.db.request()
                .query("SELECT c_id, c_serial_id, c_name, c_active FROM WebSerial ORDER BY c_serial_id");
            return res.json(result.recordset);
        }

        // Get groupName for Smartboard check (command column can be ID or Name)
        let groupName = '';
        if (!isSuperGroup && groupId) {
            const grpRes = await req.db.request().input('gid', sql.VarChar, groupId).query('SELECT c_name FROM WebGroup WHERE c_id = @gid');
            if (grpRes.recordset.length > 0) groupName = grpRes.recordset[0].c_name;
        }

        // Non-super-group: Get serials from WebMainSub hierarchy
        // ALSO include orphaned serials ONLY IF they belong to this group in dbo.Smartboard
        // AND include newly registered boards from Smartboard that are not in WebSerial yet
        let sqlQuery;

        if (userLevel === 'SITE') {
            // Site users: show their own site's serials OR orphaned serials belonging to their group
            sqlQuery = `
                SELECT s.c_id, s.c_serial_id, s.c_name, s.c_active FROM WebSerial s
                WHERE s.c_id IN (
                    SELECT ws.sub_id FROM WebMainSub ws
                    WHERE ws.sub_type = 'I' AND ws.main_id = @siteId
                )
                UNION
                SELECT s.c_id, s.c_serial_id, s.c_name, s.c_active FROM WebSerial s
                WHERE s.c_id NOT IN (
                    SELECT sub_id FROM WebMainSub WHERE sub_type = 'I'
                )
                AND EXISTS (
                    SELECT 1 FROM dbo.Smartboard sb 
                    WHERE sb.boardid COLLATE DATABASE_DEFAULT = s.c_serial_id COLLATE DATABASE_DEFAULT 
                    AND (sb.command = @groupId OR sb.command = @groupName)
                )
                UNION
                SELECT 
                    'NEW_BOARD_' + sb.boardid as c_id,
                    sb.boardid as c_serial_id,
                    ISNULL(NULLIF(sb.c_desc, ''), 'Smartboard ' + sb.boardid) as c_name,
                    'Y' as c_active
                FROM dbo.Smartboard sb
                WHERE (sb.command = @groupId OR sb.command = @groupName)
                AND sb.active = 'B'
                AND sb.boardid COLLATE DATABASE_DEFAULT NOT IN (
                    SELECT c_serial_id COLLATE DATABASE_DEFAULT FROM WebSerial
                )
                ORDER BY c_serial_id
            `;
        } else {
            // Group users: show serials in group's hierarchy OR orphaned serials belonging to their group
            sqlQuery = `
                SELECT s.c_id, s.c_serial_id, s.c_name, s.c_active FROM WebSerial s
                WHERE s.c_id IN (
                    SELECT ws.sub_id FROM WebMainSub ws
                    WHERE ws.sub_type = 'I' AND ws.main_id IN (
                        SELECT ms.sub_id FROM WebMainSub ms 
                        WHERE ms.main_id = @groupId AND ms.sub_type = 'S'
                    )
                )
                UNION
                SELECT s.c_id, s.c_serial_id, s.c_name, s.c_active FROM WebSerial s
                WHERE s.c_id NOT IN (
                    SELECT sub_id FROM WebMainSub WHERE sub_type = 'I'
                )
                AND EXISTS (
                    SELECT 1 FROM dbo.Smartboard sb 
                    WHERE sb.boardid COLLATE DATABASE_DEFAULT = s.c_serial_id COLLATE DATABASE_DEFAULT 
                    AND (sb.command = @groupId OR sb.command = @groupName)
                )
                UNION
                SELECT 
                    'NEW_BOARD_' + sb.boardid as c_id,
                    sb.boardid as c_serial_id,
                    ISNULL(NULLIF(sb.c_desc, ''), 'Smartboard ' + sb.boardid) as c_name,
                    'Y' as c_active
                FROM dbo.Smartboard sb
                WHERE (sb.command = @groupId OR sb.command = @groupName)
                AND sb.active = 'B'
                AND sb.boardid COLLATE DATABASE_DEFAULT NOT IN (
                    SELECT c_serial_id COLLATE DATABASE_DEFAULT FROM WebSerial
                )
                ORDER BY c_serial_id
            `;
        }

        const request = req.db.request();
        // Since we UNION, we must provide groupId and groupName for BOTH cases (because the second half uses them)
        request.input('groupId', sql.VarChar, groupId);
        request.input('groupName', sql.VarChar, groupName);

        if (userLevel === 'SITE') {
            request.input('siteId', sql.VarChar, siteId);
        }

        const result = await request.query(sqlQuery);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});


// [NEW] Update Group-Site Links
app.post('/api/settings/links/group-site', requirePermission(34), async (req, res) => {
    try {
        const { groupId, siteIds } = req.body; // siteIds is array of c_id

        const transaction = new sql.Transaction(req.db);
        await transaction.begin();

        try {
            // 1. Remove all existing links for this Group (where main_id = groupId AND sub_type = 'S')
            // Wait, if a site is linked to another group, what happens?
            // Usually a Site belongs to one Group.
            // So we should update the links.

            // Strategy:
            // 1. Delete all 'S' links where main_id = groupId.
            await transaction.request()
                .input('gid', sql.VarChar, groupId)
                .query("DELETE FROM WebMainSub WHERE main_id = @gid AND sub_type = 'S'");

            // 2. Insert new links
            if (siteIds && siteIds.length > 0) {
                for (const siteId of siteIds) {
                    await transaction.request()
                        .input('gid', sql.VarChar, groupId)
                        .input('sid', sql.VarChar, siteId)
                        .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@gid, 'G', @sid, 'S')");
                }
            }

            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// [NEW] Update Site-Serial Links
app.post('/api/settings/links/site-serial', requirePermission(34), async (req, res) => {
    try {
        const { siteId, serialIds } = req.body; // serialIds is array of c_id

        const transaction = new sql.Transaction(req.db);
        await transaction.begin();

        try {
            // 1. Remove all existing links for this Site (where main_id = siteId AND sub_type = 'I')
            await transaction.request()
                .input('sid', sql.VarChar, siteId)
                .query("DELETE FROM WebMainSub WHERE main_id = @sid AND sub_type = 'I'");

            // 2. Insert new links and auto-instantiate WebSerial records if needed
            if (serialIds && serialIds.length > 0) {
                for (const serialId of serialIds) {
                    let finalId = serialId;

                    if (serialId.startsWith('NEW_BOARD_')) {
                        const boardId = serialId.replace('NEW_BOARD_', '');
                        const nameRaw = req.body.serialNames ? req.body.serialNames[serialId] : null;
                        
                        // Automatically generate new ID for WebSerial
                        finalId = await generateId('serial');
                        
                        // Default name or use description from Smartboard
                        let finalName = `Serial ${boardId}`;
                        
                        const sbCheck = await transaction.request()
                            .input('bid', sql.VarChar, boardId)
                            .query("SELECT c_desc FROM Smartboard WHERE boardid = @bid AND active = 'B'");
                            
                        if (sbCheck.recordset.length > 0 && sbCheck.recordset[0].c_desc) {
                            finalName = sbCheck.recordset[0].c_desc;
                        }

                        // Create the physical WebSerial entry
                        await transaction.request()
                            .input('id', sql.VarChar, finalId)
                            .input('serial', sql.VarChar, boardId)
                            .input('name', sql.VarChar, finalName)
                            .query("INSERT INTO WebSerial (c_id, c_serial_id, c_name, c_active) VALUES (@id, @serial, @name, 'Y')");
                    }

                    // Link the WebSerial to the Site
                    await transaction.request()
                        .input('sid', sql.VarChar, siteId)
                        .input('ser', sql.VarChar, finalId)
                        .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@sid, 'S', @ser, 'I')");
                }
            }

            await transaction.commit();
            res.json({ success: true });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.put('/api/settings/sites/:id', requirePermission(34), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, active } = req.body;
        await req.db.request()
            .input('id', sql.VarChar, id)
            .input('name', sql.VarChar, name)
            .input('active', sql.VarChar, active ? 'Y' : 'N')
            .query("UPDATE WebSite SET c_name = @name, c_active = @active WHERE c_id = @id");
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.delete('/api/settings/sites/:id', requirePermission(34), async (req, res) => {
    try {
        const { id } = req.params;
        // Delete links (both as sub and main)
        await req.db.request().input('id', sql.VarChar, id).query("DELETE FROM WebMainSub WHERE sub_id = @id OR main_id = @id");
        await req.db.request().input('id', sql.VarChar, id).query("DELETE FROM WebSite WHERE c_id = @id");
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// 3. Serials (Linked to Site)
app.get('/api/settings/sites/:siteId/serials', requirePermission(34), async (req, res) => {
    try {
        const { siteId } = req.params;
        const { groupId, userLevel, siteId: userSiteId, isSuperGroup } = req.userContext;

        // Check Access
        if (!isSuperGroup) {
            // 1. Strict Check for Site User: Must match their own site
            if (userLevel === 'SITE' && siteId !== userSiteId) {
                return res.status(403).send('Access Denied: You can only view serials for your own site');
            }

            // 2. Hierarchy Check (Ensure Site belongs to Group)
            const check = await req.db.request()
                .input('groupId', sql.VarChar, groupId)
                .input('siteId', sql.VarChar, siteId)
                .query("SELECT 1 FROM WebMainSub WHERE main_id = @groupId AND sub_id = @siteId AND sub_type = 'S'");

            if (check.recordset.length === 0) {
                return res.status(403).send('Access Denied: You do not have access to this site');
            }
        }
        const result = await req.db.request()
            .input('siteId', sql.VarChar, siteId)
            .query(`
                SELECT DISTINCT s.c_id, s.c_serial_id, s.c_name, s.c_active,
                (SELECT COUNT(*) FROM Smartboard sb WHERE sb.active='Y' AND (s.c_serial_id LIKE '%'+sb.boardid OR s.c_serial_id = sb.boardid)) as smartboard_active
                FROM WebSerial s
                JOIN WebMainSub link ON s.c_id = link.sub_id
                WHERE link.main_id = @siteId AND link.sub_type = 'I'
                ORDER BY s.c_name
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.post('/api/settings/serials', requirePermission(34), async (req, res) => {
    try {
        const { name, serial, active, parentId } = req.body; // parentId is Site ID
        const { userLevel, siteId: userSiteId, isSuperGroup } = req.userContext;

        if (!isSuperGroup && userLevel === 'SITE' && parentId !== userSiteId) {
            return res.status(403).send('Access Denied: You can only add serials to your own site');
        }

        const id = await generateId('serial');

        const transaction = new sql.Transaction(req.db);
        await transaction.begin();

        try {
            // Create Serial
            await transaction.request()
                .input('id', sql.VarChar, id)
                .input('serial', sql.VarChar, serial)
                .input('name', sql.VarChar, name)
                .input('active', sql.VarChar, active ? 'Y' : 'N')
                .query("INSERT INTO WebSerial (c_id, c_serial_id, c_name, c_active) VALUES (@id, @serial, @name, @active)");

            // Link to Site
            if (parentId) {
                await transaction.request()
                    .input('main', sql.VarChar, parentId)
                    .input('sub', sql.VarChar, id)
                    .query("INSERT INTO WebMainSub (main_id, main_type, sub_id, sub_type) VALUES (@main, 'S', @sub, 'I')");
            }

            await transaction.commit();
            res.json({ success: true, id });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.put('/api/settings/serials/:id', requirePermission(34), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, serial, active } = req.body;
        await req.db.request()
            .input('id', sql.VarChar, id)
            .input('name', sql.VarChar, name)
            .input('serial', sql.VarChar, serial)
            .input('active', sql.VarChar, active ? 'Y' : 'N')
            .query("UPDATE WebSerial SET c_name = @name, c_serial_id = @serial, c_active = @active WHERE c_id = @id");
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Unlink Serial from a specific Site (keeps WebSerial record)
// Called when user clicks the delete/remove button on a serial inside a site context
app.delete('/api/settings/sites/:siteId/serials/:serialId', requirePermission(34), async (req, res) => {
    try {
        const { siteId, serialId } = req.params;
        // Only remove the link between this site and this serial
        await req.db.request()
            .input('siteId', sql.VarChar, siteId)
            .input('serialId', sql.VarChar, serialId)
            .query("DELETE FROM WebMainSub WHERE main_id = @siteId AND sub_id = @serialId AND sub_type = 'I'");
        res.json({ success: true, message: 'Serial unlinked from site successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Permanently delete Serial (removes from WebSerial and all links)
app.delete('/api/settings/serials/:id', requirePermission(34), async (req, res) => {
    try {
        const { id } = req.params;
        // Delete all links first
        await req.db.request().input('id', sql.VarChar, id).query("DELETE FROM WebMainSub WHERE sub_id = @id");
        await req.db.request().input('id', sql.VarChar, id).query("DELETE FROM WebSerial WHERE c_id = @id");
        res.json({ success: true, message: 'Serial permanently deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});


// Get Permission Groups (Distinct Roles)
app.get('/api/permissions/groups', requirePermission(33), async (req, res) => {
    console.log("HIT /api/permissions/groups");
    try {
        const { siteCode } = req.query;
        const { userLevel, groupId, siteId, isSuperGroup } = req.userContext;

        let enforcedSiteCode = siteCode;
        if (!isSuperGroup) {
            if (userLevel === 'SITE') {
                enforcedSiteCode = siteId;
            } else if (userLevel === 'GROUP') {
                // Group should see their group (groupId) AND sites under them
                // But wait, n_site in WebPermission usually stores SiteID OR GroupID depending on context?
                // Actually, c_type is the Role/Group Name. n_site is the scope.
                // Legacy behavior: Group Users see their own permissions.
                // If we restrict to n_site = siteCode, they see nothing if siteCode is not provided or different.
                // Let's assume for GROUP level, they can see 'groupId' permissions if siteCode is empty.
                if (!siteCode || siteCode === '%') {
                    // If no specific site selected, show Group's own permissions (if any) or ALL sites under them?
                    // Safer to default to groupId if valid.
                    enforcedSiteCode = groupId;
                }
                // If they provided a siteCode, verify it belongs to their group
                // We will rely on caller passing correct siteCode, but we could add verification here.
            }
        }

        let query = "SELECT DISTINCT c_type FROM WebPermission";
        if (enforcedSiteCode && enforcedSiteCode !== '%') {
            query += ` WHERE n_site = '${enforcedSiteCode}'`;
        } else if (!isSuperGroup && userLevel === 'GROUP') {
            // Fallback for Group Level with no siteCode: Show permissions where n_site is their GroupID
            // OR n_site IN (SELECT sub_id FROM WebMainSub WHERE main_id = @groupId)
            query += ` WHERE n_site = '${groupId}' OR n_site IN (SELECT sub_id FROM WebMainSub WHERE main_id = '${groupId}' AND sub_type = 'S')`;
        }

        const result = await req.db.request().query(query);

        const knownRoles = ['System', 'Admin', 'NU', 'Viewer', 'OK', 'Administrator', 'owner'];
        const groupsMap = new Map();

        result.recordset.forEach(row => {
            let name = row.c_type;
            if (name) name = name.trim(); // Trim whitespace

            try {
                const decrypted = Decrypt(name);
                if (decrypted) {
                    name = decrypted;
                    // Clean email prefix (e.g. user@example.comRole -> Role)
                    // Regex looks for an email pattern at the start and captures the rest
                    const emailRegex = /^([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)(.+)$/;
                    const match = name.match(emailRegex);
                    if (match) {
                        name = match[2]; // The part after the email
                    } else {
                        // Fallback for known roles if regex doesn't match (e.g. just "System" or "Admin")
                        for (const role of knownRoles) {
                            if (name.endsWith(role)) {
                                name = role;
                                break;
                            }
                        }
                    }
                }
            } catch (e) { }

            // Deduplicate by name
            if (!groupsMap.has(name)) {
                groupsMap.set(name, { val: row.c_type, name: name });
            }
        });

        res.json(Array.from(groupsMap.values()));
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// ========== USER NOTIFICATION SUBSCRIPTION ==========
// Opt-in registry: which user wants to RECEIVE notifications, on which channel/device.
// (Distinct from dbo.Notify, which holds the threshold rules that GENERATE events.)

// Get the current user's subscription status (used to render the Subscribe button state).
// Expose the VAPID *public* key so the browser can subscribe. Not a secret.
app.get('/api/webpush/public-key', (req, res) => {
    if (!webpushEnabled) {
        return res.status(503).json({ success: false, error: 'Web push not configured' });
    }
    res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

app.get('/api/subscription', authenticateToken, async (req, res) => {
    try {
        const result = await req.db.request()
            .input('userId', sql.UniqueIdentifier, req.user.id)
            .query(`
                SELECT subscription_id, channel, destination, device_id, device_label,
                       scope, scope_value, is_active, created_at, updated_at
                FROM dbo.UserNotificationSubscription
                WHERE user_id = @userId AND is_active = 1
                ORDER BY updated_at DESC
            `);

        const data = result.recordset.map(row => ({
            subscriptionId: row.subscription_id,
            channel: row.channel,
            destination: row.destination || null,
            deviceId: row.device_id || null,
            deviceLabel: row.device_label || null,
            scope: row.scope,
            scopeValue: row.scope_value || null,
            isActive: !!row.is_active,
            updatedAt: row.updated_at
        }));

        res.json({ success: true, subscribed: data.length > 0, data });
    } catch (err) {
        console.error('Error fetching subscription:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Register / confirm a subscription for the current user.
// Body (all optional): { channel, destination, deviceId, deviceLabel, scope, scopeValue }
// Defaults to an in-app, all-scope subscription. Idempotent per (user, channel, destination).
app.post('/api/subscription', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            channel = 'inapp',
            destination = null,
            deviceId = null,
            deviceLabel = null,
            scope = 'all',
            scopeValue = null
        } = req.body || {};

        const allowedChannels = ['inapp', 'webpush', 'line', 'sms', 'email', 'desktop', 'ios', 'android'];
        if (!allowedChannels.includes(channel)) {
            return res.status(400).json({ success: false, error: `channel must be one of: ${allowedChannels.join(', ')}` });
        }

        // Find an existing subscription for this device/destination.
        // The dedup key depends on the channel:
        //   * channels with a destination (webpush/line/sms/email) -> match on destination
        //   * channels without one (inapp/desktop) -> match on device_id, so each
        //     browser/device keeps its own row (true multi-device support)
        const findReq = req.db.request()
            .input('userId', sql.UniqueIdentifier, userId)
            .input('channel', sql.VarChar, channel);
        let findWhere = 'user_id = @userId AND channel = @channel';
        if (destination) {
            findReq.input('destination', sql.NVarChar, String(destination));
            findWhere += ' AND destination = @destination';
        } else if (deviceId) {
            findReq.input('deviceId', sql.NVarChar, String(deviceId));
            findWhere += ' AND device_id = @deviceId';
        } else {
            // No destination and no device_id -> fall back to one row per user+channel
            findWhere += ' AND destination IS NULL AND device_id IS NULL';
        }
        const existing = await findReq.query(
            `SELECT subscription_id FROM dbo.UserNotificationSubscription WHERE ${findWhere}`
        );

        if (existing.recordset.length > 0) {
            const subscriptionId = existing.recordset[0].subscription_id;
            await req.db.request()
                .input('subscriptionId', sql.BigInt, subscriptionId)
                .input('deviceId', sql.NVarChar, deviceId ? String(deviceId) : null)
                .input('deviceLabel', sql.NVarChar, deviceLabel ? String(deviceLabel) : null)
                .input('scope', sql.VarChar, String(scope))
                .input('scopeValue', sql.NVarChar, scopeValue ? String(scopeValue) : null)
                .query(`
                    UPDATE dbo.UserNotificationSubscription
                    SET is_active    = 1,
                        device_id    = @deviceId,
                        device_label = @deviceLabel,
                        scope        = @scope,
                        scope_value  = @scopeValue,
                        updated_at   = GETDATE()
                    WHERE subscription_id = @subscriptionId
                `);
            return res.json({ success: true, subscriptionId, message: 'Subscription updated' });
        }

        const inserted = await req.db.request()
            .input('userId', sql.UniqueIdentifier, userId)
            .input('channel', sql.VarChar, channel)
            .input('destination', sql.NVarChar, destination ? String(destination) : null)
            .input('deviceId', sql.NVarChar, deviceId ? String(deviceId) : null)
            .input('deviceLabel', sql.NVarChar, deviceLabel ? String(deviceLabel) : null)
            .input('scope', sql.VarChar, String(scope))
            .input('scopeValue', sql.NVarChar, scopeValue ? String(scopeValue) : null)
            .query(`
                INSERT INTO dbo.UserNotificationSubscription
                    (user_id, channel, destination, device_id, device_label, scope, scope_value, is_active, created_at, updated_at)
                OUTPUT INSERTED.subscription_id
                VALUES (@userId, @channel, @destination, @deviceId, @deviceLabel, @scope, @scopeValue, 1, GETDATE(), GETDATE())
            `);

        res.json({ success: true, subscriptionId: inserted.recordset[0].subscription_id, message: 'Subscribed successfully' });
    } catch (err) {
        console.error('Error saving subscription:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Unsubscribe (soft) — keeps the row for audit but stops delivery.
app.delete('/api/subscription/:id', authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid subscription id' });
        }
        await req.db.request()
            .input('subscriptionId', sql.BigInt, id)
            .input('userId', sql.UniqueIdentifier, req.user.id)
            .query(`
                UPDATE dbo.UserNotificationSubscription
                SET is_active = 0, updated_at = GETDATE()
                WHERE subscription_id = @subscriptionId AND user_id = @userId
            `);
        res.json({ success: true, message: 'Unsubscribed successfully' });
    } catch (err) {
        console.error('Error unsubscribing:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/notify', async (req, res) => {
    try {
        const { serials } = req.query; // comma-separated serial names e.g. "Meter1,Meter2"

        if (!serials) {
            return res.status(400).json({ success: false, error: 'serials query param is required' });
        }

        const serialList = serials.split(',').map(s => s.trim()).filter(Boolean);
        if (serialList.length === 0) {
            return res.status(400).json({ success: false, error: 'serials must not be empty' });
        }

        const placeholders = serialList.map((_, i) => `@serial${i}`).join(', ');
        const request = req.db.request();
        serialList.forEach((serial, i) => {
            request.input(`serial${i}`, sql.VarChar, serial);
        });

        const result = await request.query(`
            SELECT serial_id, serial_name, dbkey, level, point, delay, message, alarm_type
            FROM dbo.NotifyConfig
            WHERE serial_name IN (${placeholders})
        `);

        const data = result.recordset.map(row => ({
            originalId: row.serial_id,
            serial: row.serial_name,
            dbKey: row.dbkey,
            levelName: row.level,
            point: parseFloat(row.point) || 0,
            delay: parseInt(row.delay) || 10,
            message: row.message || '',
            alarmType: row.alarm_type || ''
        }));

        res.json({ success: true, data });
    } catch (err) {
        console.error('Error fetching notification settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/notify', async (req, res) => {
    try {
        const notifyData = req.body;

        if (!Array.isArray(notifyData) || notifyData.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid notification data - expected non-empty array' });
        }

        for (const item of notifyData) {
            if (!item.serial || !item.dbKey || !item.levelName || item.point === undefined || item.delay === undefined || item.originalId === undefined) {
                return res.status(400).json({ success: false, error: 'Missing required fields: serial, dbKey, levelName, point, delay, originalId' });
            }
            if (typeof item.point !== 'number' || typeof item.delay !== 'number') {
                return res.status(400).json({ success: false, error: 'point and delay must be numbers' });
            }
        }

        for (const item of notifyData) {
            const { serial, mqttSerial, dbKey, levelName, point, delay, message, alarmType, originalId } = item;
            // Canonical MQTT join key: prefer explicit mqttSerial, else derive from serial.
            const mqttSerialValue = String(mqttSerial || serial || '').toUpperCase() || null;

            const checkResult = await req.db.request()
                .input('serialId', sql.Int, parseInt(originalId))
                .input('dbKey', sql.VarChar, String(dbKey))
                .input('level', sql.VarChar, String(levelName))
                .query(`SELECT 1 FROM dbo.NotifyConfig WHERE serial_id = @serialId AND dbkey = @dbKey AND level = @level`);

            if (checkResult.recordset.length > 0) {
                // Update existing record
                await req.db.request()
                    .input('serialId', sql.Int, parseInt(originalId))
                    .input('serialName', sql.VarChar, String(serial))
                    .input('mqttSerial', sql.VarChar, mqttSerialValue)
                    .input('dbKey', sql.VarChar, String(dbKey))
                    .input('level', sql.VarChar, String(levelName))
                    .input('point', sql.Decimal(10, 2), parseFloat(point))
                    .input('delay', sql.Int, parseInt(delay))
                    .input('message', sql.NVarChar, String(message || ''))
                    .input('alarmType', sql.VarChar, String(alarmType || ''))
                    .query(`
                        UPDATE dbo.NotifyConfig
                        SET serial_name = @serialName,
                            mqtt_serial = @mqttSerial,
                            point       = @point,
                            delay       = @delay,
                            message     = @message,
                            alarm_type  = @alarmType,
                            updated_at  = GETDATE()
                        WHERE serial_id = @serialId AND dbkey = @dbKey AND level = @level
                    `);
            } else {
                await req.db.request()
                    .input('serialId', sql.Int, parseInt(originalId))
                    .input('serialName', sql.VarChar, String(serial))
                    .input('mqttSerial', sql.VarChar, mqttSerialValue)
                    .input('dbKey', sql.VarChar, String(dbKey))
                    .input('level', sql.VarChar, String(levelName))
                    .input('point', sql.Decimal(10, 2), parseFloat(point))
                    .input('delay', sql.Int, parseInt(delay))
                    .input('message', sql.NVarChar, String(message || ''))
                    .input('alarmType', sql.VarChar, String(alarmType || ''))
                    .query(`
                        INSERT INTO dbo.NotifyConfig (serial_id, serial_name, mqtt_serial, dbkey, level, point, delay, message, alarm_type, created_at, updated_at)
                        VALUES (@serialId, @serialName, @mqttSerial, @dbKey, @level, @point, @delay, @message, @alarmType, GETDATE(), GETDATE())
                    `);
            }
        }

        res.json({ success: true, message: 'Notification settings saved successfully' });
    } catch (err) {
        console.error('Error saving notification settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Notify Config module — list all notify configs (grouped by serial on the client)
app.get('/api/notify/all', async (req, res) => {
    try {
        const result = await req.db.request().query(`
            SELECT notify_id, serial_id, serial_name, dbkey, level, point, delay,
                   message, alarm_type, status_notify, created_at, updated_at
            FROM dbo.NotifyConfig
            ORDER BY serial_id, dbkey, notify_id
        `);

        const data = result.recordset.map(row => ({
            notifyId: row.notify_id,
            serialId: row.serial_id,
            serialName: row.serial_name,
            dbKey: row.dbkey,
            level: row.level,
            point: parseFloat(row.point) || 0,
            delay: parseInt(row.delay) || 0,
            message: row.message || '',
            alarmType: row.alarm_type || '',
            statusNotify: row.status_notify,
            updatedAt: row.updated_at
        }));

        res.json({ success: true, data });
    } catch (err) {
        console.error('Error fetching notify configs:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Bulk-update edited rows for a serial group (point/delay/message/alarm_type only)
app.post('/api/notify/update', async (req, res) => {
    try {
        const rows = req.body;

        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Expected a non-empty array of rows' });
        }

        for (const row of rows) {
            if (row.notifyId === undefined || row.notifyId === null) {
                return res.status(400).json({ success: false, error: 'Each row requires notifyId' });
            }
            if (row.point !== undefined && typeof row.point !== 'number') {
                return res.status(400).json({ success: false, error: 'point must be a number' });
            }
            if (row.delay !== undefined && typeof row.delay !== 'number') {
                return res.status(400).json({ success: false, error: 'delay must be a number' });
            }
        }

        for (const row of rows) {
            await req.db.request()
                .input('notifyId', sql.Int, parseInt(row.notifyId))
                .input('point', sql.Decimal(10, 2), parseFloat(row.point) || 0)
                .input('delay', sql.Int, parseInt(row.delay) || 0)
                .input('message', sql.NVarChar, String(row.message || ''))
                .input('alarmType', sql.VarChar, String(row.alarmType || ''))
                .query(`
                    UPDATE dbo.NotifyConfig
                    SET point      = @point,
                        delay      = @delay,
                        message    = @message,
                        alarm_type = @alarmType,
                        updated_at = GETDATE()
                    WHERE notify_id = @notifyId
                `);
        }

        res.json({ success: true, message: 'Notify configs updated successfully' });
    } catch (err) {
        console.error('Error updating notify configs:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete a single notify row
app.delete('/api/notify/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid notify id' });
        }

        await req.db.request()
            .input('notifyId', sql.Int, id)
            .query(`DELETE FROM dbo.NotifyConfig WHERE notify_id = @notifyId`);

        res.json({ success: true, message: 'Notify config deleted successfully' });
    } catch (err) {
        console.error('Error deleting notify config:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Notify Log — read-only list of all NotifyLog rows, newest first
app.get('/api/notify-log', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 50));
        const offset = (page - 1) * pageSize;

        const countRes = await req.db.request()
            .query(`SELECT COUNT(*) AS total FROM dbo.NotifyLog`);
        const total = countRes.recordset[0].total;

        const result = await req.db.request()
            .input('offset', sql.Int, offset)
            .input('pageSize', sql.Int, pageSize)
            .query(`
                SELECT log_id, notify_id, serial_id, mqtt_serial, gateway_id,
                       dbkey, level, value, point, message, alarm_type,
                       event_time, status, sent_at, delivered_count, attempts, created_at
                FROM dbo.NotifyLog
                ORDER BY log_id DESC
                OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
            `);

        res.json({
            success: true,
            total,
            page,
            pageSize,
            data: result.recordset.map(r => ({
                logId: r.log_id,
                notifyId: r.notify_id,
                serialId: r.serial_id,
                mqttSerial: r.mqtt_serial,
                gatewayId: r.gateway_id,
                dbkey: r.dbkey,
                level: r.level,
                value: r.value != null ? Number(r.value) : null,
                point: r.point != null ? Number(r.point) : null,
                message: r.message,
                alarmType: r.alarm_type,
                eventTime: r.event_time,
                status: r.status,
                sentAt: r.sent_at,
                deliveredCount: r.delivered_count,
                attempts: r.attempts,
                createdAt: r.created_at,
            }))
        });
    } catch (err) {
        console.error('Error fetching notify log:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===== WEB PUSH DISPATCHER =====
// Polls NotifyLog for pending rows, pushes each to every matching active
// webpush subscription, then flips the row to 'sent'. Dedup is by row status:
// one NotifyLog row is delivered exactly once to the subscribers active at
// that moment (a device that subscribes later won't receive old alerts).
const WEBPUSH_POLL_MS = 3000;
let webpushDispatchRunning = false;

async function dispatchWebPush() {
    if (!webpushEnabled || webpushDispatchRunning || !global.dbPool) return;
    webpushDispatchRunning = true;
    try {
        const pending = await global.dbPool.request().query(`
            SELECT TOP (50) log_id, mqtt_serial, dbkey, level, value, point,
                   message, alarm_type, event_time
            FROM dbo.NotifyLog
            WHERE status = 'pending'
            ORDER BY log_id ASC
        `);

        for (const row of pending.recordset) {
            // Find active webpush subscriptions that match this serial's scope.
            const subsRes = await global.dbPool.request()
                .input('serial', sql.VarChar, String(row.mqtt_serial || '').toUpperCase())
                .query(`
                    SELECT subscription_id, destination
                    FROM dbo.UserNotificationSubscription
                    WHERE is_active = 1 AND channel = 'webpush' AND destination IS NOT NULL
                      AND (scope = 'all' OR (scope = 'serial' AND UPPER(scope_value) = @serial))
                `);
            const subs = subsRes.recordset;

            const payload = JSON.stringify({
                title: `${row.mqtt_serial} • ${row.dbkey} ${row.level}`,
                body: `${row.message || 'Alert'} (value ${row.value}${row.point != null ? `, threshold ${row.point}` : ''})`,
                tag: `notify-${row.log_id}`,
                data: { url: '/notify-log', logId: row.log_id, serial: row.mqtt_serial },
            });

            let delivered = 0;
            for (const s of subs) {
                let subscription;
                try {
                    subscription = JSON.parse(s.destination);
                } catch (_) {
                    continue; // corrupt destination — skip
                }
                try {
                    await webpush.sendNotification(subscription, payload);
                    delivered++;
                } catch (err) {
                    // 404/410 mean the endpoint is dead — deactivate so we stop retrying.
                    if (err.statusCode === 404 || err.statusCode === 410) {
                        await global.dbPool.request()
                            .input('id', sql.BigInt, s.subscription_id)
                            .query(`UPDATE dbo.UserNotificationSubscription
                                    SET is_active = 0, updated_at = GETDATE()
                                    WHERE subscription_id = @id`);
                        console.log(`[webpush] deactivated dead subscription ${s.subscription_id} (HTTP ${err.statusCode})`);
                    } else {
                        console.error(`[webpush] send failed (sub ${s.subscription_id}):`, err.statusCode || err.message);
                    }
                }
            }

            // matched>0 but none delivered -> 'failed'; otherwise 'sent'.
            const newStatus = (subs.length > 0 && delivered === 0) ? 'failed' : 'sent';
            await global.dbPool.request()
                .input('logId', sql.BigInt, row.log_id)
                .input('count', sql.Int, delivered)
                .input('status', sql.VarChar, newStatus)
                .query(`
                    UPDATE dbo.NotifyLog
                    SET status = @status, sent_at = GETDATE(),
                        delivered_count = @count, attempts = attempts + 1
                    WHERE log_id = @logId
                `);
            console.log(`[webpush] log ${row.log_id} ${row.mqtt_serial}/${row.dbkey} ${row.level} -> ${delivered}/${subs.length} device(s) [${newStatus}]`);
        }
    } catch (err) {
        console.error('[webpush dispatch]', err.message);
    } finally {
        webpushDispatchRunning = false;
    }
}

if (webpushEnabled) {
    setInterval(dispatchWebPush, WEBPUSH_POLL_MS);
    console.log(`[webpush] dispatcher started (every ${WEBPUSH_POLL_MS}ms)`);
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
