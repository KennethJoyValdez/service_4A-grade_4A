// 1. Import necessary libraries
const express = require('express');
const cors = require('cors');
require('dotenv').config(); // Allows use of .env files

// 2. Initialize the application
const app = express();
const PORT = process.env.PORT || 3000;

// 3. Middleware Configuration
// Enables Cross-Origin Resource Sharing (allows frontend to talk to backend)
app.use(cors()); 
// Parses incoming JSON requests (replaces body-parser)
app.use(express.json());
// Serves static files from a 'public' folder (optional)
app.use(express.static('public')); 

// 4. Define Routes
// Basic Health Check Route
app.get('/', (req, res) => {
    res.status(200).send('API is running successfully!');
});

// Example API Endpoint
app.get('/api/data', (req, res) => {
    res.json({
        message: "Here is your data",
        timestamp: new Date()
    });
});

// 404 Handler (for unknown routes)
app.use((req, res) => {
    res.status(404).send('404: Page not found');
});

// 5. Start the Server
app.listen(PORT, () => {
    console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop the server\n`);
});