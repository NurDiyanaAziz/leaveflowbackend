const admin = require('../firebase');
const db = require('../db');

const sendPushToManager = async (managerId, employeeName, leaveType) => {
    try {
        // 1. Get Manager's Token from DB
        const [rows] = await db.query('SELECT fcm_token FROM users WHERE id = ?', [managerId]);
        
        if (rows.length === 0 || !rows[0].fcm_token) {
            console.log("Manager has no device token registered.");
            return;
        }

        const registrationToken = rows[0].fcm_token;

        // 2. Construct Message
        const message = {
        notification: {
            title: 'New Leave Request',
            body: `${employeeName} has applied for ${leaveType}.`
        },
        // ADD THIS BLOCK
        android: {
            notification: {
                sound: 'default',
                channelId: 'high_importance_channel' // Must match the ID created in your frontend app
            }
        },
        token: registrationToken
    };

        // 3. Send via Firebase
        const response = await admin.messaging().send(message);
        console.log('Successfully sent message:', response);

    } catch (error) {
        console.error('Error sending notification:', error);
    }
};

module.exports = { sendPushToManager };