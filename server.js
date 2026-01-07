const express = require('express');
const bodyParser = require('body-parser');
const userRoutes = require('./routes/user_route');
const leaveRequestRoute = require('./routes/leave_request_route');
// NOTE: Use a real logger like winston in a production app
// const logger = require('./logger'); 

const app = express();
const PORT = 3000;

// Middleware setup
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- API Routing ---
// All user-related routes (including registration) are prefixed with /api/users
app.use('/api/users', userRoutes);
app.use('/api/requests', leaveRequestRoute);

// Basic Health Check Route
app.get('/', (req, res) => {
    res.status(200).send({ message: 'LeaveFlow API is running.' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Access backend via: http://localhost:${PORT}`);
});