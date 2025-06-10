// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Import models
require('./models/User');
require('./models/Counter');
require('./models/Lead');

// Import routes
const leadsRouter = require('./routes/leads');
const washerRouter = require('./routes/washer');
const reportsRouter = require('./routes/reports');
const dashboardRouter = require('./routes/dashboard');
const authRouter = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Error handling middleware for MongoDB
mongoose.connection.on('error', err => {
  console.error('MongoDB error:', err);
});

// Routes
app.get('/', (req, res) => {
  res.send('Zuci CRM Backend is running');
});

// API routes
app.use('/api/leads', leadsRouter);
app.use('/api/washer', washerRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/auth', authRouter);

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
