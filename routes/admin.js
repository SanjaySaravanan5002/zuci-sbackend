const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

// Create Admin User (Only Superadmin can create)
router.post('/create-admin', auth, authorize('superadmin'), async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;

    // Validate role
    if (!['admin', 'limited_admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Only admin or limited_admin allowed.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      name,
      email,
      phone,
      role,
      password: hashedPassword,
      status: 'Active'
    });

    await user.save();

    res.status(201).json({
      message: `${role} user created successfully`,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upgrade Limited Admin to Admin (Superadmin only)
router.put('/upgrade-to-admin/:userId', auth, authorize('superadmin'), async (req, res) => {
  try {
    const { userId } = req.params;

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user is limited_admin
    if (user.role !== 'limited_admin') {
      return res.status(400).json({ message: 'Only limited_admin users can be upgraded to admin' });
    }

    // Upgrade to admin
    user.role = 'admin';
    await user.save();

    res.json({
      message: 'User successfully upgraded to admin',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create Superadmin (Initial setup only)
router.post('/create-superadmin', async (req, res) => {
  try {
    // Check if any superadmin exists
    const existingSuperadmin = await User.findOne({ role: 'superadmin' });
    if (existingSuperadmin) {
      return res.status(400).json({ message: 'Superadmin already exists' });
    }

    const { name, email, phone, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create superadmin
    const superadmin = new User({
      name,
      email,
      phone,
      role: 'superadmin',
      password: hashedPassword,
      status: 'Active'
    });

    await superadmin.save();

    res.status(201).json({
      message: 'Superadmin created successfully',
      user: {
        id: superadmin.id,
        name: superadmin.name,
        email: superadmin.email,
        role: superadmin.role,
        status: superadmin.status
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all users (Superadmin only)
router.get('/users', auth, authorize('superadmin'), async (req, res) => {
  try {
    const users = await User.find({ role: { $in: ['admin', 'limited_admin'] } })
      .select('-password')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;