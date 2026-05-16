const { connectToDb, sql } = require('../db');

async function testSave() {
    try {
        console.log("Connecting to DB...");
        const pool = await connectToDb();
        console.log("Connected.");

        const name = "Test View " + Date.now();
        const config = JSON.stringify({
            nodes: [],
            edges: [],
            defaultEdgeStyle: {},
            defaultBoxStyle: {},
            defaultMeterStyle: {},
            defaultImageStyle: {}
        });

        console.log("Attempting to insert...");

        // Simulate the API logic
        const request = new sql.Request();
        request.input('name', sql.NVarChar, name);
        request.input('config', sql.NVarChar(sql.MAX), config);

        const query = `
            INSERT INTO CustomViews (name, config) 
            OUTPUT INSERTED.id
            VALUES (@name, @config)
        `;

        const result = await request.query(query);

        console.log("Insert successful. ID:", result.recordset[0].id);

        // Clean up
        console.log("Deleting test record...");
        await new sql.Request().query(`DELETE FROM CustomViews WHERE id = ${result.recordset[0].id}`);
        console.log("Deleted.");

    } catch (err) {
        console.error("Test Failed:", err);
    } finally {
        await sql.close();
    }
}

testSave();
