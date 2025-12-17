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
// Called by Flutter immediately after Firebase Login success
router.post('/login_details', async (req, res) => {
    const { uid } = req.body;

    if (!uid) {
        return res.status(400).json({ message: "UID is required" });
    }

    try {
        // Query the database for the Name and Role
        // We use the UID (from Firebase) to find the specific user
        const [rows] = await db.pool.query(
            'SELECT name, role FROM users WHERE id = ?', 
            [uid]
        );

        if (rows.length > 0) {
            const user = rows[0];
            
            // Send the data back to Flutter
            res.status(200).json({ 
                status: 'success', 
                role: user.role,   // e.g., "Manager", "Employee", "HR"
                name: user.name    // e.g., "Laika"
            });
        } else {
            // User is in Firebase but NOT in MySQL (Data mismatch)
            res.status(404).json({ message: 'User profile not found in database' });
        }
    } catch (error) {
        console.error("Login Details Error:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;