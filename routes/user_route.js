const express = require('express');
const router = express.Router();
const db = require('../db'); 
const multer = require('multer');
const path = require('path');

const notificationService = require('../services/notification.service');

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

// ==========================================
// 1. GET FULL PROFILE (Includes Manager Name)
// ==========================================
// GET /api/users/profile/:uid
router.get('/profile/:uid', async (req, res) => {
    const { uid } = req.params;

    try {
        // We perform a "Self-Join" here:
        // We join the 'users' table with itself to find the Manager's name
        const sql = `
            SELECT 
                u.id, u.name, u.email, u.role, 
                u.phone, u.department, u.position, u.address, u.joined_at,
                m.name AS manager_name
            FROM users u
            LEFT JOIN users m ON u.manager_id = m.id
            WHERE u.id = ?`;

        const [rows] = await db.pool.query(sql, [uid]);

        if (rows.length > 0) {
            res.status(200).json({ 
                status: 'success', 
                data: rows[0] 
            });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error("Error fetching profile:", error);
        res.status(500).json({ message: 'Server error fetching profile' });
    }
});

// ==========================================
// 2. UPDATE PROFILE (Phone & Address Only)
// ==========================================
// POST /api/users/profile/update
router.post('/profile/update', async (req, res) => {
    const { uid, phone, address } = req.body;

    // Basic validation
    if (!uid) {
        return res.status(400).json({ message: "UID is required" });
    }

    try {
        const sql = `UPDATE users SET phone = ?, address = ? WHERE id = ?`;
        
        const [result] = await db.pool.query(sql, [phone, address, uid]);

        if (result.affectedRows > 0) {
            res.status(200).json({ message: 'Profile updated successfully' });
        } else {
            res.status(404).json({ message: 'User not found or no changes made' });
        }
    } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).json({ message: 'Failed to update profile' });
    }});

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

    console.log(`Leave request created. ID: ${result.insertId}`);

    // 👇 NOTIFICATION LOGIC (Supports VARCHAR manager_id)
    try {
        // Step A: Get Employee Name and their Manager ID
        const [userRows] = await db.pool.query(
            'SELECT manager_id, name FROM users WHERE id = ?', 
            [user_id]
        );

        if (userRows.length > 0) {
            const employeeName = userRows[0].name;
            
            // 1. Get the raw ID (It will be a String, e.g., "MGR-001" or "105")
            let targetManagerId = userRows[0].manager_id;

            // 2. Safety Check: Convert "null" string or empty string to real null
            // (Sometimes imported data in VARCHAR columns stores "null" as text)
            if (targetManagerId === 'null' || targetManagerId === '') {
                targetManagerId = null;
            }

            // Step B: Fallback - If no manager, find ANY Manager in the system
            if (!targetManagerId) {
                console.log("No manager_id assigned. Searching for a general Manager...");
                const [managerRows] = await db.pool.query(
                    'SELECT id FROM users WHERE role = ? LIMIT 1', 
                    ['Manager']
                );
                if (managerRows.length > 0) {
                    targetManagerId = managerRows[0].id;
                }
            }

            // Step C: Send Notification
            if (targetManagerId) {
                // Optional: Get Leave Type Name
                const [typeRows] = await db.pool.query('SELECT name FROM leave_types WHERE id = ?', [leave_type_id]);
                const leaveTypeName = typeRows.length > 0 ? typeRows[0].name : 'Leave';

                await notificationService.sendPushToManager(
                    targetManagerId, // Passing String ID works fine here
                    employeeName, 
                    leaveTypeName, 
                    result.insertId
                );
            } else {
                console.log("⚠️ No Manager found to notify.");
            }
        }
    } catch (notifError) {
        console.error("Failed to send notification:", notifError);
    }
    // 👆 END NOTIFICATION LOGIC

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

// POST /api/users/update-fcm
// Called immediately after successful login
router.post('/update-fcm', async (req, res) => {
    const { uid, fcm_token } = req.body;

    if (!uid || !fcm_token) {
        return res.status(400).json({ success: false, message: 'Missing UID or Token' });
    }

    try {
        // We use ON DUPLICATE KEY UPDATE logic (or just simple UPDATE if user exists)
        // Since the user MUST exist to login, a simple UPDATE is safe.
        const query = `UPDATE users SET fcm_token = ? WHERE id = ?`;
        
        const [result] = await db.pool.query(query, [fcm_token, uid]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        console.log(`✅ FCM Token updated for user ${uid}`);
        res.json({ success: true, message: 'Token updated' });

    } catch (error) {
        console.error('Update FCM Error:', error);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// POST /api/users/remove-fcm
// Called when user clicks "Logout"
router.post('/remove-fcm', async (req, res) => {
    const { uid } = req.body;

    if (!uid) {
        return res.status(400).json({ success: false, message: 'Missing UID' });
    }

    try {
        // Set token to NULL so they stop receiving notifications
        const query = `UPDATE users SET fcm_token = NULL WHERE id = ?`;
        
        await db.pool.query(query, [uid]);

        console.log(`🔌 FCM Token removed for user ${uid}`);
        res.json({ success: true, message: 'Token removed' });

    } catch (error) {
        console.error('Remove FCM Error:', error);
        res.status(500).json({ success: false, message: 'Database error' });
    }
});

// GET /api/users/leave-request/:id
// Retrieve a single leave request details (Used for Notification Deep Links)
router.get('/leave-request/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const query = `
            SELECT 
                lr.*, 
                u.name AS employee_name, 
                lt.name AS leave_type,
                u.email,
                u.position
            FROM leave_requests lr
            JOIN users u ON lr.user_id = u.id
            JOIN leave_types lt ON lr.leave_type_id = lt.id
            WHERE lr.id = ?
        `;

        const [rows] = await db.pool.query(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Leave request not found' 
            });
        }

        // Return the data wrapper 'data' because your Flutter code expects response.data['data']
        res.json({ 
            success: true, 
            data: rows[0] 
        });

    } catch (error) {
        console.error('Error fetching request details:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server Error' 
        });
    }
});

module.exports = router;