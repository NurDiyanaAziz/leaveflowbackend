const express = require('express');
const router = express.Router();
const db = require('../db'); 

// POST /api/users/register_mysql
router.post('/register_mysql', async (req, res) => {
    const { uid, name, email, role } = req.body;

    if (!uid || !name || !email || !role) {
        return res.status(400).send({ message: 'Missing required fields (uid, name, email, role).' });
    }

    let connection;

    try {
        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        // --- 1. Insert user into the USERS table ---
        const insertUserQuery = `
            INSERT INTO users (id, name, email, role, manager_id) 
            VALUES (?, ?, ?, ?, NULL)
        `;
        const userValues = [uid, name, email, role];
        await connection.query(insertUserQuery, userValues);

        // --- 2. Insert all default LEAVE_BALANCES ---
        // IDs must match the records created in the 'leave_types' table.
        const DEFAULT_LEAVE_TYPES = [
            { id: 1, days: 14.00 }, // Annual Leave
            { id: 2, days: 14.00 }, // Medical Leave
            { id: 3, days: 999.00 }  // Unpaid Leave (High value for virtually unlimited)
        ];

        // Prepare the batch insert query
        const insertBalanceQuery = `
            INSERT INTO leave_balances (user_id, leave_type_id, remaining_days)
            VALUES (?, ?, ?)
        `;

        const balancePromises = DEFAULT_LEAVE_TYPES.map(type => {
            const values = [uid, type.id, type.days];
            return connection.query(insertBalanceQuery, values);
        });

        // Execute all balance insertions concurrently
        await Promise.all(balancePromises); 

        // 3. Commit the transaction (all steps succeeded)
        await connection.commit();

        console.log(`User registered successfully: ${email} (UID: ${uid})`);
        res.status(201).send({ 
            message: 'User and all initial balances successfully created.', 
            uid: uid 
        });

    } catch (error) {
        // 4. Rollback if any step fails
        if (connection) await connection.rollback();
        console.error('MySQL Registration Transaction Failed:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).send({ 
                message: 'User already exists in the database.', 
                error: error.message 
            });
        }
        
        res.status(500).send({ 
            message: 'Internal server error during registration.', 
            error: error.message 
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/users/login_details
router.post('/login_details', async (req, res) => {
    // 1. Log what the server received
    console.log("-----------------------------------------");
    console.log("LOGIN ATTEMPT RECEIVED");
    console.log("Request Body:", req.body); 
    
    const { uid } = req.body;
    console.log("Extracted UID:", uid);

    if (!uid) {
        console.log("ERROR: UID is missing/undefined in the request body");
        return res.status(400).json({ message: "UID is required" });
    }

    try {
        // 2. Log the exact query being run
        const query = 'SELECT * FROM users WHERE id = ?';
        console.log("Running Query:", query, "with values:", [uid]);

        const [rows] = await db.pool.query(query, [uid]);

        console.log("Database Results Found:", rows.length);
        
        if (rows.length > 0) {
            console.log("SUCCESS: User found ->", rows[0].name);
            const user = rows[0];
            res.status(200).json({ 
                status: 'success', 
                role: user.role, 
                name: user.name 
            });
        } else {
            console.log("FAILURE: Database returned 0 rows.");
            res.status(404).json({ message: 'User not found in MySQL' });
        }
    } catch (error) {
        console.error("CRITICAL SQL ERROR:", error);
        res.status(500).json({ error: error.message });
    }
    console.log("-----------------------------------------");
});

module.exports = router;