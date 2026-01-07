const mysql = require('mysql2/promise');
// REQUIRE: Load environment variables from .env file
require('dotenv').config(); 

// NOTE: Create a .env file in your backend folder with these variables:
// DB_HOST=localhost
// DB_USER=root
// DB_PASSWORD=your_actual_mysql_password
// DB_DATABASE=leaveflowdb

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',      // Reads from .env
    user: process.env.DB_USER || 'root',          // Reads from .env
    password: process.env.DB_PASSWORD || 'root',           // Reads from .env (REQUIRED)
    database: process.env.DB_DATABASE || 'leaveflowdb', // Reads from .env
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Export a simple function to execute queries
module.exports = {
    query: (sql, params) => pool.execute(sql, params),
    pool: pool // Export the pool for transactional use
};