const admin = require('../firebase');
const db = require('../db');

// 1. Notify Manager (New Request)
const sendPushToManager = async (managerId, employeeName, leaveType, requestId) => {
    try {
        const [rows] = await db.query('SELECT fcm_token FROM users WHERE id = ?', [managerId]);
        
        if (rows.length === 0 || !rows[0].fcm_token) return;

        const message = {
            notification: {
                title: 'New Leave Request',
                body: `${employeeName} has applied for ${leaveType}.`
            },
            android: {
                notification: {
                    sound: 'default',
                    channelId: 'high_importance_channel'
                }
            },
            // 👇 KEY CHANGE: Add 'data' for Deep Linking
            data: {
                screen: 'manager_detail', // Tells Flutter which screen to open
                requestId: requestId.toString() // Tells Flutter which ID to load
            },
            token: rows[0].fcm_token
        };

        await admin.messaging().send(message);
        console.log(`Manager notified for Request #${requestId}`);

    } catch (error) {
        console.error('Error sending manager notification:', error);
    }
};

// 2. Notify Employee (Status Update)
const sendPushToEmployee = async (employeeId, status, requestId) => {
    try {
        const [rows] = await db.query('SELECT fcm_token FROM users WHERE id = ?', [employeeId]);
        
        if (rows.length === 0 || !rows[0].fcm_token) return;

        // Customize message based on status
        const title = status === 'Approved' ? 'Leave Approved! 🎉' : 'Leave Update';
        const body = status === 'Approved' 
            ? 'Your leave request has been approved.' 
            : `Your leave request has been ${status.toLowerCase()}.`;

        const message = {
            notification: {
                title: title,
                body: body
            },
            android: {
                notification: {
                    sound: 'default',
                    channelId: 'high_importance_channel'
                }
            },
            // 👇 Data for Employee Deep Link
            data: {
                screen: 'employee_detail',
                requestId: requestId.toString()
            },
            token: rows[0].fcm_token
        };

        await admin.messaging().send(message);
        console.log(`Employee notified for Request #${requestId}`);

    } catch (error) {
        console.error('Error sending employee notification:', error);
    }
};

module.exports = { sendPushToManager, sendPushToEmployee };