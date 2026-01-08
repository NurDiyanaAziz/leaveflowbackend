const express = require('express');
const userRoutes = require('./routes/user_route');
const managerRoutes = require('./routes/manager_route'); 
// NOTE: Use a real logger like winston in a production app
// const logger = require('./logger'); 

const app = express();
const PORT = 3000;

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static('uploads'));

// --- API Routing ---
// All user-related routes (including registration) are prefixed with /api/users
app.use('/api/users', userRoutes);

app.use('/api/manager', managerRoutes);

// Basic Health Check Route
app.get('/', (req, res) => {
    res.status(200).send({ message: 'LeaveFlow API is running.' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Access backend via: http://localhost:${PORT}`);
});