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
    const { startDate, endDate, name, reason } = req.query;
    let query = {};
    
    // Date filter
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Name filter
    if (name) {
      query.washerName = { $regex: name, $options: 'i' };
    }
    
    // Reason filter
    if (reason) {
      query.reason = { $regex: reason, $options: 'i' };
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
    
    if (!washerName || !amount || !reason) {
      return res.status(400).json({ 
        success: false, 
        message: 'Washer name, amount, and reason are required' 
      });
    }
    
    const expense = new Expense({
      washerName,
      amount: parseFloat(amount),
      reason,
      date: date ? new Date(date) : new Date(),
      createdBy: req.user?.name || 'Admin'
    });
    
    await expense.save();
    res.json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update expense - Available to admin and superadmin
router.put('/:id', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const { washerName, amount, reason, date } = req.body;
    
    const expense = await Expense.findByIdAndUpdate(
      req.params.id,
      {
        washerName,
        amount: parseFloat(amount),
        reason,
        date: date ? new Date(date) : new Date()
      },
      { new: true }
    );
    
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    
    res.json({ success: true, expense });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete expense - Available to admin and superadmin
router.delete('/:id', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }
    res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get salary calculation data
router.get('/salary-calculation', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const { month, year, washerId } = req.query;
    const currentDate = new Date();
    const targetMonth = month ? parseInt(month) - 1 : currentDate.getMonth();
    const targetYear = year ? parseInt(year) : currentDate.getFullYear();
    
    const startDate = new Date(targetYear, targetMonth, 1);
    const endDate = new Date(targetYear, targetMonth + 1, 0);

    // Get all washers or specific washer
    const User = require('../models/User');
    let washerQuery = { role: 'washer', status: 'Active' };
    if (washerId) {
      washerQuery._id = washerId;
    }
    
    const washers = await User.find(washerQuery);
    const salaryData = [];

    for (const washer of washers) {
      // Get completed washes for this washer in the month
      const Lead = require('../models/Lead');
      const completedWashes = await Lead.aggregate([
        { $unwind: '$washHistory' },
        {
          $match: {
            'washHistory.washer': washer._id,
            'washHistory.washStatus': 'completed',
            'washHistory.date': {
              $gte: startDate,
              $lte: endDate
            }
          }
        },
        {
          $group: {
            _id: null,
            totalWashes: { $sum: 1 },
            totalRevenue: { $sum: '$washHistory.amount' }
          }
        }
      ]);

      // Get attendance data
      const attendanceData = washer.attendance.filter(att => {
        const attDate = new Date(att.date);
        return attDate >= startDate && attDate <= endDate;
      });

      const presentDays = attendanceData.filter(att => att.status === 'present').length;
      const totalWorkingDays = new Date(targetYear, targetMonth + 1, 0).getDate();

      // Calculate salary
      const baseSalary = washer.salary?.base || 0;
      const bonus = washer.salary?.bonus || 0;
      const washCount = completedWashes[0]?.totalWashes || 0;
      const revenue = completedWashes[0]?.totalRevenue || 0;
      
      // Simple salary calculation: base + (bonus per wash)
      const totalSalary = baseSalary + (bonus * washCount);
      const attendancePercentage = totalWorkingDays > 0 ? (presentDays / totalWorkingDays) * 100 : 0;

      salaryData.push({
        washerId: washer._id,
        washerName: washer.name,
        baseSalary,
        bonus,
        washCount,
        revenue,
        presentDays,
        totalWorkingDays,
        attendancePercentage: attendancePercentage.toFixed(1),
        totalSalary,
        month: targetMonth + 1,
        year: targetYear
      });
    }

    res.json({ success: true, salaryData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
