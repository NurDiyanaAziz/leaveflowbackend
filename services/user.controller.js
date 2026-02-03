const db = require('../db'); // Make sure this path points to your database connection

// 1. Annual Leave Rollover (The Admin Reset Button)
exports.rolloverLeaveYear = async (req, res) => {
    // --- IDS & RULES ---
    const ANNUAL_LEAVE_ID = 1; 
    const MEDICAL_LEAVE_ID = 2;
    
    // Annual Leave Rules
    const ANNUAL_BASE = 14;     // Fresh days for everyone
    const ANNUAL_MAX_CARRY = 7; // Max days to bring from last year
    
    // Medical Leave Rules (Standard Reset, No Carry Over)
    const MEDICAL_BASE = 14;    

    console.log("🔄 Starting Year-End Rollover...");

    try {
        // --- STEP 1: ANNUAL LEAVE (Complex Logic) ---
        // Logic: New Balance = 14 + (Lesser of Current Balance OR 7)
        const sqlAnnual = `
            UPDATE leave_balances 
            SET remaining_days = ? + LEAST(remaining_days, ?),
                last_updated_at = NOW()
            WHERE leave_type_id = ? AND remaining_days > 0;
        `;
        
        // Handle Annual Leave for people with 0 balance (Just give fresh 14)
        const sqlAnnualZero = `
            UPDATE leave_balances 
            SET remaining_days = ?, last_updated_at = NOW()
            WHERE leave_type_id = ? AND remaining_days <= 0;
        `;

        await db.query(sqlAnnual, [ANNUAL_BASE, ANNUAL_MAX_CARRY, ANNUAL_LEAVE_ID]);
        await db.query(sqlAnnualZero, [ANNUAL_BASE, ANNUAL_LEAVE_ID]);
        console.log("✅ Annual Leave Rollover Complete.");


        // --- STEP 2: MEDICAL LEAVE (Simple Reset) ---
        // Logic: Everyone just resets to 14. No math.
        const sqlMedical = `
            UPDATE leave_balances
            SET remaining_days = ?, last_updated_at = NOW()
            WHERE leave_type_id = ?;
        `;

        await db.query(sqlMedical, [MEDICAL_BASE, MEDICAL_LEAVE_ID]);
        console.log("✅ Medical Leave Reset Complete.");


        // --- SUCCESS RESPONSE ---
        res.json({ 
            message: "Year-End Processing Successful!", 
            details: {
                annual: `Rollover applied (Base ${ANNUAL_BASE} + Max Carry ${ANNUAL_MAX_CARRY})`,
                medical: `Reset to flat ${MEDICAL_BASE} days`
            }
        });

    } catch (error) {
        console.error("❌ Rollover Error:", error);
        res.status(500).json({ error: error.message });
    }
};
