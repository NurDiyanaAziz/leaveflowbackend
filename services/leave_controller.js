const db = require('../db');

// GET /api/users/public-holidays
exports.getPublicHolidays = async (req, res) => {
    try {
        const sql = "SELECT holiday_date FROM public_holidays"; 
        
        const [rows] = await db.pool.query(sql);

        const dates = rows.map(row => {
            // 🛠️ FIX: Convert string to Date object first
            const dateObj = new Date(row.holiday_date);
            
            // Check if date is valid before converting
            if (isNaN(dateObj)) return null; 

            return dateObj.toISOString().split('T')[0];
        }).filter(date => date !== null); // Remove any invalid dates

        res.json(dates);
    } catch (error) {
        console.error("Error fetching public holidays:", error);
        res.status(500).json({ error: error.message });
    }
};

// services/leave.controller.js

exports.getCalendarHolidays = async (req, res) => {
    try {
        console.log("📅 Fetching Calendar Holidays..."); // Debug log

        // Use DATE_FORMAT to ensure the date comes back as a clean string 'YYYY-MM-DD'
        const sql = `
            SELECT id, description, 
            DATE_FORMAT(holiday_date, '%Y-%m-%d') as holiday_date 
            FROM public_holidays 
            ORDER BY holiday_date ASC
        `;
        
        // 🔴 USE db.query (Safest option based on your previous code)
        const [rows] = await db.query(sql);
        
        console.log(`✅ Found ${rows.length} holidays`);
        res.json(rows);

    } catch (error) {
        console.error("❌ CRASH in getCalendarHolidays:", error); // This prints the error to your terminal
        res.status(500).json({ error: error.message });
    }
};

// GET /api/users/:userId/balance
exports.getLeaveBalance = async (req, res) => {
    try {
        const userId = req.params.userId;

        // SQL EXPLANATION:
        // 1. FROM leave_types: We start with types so we see ALL options (Annual, Sick, etc.)
        // 2. LEFT JOIN leave_balances: We look for this user's specific balance.
        // 3. COALESCE: If the user has no balance record yet (new employee), 
        //    we assume they have the full 'default_days' available.
        
        const sql = `
            SELECT 
                lt.name as leave_type,
                lt.default_days as total_days,
                COALESCE(lb.remaining_days, lt.default_days) as available
            FROM leave_types lt
            LEFT JOIN leave_balances lb 
                ON lt.id = lb.leave_type_id AND lb.user_id = ?
            ORDER BY lt.id ASC
        `;

        const [rows] = await db.query(sql, [userId]);
        
        // Return the rows directly. 
        // The frontend will calculate 'used' by doing (total_days - available).
        res.json(rows);

    } catch (error) {
        console.error("Error fetching leave balance:", error);
        res.status(500).json({ error: error.message });
    }
};

// GET /api/leave-types
exports.getLeaveTypes = async (req, res) => {
    try {
        const sql = "SELECT * FROM leave_types ORDER BY id ASC";
        const [rows] = await db.query(sql);
        res.json(rows); 
        // Returns: [{"id": 1, "name": "Annual Leave", "default_days": 14}, ...]
    } catch (error) {
        console.error("Error fetching leave types:", error);
        res.status(500).json({ error: error.message });
    }
};

// GET /api/manager/pending-count
exports.getPendingCount = async (req, res) => {
    try {
        // Count all requests that are currently 'Pending'
        const sql = "SELECT COUNT(*) as count FROM leave_requests WHERE status = 'Pending'";
        const [rows] = await db.query(sql);
        
        // Return just the number (e.g., { "count": 5 })
        res.json({ count: rows[0].count });
    } catch (error) {
        console.error("Error counting pending requests:", error);
        res.status(500).json({ error: error.message });
    }
};