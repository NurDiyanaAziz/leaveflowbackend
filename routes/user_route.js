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

router.get('/leave-balance', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const connection = await db.pool.getConnection();
    
    const query = `
      SELECT 
        lt.id as leave_type_id,
        lt.name as leave_type,
        lb.remaining_days as available,
        (14 - lb.remaining_days) as used,
        14 as total
      FROM leave_balances lb
      JOIN leave_types lt ON lb.leave_type_id = lt.id
      WHERE lb.user_id = ?
    `;

    const [balances] = await connection.query(query, [userId]);
    connection.release();

    res.json({ success: true, data: balances });

  } catch (error) {
    console.error('Error fetching leave balance:', error);
    res.status(500).json({ error: 'Failed to fetch leave balance' });
  }
});

// POST /api/users/leave-request
router.post('/leave-request', async (req, res) => {
  const { user_id, leave_type_id, start_date, end_date, days, reason } = req.body;

  // Validation
  if (!user_id || !leave_type_id || !start_date || !end_date || !days || !reason) {
    return res.status(400).send({ 
      success: false,
      message: 'Missing required fields (user_id, leave_type_id, start_date, end_date, days, reason).' 
    });
  }

  let connection;

  try {
    connection = await db.pool.getConnection();
    await connection.beginTransaction();

    // 1. Check if user has enough leave balance
    const [balanceCheck] = await connection.query(
      'SELECT remaining_days FROM leave_balances WHERE user_id = ? AND leave_type_id = ?',
      [user_id, leave_type_id]
    );

    if (balanceCheck.length === 0) {
      await connection.rollback();
      return res.status(404).send({ 
        success: false,
        message: 'Leave balance not found for this user and leave type.' 
      });
    }

    const remainingDays = parseFloat(balanceCheck[0].remaining_days);
    const requestedDays = parseFloat(days);

    if (remainingDays < requestedDays) {
      await connection.rollback();
      return res.status(400).send({ 
        success: false,
        message: `Insufficient leave balance. Available: ${remainingDays} days, Requested: ${requestedDays} days.` 
      });
    }

    // 2. Insert leave request
    const insertRequestQuery = `
    INSERT INTO leave_requests 
    (user_id, leave_type_id, start_date, end_date, days_requested, reason, status, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, 'Pending', NOW())
    `;

    const [result] = await connection.query(insertRequestQuery, [
      user_id,
      leave_type_id,
      start_date,
      end_date,
      days,
      reason
    ]);

    // 3. Commit transaction
    await connection.commit();

    console.log(`Leave request created: User ${user_id}, Request ID: ${result.insertId}`);
    
    res.status(201).send({ 
      success: true,
      message: 'Leave request submitted successfully.', 
      request_id: result.insertId 
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error creating leave request:', error);
    
    res.status(500).send({ 
      success: false,
      message: 'Internal server error while creating leave request.', 
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/users/leave-requests
router.get('/leave-requests', async (req, res) => {
  try {
    const userId = req.query.userId;
    const status = req.query.status; // Optional: 'Pending', 'Approved', 'Rejected'
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: 'User ID required' 
      });
    }

    const connection = await db.pool.getConnection();
    
    let query = `
    SELECT 
        lr.id,
        lr.user_id,
        lr.leave_type_id,
        lt.name as leave_type,
        lr.start_date,
        lr.end_date,
        lr.days_requested as days,
        lr.reason,
        lr.status,
        lr.manager_response,
        lr.created_at,
        lr.last_updated_at as updated_at
    FROM leave_requests lr
    JOIN leave_types lt ON lr.leave_type_id = lt.id
    WHERE lr.user_id = ?
    `;
    
    const params = [userId];
    
    // Add status filter if provided
    if (status && status !== 'All') {
      query += ' AND lr.status = ?';
      params.push(status);
    }
    
    // Order by most recent first
    query += ' ORDER BY lr.created_at DESC';
    
    // Add limit if provided
    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
    }

    const [requests] = await connection.query(query, params);
    connection.release();

    res.json({ 
      success: true, 
      data: requests 
    });

  } catch (error) {
    console.error('Error fetching leave requests:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch leave requests' 
    });
  }
});

module.exports = router;