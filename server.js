// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import configuration
const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');

// Import models
require('./models/User');
require('./models/Counter');
require('./models/Lead');
require('./models/Expense');
const WashPackage = require('./models/WashPackage');

// Import routes
const leadsRouter = require('./routes/leads');
const washerRouter = require('./routes/washer');
const reportsRouter = require('./routes/reports');
const dashboardRouter = require('./routes/dashboard');
const authRouter = require('./routes/auth');
const expensesRouter = require('./routes/expenses');
const adminRouter = require('./routes/admin');
const washAssignmentRouter = require('./routes/washAssignment');
const scheduleWashRouter = require('./routes/scheduleWash');
const dynamicAssignmentRouter = require('./routes/dynamicAssignment');
const calendarAssignmentRouter = require('./routes/calendarAssignment');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
connectDB().then(async () => {
  // Initialize default wash packages
  await WashPackage.initializeDefaults();
  console.log('✅ Default wash packages initialized');
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
app.use('/api/expenses', expensesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/wash-assignment', washAssignmentRouter);
app.use('/api/schedule', scheduleWashRouter);
app.use('/api/schedule', dynamicAssignmentRouter);
app.use('/api/schedule', calendarAssignmentRouter);

// Global error handling middleware
app.use(errorHandler);

// Handle 404 routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
