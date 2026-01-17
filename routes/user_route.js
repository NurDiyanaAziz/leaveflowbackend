const express = require('express');
const router = express.Router();
const db = require('../db'); 
const multer = require('multer');
const path = require('path');

// CONFIGURE MULTER (Memory storage is easiest for simple handling)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); // Make sure this folder exists!
  },
  filename: function (req, file, cb) {
    // Save as: timestamp-filename.jpg to avoid duplicates
    cb(null, Date.now() + path.extname(file.originalname)); 
  }
});
const upload = multer({ storage: storage });

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
    
    // 👇 UPDATED QUERY WITH CASE LOGIC
    const query = `
      SELECT 
        lt.id as leave_type_id,
        lt.name as leave_type,
        lb.remaining_days as available,
        
        CASE 
           WHEN lt.name = 'Unpaid Leave' THEN 0 
           ELSE (14 - lb.remaining_days) 
        END as used,
        
        CASE 
           WHEN lt.name = 'Unpaid Leave' THEN 999 
           ELSE 14 
        END as total

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
router.post('/leave-request', upload.single('attachment'), async (req, res) => {
  const { user_id, leave_type_id, start_date, end_date, days_requested, reason } = req.body;

  const days = days_requested;

  console.log("Parsed Body:", req.body);
  console.log("Parsed File:", req.file);

  // Validation
  if (!user_id || !leave_type_id || !start_date || !end_date || !days || !reason) {
    return res.status(400).send({ 
      success: false,
      message: 'Missing required fields (user_id, leave_type_id, start_date, end_date, days, reason).' 
    });
  }

  // 👇 1. EXTRACT FILE PATH (Handle case where no file is uploaded)
  // We use .path to get the location, and replace backslashes with forward slashes for Windows compatibility
  const attachmentUrl = (req.file && req.file.path) 
      ? req.file.path.replace(/\\/g, "/") 
      : null;

  let connection;

  try {
    connection = await db.pool.getConnection();
    await connection.beginTransaction();

    // 1. Check if user has enough leave balance
    const [balanceCheck] = await connection.query(
      'SELECT remaining_days FROM leave_balances WHERE user_id = ? AND leave_type_id = ?',
      [user_id, leave_type_id]
    );

    // ... (Balance Check Logic stays the same) ...
    if (balanceCheck.length === 0) {
      await connection.rollback();
      return res.status(404).send({ success: false, message: 'Leave balance not found.' });
    }

    const remainingDays = parseFloat(balanceCheck[0].remaining_days);
    const requestedDays = parseFloat(days);

    if (remainingDays < requestedDays) {
      await connection.rollback();
      return res.status(400).send({ 
        success: false, 
        message: `Insufficient leave balance. Available: ${remainingDays}, Requested: ${requestedDays}.` 
      });
    }

    // 👇 2. UPDATE SQL QUERY (Added attachment_url)
    const insertRequestQuery = `
      INSERT INTO leave_requests 
      (user_id, leave_type_id, start_date, end_date, days_requested, reason, attachment_url, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', NOW())
    `;

    // 👇 3. UPDATE PARAMETERS (Added attachmentUrl)
    const [result] = await connection.query(insertRequestQuery, [
      user_id,
      leave_type_id,
      start_date,
      end_date,
      days,
      reason,
      attachmentUrl // <--- Pass the file path here
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
      message: 'Internal server error.', 
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
        lr.manager_remarks,
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

// POST /api/users/cancel-request
router.post('/cancel-request', async (req, res) => {
  const { requestId, userId } = req.body;

  if (!requestId || !userId) {
    return res.status(400).json({ success: false, message: 'Missing Data' });
  }

  const connection = await db.pool.getConnection();
  try {
    // 1. Check if request exists, belongs to user, and is Pending
    const [check] = await connection.query(
      'SELECT status FROM leave_requests WHERE id = ? AND user_id = ?', 
      [requestId, userId]
    );

    if (check.length === 0) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    if (check[0].status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'You can only cancel Pending requests.' });
    }

    // 2. Cancel it
    await connection.query(
      "UPDATE leave_requests SET status = 'Cancelled' WHERE id = ?",
      [requestId]
    );

    res.json({ success: true, message: 'Request cancelled' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  } finally {
    connection.release();
  }
});

module.exports = router;