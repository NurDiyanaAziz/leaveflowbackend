const nodemailer = require('nodemailer');
const db = require('../db'); // Point this to your existing db connection file
const admin = require('../firebase');
// 1. Setup Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER, // Reads from .env
    pass: process.env.GMAIL_PASS  // Reads from .env
  }
});

// services/otp.controller.js

exports.requestOtp = async (req, res) => { // <--- Note the 'async' here
    console.log("📍 Step 1: Request received for", req.body.email);

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000);

    console.log("📍 Step 2: Attempting Database Update...");

    const sql = "UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE email = ?";

    try {
        // USE AWAIT HERE (Removes the callback mismatch)
        // Note: mysql2/promise returns an array [rows, fields], so we grab the first item
        const [result] = await db.query(sql, [otp, expiry, email]);

        console.log("📍 Step 3: Database responded.");

        // Check if user exists
        if (result.affectedRows === 0) {
            console.log("❌ Error: Email not found in DB");
            return res.status(404).json({ error: "Email not found" });
        }

        console.log("📍 Step 4: User found. Sending Email...");

        const mailOptions = {
            from: '"LeaveFlow Security" <didinaziz12340987@gmail.com>',
            to: email,
            subject: '🔒 Your Password Reset Code',
            html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                <h2 style="color: #004E96; text-align: center;">LeaveFlow</h2>
                <hr style="border: 0; border-top: 1px solid #eee;">
                
                <p style="font-size: 16px; color: #333;">Hello,</p>
                <p style="font-size: 16px; color: #555;">You requested a password reset. Use the code below to verify your identity. This code expires in 5 minutes.</p>
                
                <div style="background-color: #f4f8fb; padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #004E96;">${otp}</span>
                </div>
                
                <p style="font-size: 14px; color: #777;">If you did not request this, please ignore this email.</p>
                
                <hr style="border: 0; border-top: 1px solid #eee; margin-top: 30px;">
                <p style="text-align: center; font-size: 12px; color: #999;">&copy; 2026 LeaveFlow App. All rights reserved.</p>
            </div>
            `
        };

        // Send Email
        await transporter.sendMail(mailOptions); // <--- Await this too!
        
        console.log("✅ Email sent successfully");
        res.json({ message: "OTP sent to email" });

    } catch (err) {
        console.error("❌ Error occurred:", err);
        // Fallback: If email fails but DB worked, show the OTP in console so you can continue
        if (err.code === 'EAUTH' || err.command === 'AUTH') {
             console.log("⚠️ EMAIL FAILED (Auth/Network), BUT OTP IS: " + otp);
             return res.json({ message: "OTP generated (Check Console for code)" });
        }
        res.status(500).json({ error: "Server error" });
    }
};

// 3. Verify OTP
// 3. Verify OTP (Fixed: Async/Await to prevent loading hang)
exports.verifyOtp = async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) return res.status(400).json({ error: "Email and OTP required" });

    // Check if OTP matches AND is not expired
    const sql = "SELECT * FROM users WHERE email = ? AND otp_code = ? AND otp_expires_at > NOW()";
    
    try {
        // execute query
        const [results] = await db.query(sql, [email, otp]);

        if (results.length > 0) {
            // Success! Clear the OTP so it can't be reused
            await db.query("UPDATE users SET otp_code = NULL WHERE email = ?", [email]);
            
            console.log(`✅ OTP Verified for ${email}`);
            res.json({ message: "Verified", success: true });
        } else {
            console.log(`❌ Invalid/Expired OTP for ${email}`);
            res.status(400).json({ error: "Invalid or Expired OTP", success: false });
        }
    } catch (err) {
        console.error("❌ DB Verify Error:", err);
        res.status(500).json({ error: "Server error during verification" });
    }
};

// 4. Reset Password (The Final Step)
exports.resetPassword = async (req, res) => {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
        return res.status(400).json({ error: "Email and New Password required" });
    }

    try {
        console.log(`🔐 Attempting to reset password for: ${email}`);

        // 1. Get the User ID (UID) from Firebase using the email
        const userRecord = await admin.auth().getUserByEmail(email);
        
        // 2. Force the Password Update in Firebase
        await admin.auth().updateUser(userRecord.uid, {
            password: newPassword
        });

        console.log(`✅ Password successfully updated in Firebase for ${email}`);
        
        // 3. (Optional) You might want to clear any leftover OTPs in MySQL just to be clean
        // await db.query("UPDATE users SET otp_code = NULL WHERE email = ?", [email]);

        res.json({ message: "Password updated successfully!", success: true });

    } catch (error) {
        console.error("❌ Firebase Reset Error:", error);
        
        // Handle case where email doesn't exist in Firebase
        if (error.code === 'auth/user-not-found') {
             return res.status(404).json({ error: "User not found in Firebase" });
        }
        
        res.status(500).json({ error: "Failed to update password" });
    }
};