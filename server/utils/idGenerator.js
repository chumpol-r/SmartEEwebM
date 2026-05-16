const sql = require('mssql');

const generateId = async (type) => {
    let query = "";
    let prefix = "";
    let rangeStart = 0;

    switch (type) {
        case 'group':
            // Range: 200,000,000 - 299,999,999
            query = "SELECT MAX(c_id) as maxId FROM WebGroup WHERE c_id >= '200000000' AND c_id < '300000000'";
            rangeStart = 200000000;
            break;
        case 'site':
            // Range: 100,000,000 - 199,999,999
            query = "SELECT MAX(c_id) as maxId FROM WebSite WHERE c_id >= '100000000' AND c_id < '200000000'";
            rangeStart = 100000000;
            break;
        case 'serial':
            // Range: 0 - 99,999,999 (Usually handled differently, but for new serials we might need this)
            // However, legacy code seems to use boardid logic or just max + 1
            // For this specific flow, we might not be creating a NEW serial ID if it already exists in Smartboard table?
            // But if we are registering it into WebSerial, we need an ID.
            query = "SELECT MAX(c_id) as maxId FROM WebSerial WHERE c_id < '100000000'";
            rangeStart = 0;
            break;
        default:
            throw new Error("Invalid ID type");
    }

    try {
        const result = await sql.query(query);
        let maxId = result.recordset[0].maxId;

        if (!maxId) {
            return String(rangeStart + 1).padStart(9, '0');
        }

        // Increment
        let nextId = parseInt(maxId) + 1;
        return String(nextId).padStart(9, '0');
    } catch (err) {
        console.error("Error generating ID:", err);
        throw err;
    }
};

module.exports = { generateId };
