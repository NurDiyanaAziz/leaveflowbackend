const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendPushToManager } = require('../services/notification.service');
const leaveController = require('../services/leave_controller');

// POST /api/requests/apply
// router.post('/apply', async (req, res) => {
//     const { user_id, leave_type_id, start_date, end_date, days_requested, reason, manager_id } = req.body;

//     console.log("🔍 CHECKING OVERLAP FOR:", { user_id, start_date, end_date });

//     try {
//         // --- 1. OVERLAP CHECK (Robust Version) ---
//         // We use DATE() to ignore time differences (e.g. 00:00:00 vs 12:00:00)
//         const overlapSql = `
//             SELECT id, start_date, end_date, status FROM leave_requests 
//             WHERE user_id = ? 
//             AND status IN ('Pending', 'Approved') 
//             AND (DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?))
//         `;
        
//         // Execute the check
//         const [existing] = await db.query(overlapSql, [user_id, end_date, start_date]);

//         // LOG THE RESULT so we know what happened
//         console.log("found overlaps:", existing.length, existing);

//         if (existing.length > 0) {
//             console.log("❌ BLOCKED: Duplicate found!");
//             return res.status(400).json({ 
//                 message: 'You already have a Pending or Approved leave for these dates!' 
//             });
//         }

//         // --- 2. INSERT (Only runs if existing.length === 0) ---
//         const sql = `
//             INSERT INTO leave_requests 
//             (user_id, leave_type_id, start_date, end_date, days_requested, reason, status, created_at)
//             VALUES (?, ?, ?, ?, ?, ?, 'Pending', NOW())
//         `;
//         await db.query(sql, [user_id, leave_type_id, start_date, end_date, days_requested, reason]);

//         // ... (Rest of your notification logic remains the same) ...
        
//         // 3. Get User Name
//         const [userRows] = await db.query('SELECT name FROM users WHERE id = ?', [user_id]);
//         const employeeName = userRows.length > 0 ? userRows[0].name : "Employee";

//         // 4. Get Type Name
//         const [typeRows] = await db.query('SELECT name FROM leave_types WHERE id = ?', [leave_type_id]);
//         const typeName = typeRows.length > 0 ? typeRows[0].name : "Leave";

//         // 5. Send Notification
//         sendPushToManager(manager_id, employeeName, typeName);
        

//         console.log("✅ SUCCESS: Request saved.");
//         res.status(201).json({ message: 'Request submitted' });

//     } catch (error) {
//         console.error("Apply Leave Error:", error);
//         res.status(500).json({ message: 'Database error' });
//     }
// });

// POST /api/requests/apply
router.post('/apply', async (req, res) => {
    // 1. We removed 'manager_id' from here because the frontend doesn't send it
    const { user_id, leave_type_id, start_date, end_date, days_requested, reason } = req.body;

    console.log("🔍 New Application from:", user_id);

    try {
        // --- A. OVERLAP CHECK ---
        const overlapSql = `
            SELECT id FROM leave_requests 
            WHERE user_id = ? 
            AND status IN ('Pending', 'Approved') 
            AND (DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?))
        `;
        const [existing] = await db.query(overlapSql, [user_id, end_date, start_date]);

        if (existing.length > 0) {
            return res.status(400).json({ message: 'You already have a Pending or Approved leave for these dates!' });
        }

        // --- B. INSERT REQUEST ---
        const sql = `
            INSERT INTO leave_requests 
            (user_id, leave_type_id, start_date, end_date, days_requested, reason, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'Pending', NOW())
        `;
        const [result] = await db.query(sql, [user_id, leave_type_id, start_date, end_date, days_requested, reason]);
        
        // Log the new ID (Matches your log style)
        console.log(`Leave request created. ID: ${result.insertId}`);

        // --- C. NOTIFICATION LOGIC (FIXED) ---
        
        // 1. Fetch Employee Name AND their Manager ID from the users table
        // This is the CRITICAL STEP you were missing!
        const [userRows] = await db.query('SELECT name, manager_id FROM users WHERE id = ?', [user_id]);
        
        if (userRows.length > 0) {
            const employeeName = userRows[0].name;
            const managerId = userRows[0].manager_id; // <--- ✅ FETCHED FROM DB

            // 2. Fetch Leave Type Name (e.g., "Annual Leave")
            const [typeRows] = await db.query('SELECT name FROM leave_types WHERE id = ?', [leave_type_id]);
            const typeName = typeRows.length > 0 ? typeRows[0].name : "Leave";

            // 3. Send Notification (Only if user has a manager assigned)
            if (managerId) {
                console.log(`📲 Sending Push to Manager (ID: ${managerId})`);
                
                // Call the service with the ID we found in the database
                await sendPushToManager(managerId, employeeName, typeName);
            } else {
                console.log("⚠️ User has no manager assigned. Notification skipped.");
            }
        }

        res.status(201).json({ message: 'Request submitted' });

    } catch (error) {
        console.error("❌ Apply Leave Error:", error);
        res.status(500).json({ message: 'Database error' });
    }
});

router.get('/leave-types', leaveController.getLeaveTypes);

router.get('/public-holidays', leaveController.getPublicHolidays);

router.get('/calendar-holidays', leaveController.getCalendarHolidays);

router.get('/pending-count', leaveController.getPendingCount);

module.exports = router;