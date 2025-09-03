const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid token.' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Invalid token.' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        message: 'Authentication required.' 
      });
    }
    
    if (!roles.includes(req.user.role)) {
      console.log(`Access denied for role: ${req.user.role}, required: ${roles.join(', ')}`);
      return res.status(403).json({ 
        message: 'Access denied. Insufficient permissions.',
        userRole: req.user.role,
        requiredRoles: roles
      });
    }
    next();
  };
};

// Helper function to check if user has admin privileges
const isAdmin = (user) => {
  return user && ['superadmin', 'admin'].includes(user.role);
};

// Helper function to check if user has any admin privileges (including limited_admin)
const hasAdminAccess = (user) => {
  return user && ['superadmin', 'admin', 'limited_admin'].includes(user.role);
};

module.exports = { auth, authorize, isAdmin, hasAdminAccess };