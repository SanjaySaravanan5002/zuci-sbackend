const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = mongoose.model('User');
const bcrypt = require('bcryptjs');

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user & get token
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // For demo purposes, we're using simple authentication
    // In production, you should use proper password hashing
    
    // Find user by email
    const user = await User.findOne({ email });

    // Check if user exists
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password using bcrypt.compare
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // User matched, create token (in a real app, use JWT)
    const token = `mock_jwt_token_${user.role}_${Date.now()}`;

    // Return user info without password and with token
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get('/me', async (req, res) => {
  try {
    // In a real app, this would verify the JWT token
    // and return the user based on the token payload
    
    // Mock implementation - extract user info from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const token = authHeader.split(' ')[1];
    const tokenParts = token.split('_');
    
    if (tokenParts.length < 3 || tokenParts[0] !== 'mock' || tokenParts[1] !== 'jwt') {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const role = tokenParts[2];
    
    // Find first user with matching role (simplified for demo)
    const user = await User.findOne({ role });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Return user without password
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
