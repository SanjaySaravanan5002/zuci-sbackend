const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

// Get all washers - Available to admin and superadmin
router.get('/washers', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const washers = await User.find({ role: 'washer', status: 'Active' }, 'name').sort({ name: 1 });
    res.json({ success: true, washers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all expenses - Available to admin and superadmin
router.get('/', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const expenses = await Expense.find(query).sort({ date: -1 });
    res.json({ success: true, expenses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add new expense - Available to admin and superadmin
router.post('/', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const { washerName, amount, reason, date } = req.body;
    
    const expense = new Expense({
      washerName,
      amount,
      reason,
      date: date || new Date()
    });
    
    await expense.save();
    res.json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete expense - Available to admin and superadmin
router.delete('/:id', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    await Expense.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;