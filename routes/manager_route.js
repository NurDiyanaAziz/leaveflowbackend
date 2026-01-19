// File: leaveflowbackend/routes/manager_route.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const notificationService = require('../services/notification.service');

// Hardcoded manager ID for development/testing
const TEST_MANAGER_ID_ORIGINAL = 'hJydLYnwKDY04yIN4wGVTkIflVl2'; 
const activeManagerId = TEST_MANAGER_ID_ORIGINAL;

// GET /api/manager/requests/pending (Fetch Pending Requests)
router.get('/requests/pending', async (req, res) => {
    const managerId = activeManagerId;
    try {
        const [pendingRequests] = await db.pool.query(
            `SELECT 
                LeaveRequest.id AS request_id, 
                LeaveRequest.user_id, 
                Employee.name AS employee_name, 
                LeaveType.name AS leave_type,
                LeaveRequest.start_date, 
                LeaveRequest.end_date, 
                LeaveRequest.days_requested, 
                LeaveRequest.reason, 
                LeaveRequest.attachment_url,
                LeaveRequest.manager_remarks,
                LeaveRequest.created_at
            FROM leave_requests LeaveRequest
            JOIN users Employee ON LeaveRequest.user_id = Employee.id
            JOIN leave_types LeaveType ON LeaveRequest.leave_type_id = LeaveType.id
            WHERE LeaveRequest.status = 'Pending' 
            AND Employee.manager_id = ?
            ORDER BY LeaveRequest.created_at ASC`,
            [managerId]
        );

        res.status(200).json({ 
            message: 'Successfully retrieved pending leave requests.',
            requests: pendingRequests
        });
    } catch (error) {
        console.error('Failed to retrieve pending requests:', error.message); 
        res.status(500).json({ message: 'Error retrieving pending requests.', error: error.message });
    }
});

// GET /api/manager/requests/history 
router.get('/requests/history', async (req, res) => {
    const managerId = activeManagerId;
    try {
        const sql = `
            SELECT 
                LeaveRequest.id AS request_id, 
                LeaveRequest.user_id, 
                Employee.name AS employee_name, 
                LeaveType.name AS leave_type,
                LeaveRequest.start_date, 
                LeaveRequest.end_date, 
                LeaveRequest.days_requested,
                LeaveRequest.reason, 
                LeaveRequest.attachment_url,
                LeaveRequest.manager_remarks, 
                LeaveRequest.status,
                LeaveRequest.approver_id,
                LeaveRequest.created_at
            FROM leave_requests LeaveRequest
            JOIN users Employee ON LeaveRequest.user_id = Employee.id
            JOIN leave_types LeaveType ON LeaveRequest.leave_type_id = LeaveType.id
            WHERE Employee.manager_id = ?
            ORDER BY LeaveRequest.created_at DESC`;

        const [historyRequests] = await db.pool.query(sql, [managerId]);
        res.status(200).json({ 
            message: 'Successfully retrieved leave request history.',
            requests: historyRequests
        });
    } catch (error) {
        console.error('Failed to retrieve request history:', error.message); 
        res.status(500).json({ message: 'Error retrieving request history.', error: error.message });
    }
});

// PUT /api/manager/request/:requestId (Approve/Reject Logic)
router.put('/request/:requestId', async (req, res) => {
    // ⚠️ Ensure activeManagerId is defined (usually from req.user.id via middleware)
    // const managerId = req.user.id; 
    const managerId = activeManagerId; 

    const { action, remarks } = req.body; 
    const { requestId } = req.params;
    
    if (!action || (action !== 'approve' && action !== 'reject')) {
        return res.status(400).json({ message: 'Invalid action. Must be "approve" or "reject".' });
    }

    let connection;
    try {
        connection = await db.pool.getConnection();
        await connection.beginTransaction();

        // 1. Fetch Request & Verify Manager Authority
        const [requestRows] = await connection.query(
            `SELECT user_id, leave_type_id, days_requested, status, 
            (SELECT manager_id FROM users WHERE id = leave_requests.user_id) AS request_manager_id 
            FROM leave_requests WHERE id = ?`, [requestId]
        );

        if (requestRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Leave request not found.' });
        }

        const request = requestRows[0];

        // Authorization Check
        // Note: Using loose equality (!=) handles string vs int manager ID issues
        if (request.request_manager_id != managerId) {
             await connection.rollback();
             return res.status(403).json({ message: 'Forbidden: You are not authorized for this employee.' });
        }

        if (request.status !== 'Pending') {
            await connection.rollback();
            return res.status(409).json({ message: `Request is already ${request.status}.` });
        }
        
        const newStatus = action === 'approve' ? 'Approved' : 'Rejected';

        // 2. Update Status
        await connection.query(
            `UPDATE leave_requests SET status = ?, approver_id = ?, manager_remarks = ?, last_updated_at = NOW() WHERE id = ?`,
            [newStatus, managerId, remarks || null, requestId]
        );

        // 3. Deduct Balance (Only if Approved)
        if (action === 'approve') {
            const [updateResult] = await connection.query(
                `UPDATE leave_balances SET remaining_days = remaining_days - ?, last_updated_at = NOW()
                 WHERE user_id = ? AND leave_type_id = ? AND remaining_days >= ?`,
                [request.days_requested, request.user_id, request.leave_type_id, request.days_requested]
            );

            if (updateResult.affectedRows === 0) {
                throw new Error('Insufficient leave balance.');
            }
        }

        // 4. Commit Transaction (Database work is done)
        await connection.commit();

        // ---------------------------------------------------------
        // 👇 NEW: Trigger Notification to Employee
        // ---------------------------------------------------------
        try {
            // request.user_id is available from the SELECT query at the top
            await notificationService.sendPushToEmployee(
                request.user_id, 
                newStatus, 
                requestId
            );
        } catch (notifError) {
            // We catch this separately so the response doesn't crash 
            // if the notification fails (the DB update is already saved).
            console.error("Notification failed but DB updated:", notifError);
        }
        // ---------------------------------------------------------

        res.status(200).json({ message: `Request ${newStatus} successfully.` });

    } catch (error) {
        if (connection) await connection.rollback();
        // Check if it was our custom error
        if (error.message === 'Insufficient leave balance.') {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: 'Transaction failed.', error: error.message });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;