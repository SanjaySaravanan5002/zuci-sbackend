// Security fixes for the backend

// 1. Add CSRF protection middleware
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });

// 2. Input sanitization function
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/[\r\n\t]/g, '').trim();
}

// 3. Add authorization middleware to missing routes
// Add this to routes that are missing authorization:

// Example for routes/leads.js - Add auth middleware to these routes:
router.get('/stats/overview', auth, authorize('admin', 'superadmin'), async (req, res) => {
  // existing code
});

router.get('/washer/:washerId/onetime-washes', auth, authorize('admin', 'superadmin'), async (req, res) => {
  // existing code
});

router.get('/washer/:washerId/monthly-subscriptions', auth, authorize('admin', 'superadmin'), async (req, res) => {
  // existing code
});

// 4. Log sanitization - Replace console.log with sanitized logging
function safeLog(message, data) {
  if (data && typeof data === 'object') {
    // Remove sensitive fields
    const sanitizedData = { ...data };
    delete sanitizedData.password;
    delete sanitizedData.token;
    console.log(sanitizeInput(message), sanitizedData);
  } else {
    console.log(sanitizeInput(message), data ? sanitizeInput(data.toString()) : '');
  }
}

// 5. Environment variable validation
function validateEnvironment() {
  const required = ['MONGODB_URI', 'JWT_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// 6. Database query optimization
// Replace multiple sequential queries with Promise.all
async function getOptimizedDashboardData() {
  const [totalLeads, newToday, convertedLeads] = await Promise.all([
    Lead.countDocuments(query),
    Lead.countDocuments({ ...query, createdAt: { $gte: today } }),
    Lead.countDocuments({ ...query, status: 'Converted' })
  ]);
  
  return { totalLeads, newToday, convertedLeads };
}

module.exports = {
  csrfProtection,
  sanitizeInput,
  safeLog,
  validateEnvironment,
  getOptimizedDashboardData
};