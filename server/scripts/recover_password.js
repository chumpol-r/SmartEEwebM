const { connectToDb, sql } = require('../db');
const { Decrypt } = require('../utils/crypto');

async function recoverPassword() {
    try {
        const pool = await connectToDb();
        const email = 'siripat@tat.co.th';

        console.log(`Searching for user with email: ${email}`);

        // Try searching by c_email or c_name (username)
        const result = await pool.request()
            .input('email', sql.VarChar, email)
            .query("SELECT u_id, c_name, c_pass, c_email FROM WebUser WHERE c_email = @email OR c_name = @email");

        if (result.recordset.length === 0) {
            console.log("User not found.");
        } else {
            const user = result.recordset[0];
            console.log("User found:", user.c_name);
            console.log("Encrypted Password:", user.c_pass);

            const decryptedPassword = Decrypt(user.c_pass);
            console.log("Decrypted Password:", decryptedPassword);
        }

        process.exit(0);
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

recoverPassword();
