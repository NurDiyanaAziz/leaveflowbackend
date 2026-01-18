const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendPushToManager } = require('../services/notification.service');

// POST /api/requests/apply
router.post('/apply', async (req, res) => {
    const { user_id, leave_type_id, start_date, end_date, days_requested, reason, manager_id } = req.body;

    try {
        // 1. Save to MySQL
        const sql = `
            INSERT INTO leave_requests 
            (user_id, leave_type_id, start_date, end_date, days_requested, reason, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'Pending', NOW())
        `;
        await db.query(sql, [user_id, leave_type_id, start_date, end_date, days_requested, reason]);

        // 2. Get Employee Name (for the notification text)
        const [userRows] = await db.query('SELECT name FROM users WHERE id = ?', [user_id]);
        const employeeName = userRows[0].name;

        // 3. Get Leave Type Name
        const [typeRows] = await db.query('SELECT name FROM leave_types WHERE id = ?', [leave_type_id]);
        const typeName = typeRows[0].name;

        // 4. TRIGGER NOTIFICATION
        // (This runs in background, we don't wait for it)
        sendPushToManager(manager_id, employeeName, typeName);

        res.status(201).json({ message: 'Request submitted and Manager notified' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Database error' });
    }
});

module.exports = router;