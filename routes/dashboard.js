const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');
const Expense = require('../models/Expense');
const { auth, authorize } = require('../middleware/auth');

// Test endpoint to check dashboard connectivity
router.get('/test', (req, res) => {
  res.json({ message: 'Dashboard API is working', timestamp: new Date().toISOString() });
});

// Clear ALL attendance data and reset to empty
router.post('/clear-sample-attendance', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const result = await User.updateMany(
      { role: 'washer' },
      { $set: { attendance: [] } }
    );
    
    res.json({ 
      message: 'All attendance data cleared successfully - now showing real values only',
      washersUpdated: result.modifiedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Test endpoint to check washers and create sample data
router.get('/test-washers', async (req, res) => {
  try {
    const washers = await User.find({ role: 'washer' });
    
    if (washers.length === 0) {
      const sampleWasher = new User({
        name: 'Sample Washer',
        phone: '9999999999',
        email: 'washer@test.com',
        role: 'washer',
        password: 'password123',
        area: 'Test Area',
        status: 'Active',
        attendance: [{
          date: new Date(),
          timeIn: new Date(),
          status: 'present',
          duration: 8
        }]
      });
      await sampleWasher.save();
      
      res.json({ 
        message: 'Created sample washer', 
        washers: [sampleWasher],
        count: 1
      });
    } else {
      res.json({ 
        message: 'Washers found', 
        washers: washers.map(w => ({ id: w.id, name: w.name, role: w.role })),
        count: washers.length
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to get date range based on range type
const getDateRange = (rangeType) => {
  const currentDate = new Date();
  const startDate = new Date(currentDate);
  
  switch (rangeType) {
    case '1d':
      startDate.setDate(currentDate.getDate() - 1);
      break;
    case '3d':
      startDate.setDate(currentDate.getDate() - 3);
      break;
    case '5d':
      startDate.setDate(currentDate.getDate() - 5);
      break;
    case '7d':
      startDate.setDate(currentDate.getDate() - 7);
      break;
    case '2w':
      startDate.setDate(currentDate.getDate() - 14);
      break;
    case '1m':
      startDate.setMonth(currentDate.getMonth() - 1);
      break;
    case '3m':
      startDate.setMonth(currentDate.getMonth() - 3);
      break;
    default:
      startDate.setMonth(currentDate.getMonth() - 1);
  }

  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(currentDate);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
};

// Get dashboard stats with dynamic date filtering
router.get('/stats', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    let startDate, endDate;
    
    if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate);
      endDate = new Date(req.query.endDate);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else {
      const range = req.query.range || '1m';
      const dateRange = getDateRange(range);
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
    }
    
    console.log('Dashboard stats - Date range:', { startDate, endDate });
    
    const duration = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - duration);
    const prevEndDate = new Date(startDate);
    
    const lead = await Lead.find();
    const periodCustomers = await Lead.distinct('customerName', {
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const leads = await Lead.find({
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    // Get active customers (those with washes in the date range)
    const activeCustomers = await Lead.countDocuments({
      $or: [
        { 'washHistory.date': { $gte: startDate, $lte: endDate } },
        { 'monthlySubscription.scheduledWashes.scheduledDate': { $gte: startDate, $lte: endDate } }
      ]
    });
    
    // Get today's leads
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    
    const todayLeadsCount = await Lead.countDocuments({
      createdAt: { $gte: todayStart, $lte: todayEnd }
    });
    
    // Calculate conversion rate for the period
    const totalLeadsInPeriod = leads.length;
    const convertedLeads = await Lead.countDocuments({
      createdAt: { $gte: startDate, $lte: endDate },
      $or: [
        { 'washHistory.0': { $exists: true } },
        { 'monthlySubscription': { $exists: true } }
      ]
    });
    
    const conversionRate = totalLeadsInPeriod > 0 ? ((convertedLeads / totalLeadsInPeriod) * 100).toFixed(1) : 0;

    // Calculate revenue using aggregation for better performance and accuracy
    const revenueFromWashHistory = await Lead.aggregate([
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.washStatus': 'completed',
          'washHistory.is_amountPaid': true,
          'washHistory.date': { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$washHistory.amount' }
        }
      }
    ]);
    
    const revenueFromSubscriptions = await Lead.aggregate([
      { $unwind: '$monthlySubscription.scheduledWashes' },
      {
        $match: {
          'monthlySubscription.scheduledWashes.status': 'completed',
          'monthlySubscription.scheduledWashes.is_amountPaid': true,
          'monthlySubscription.scheduledWashes.completedDate': { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$monthlySubscription.scheduledWashes.amount' }
        }
      }
    ]);
    
    const income = (revenueFromWashHistory[0]?.totalRevenue || 0) + (revenueFromSubscriptions[0]?.totalRevenue || 0);
    
    console.log('Revenue calculation:', {
      washHistoryRevenue: revenueFromWashHistory[0]?.totalRevenue || 0,
      subscriptionRevenue: revenueFromSubscriptions[0]?.totalRevenue || 0,
      totalIncome: income,
      dateRange: { startDate, endDate }
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayLeads = await Lead.countDocuments({
      createdAt: { $gte: startOfDay }
    });

    const prevPeriodCustomers = await Lead.distinct('customerName', {
      createdAt: { $gte: prevStartDate, $lte: prevEndDate }
    });

    const prevPeriodLeads = await Lead.find({
      createdAt: { $gte: prevStartDate, $lte: prevEndDate }
    });

    // Calculate previous period revenue using aggregation
    const prevRevenueFromWashHistory = await Lead.aggregate([
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.washStatus': 'completed',
          'washHistory.is_amountPaid': true,
          'washHistory.date': { $gte: prevStartDate, $lt: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$washHistory.amount' }
        }
      }
    ]);
    
    const prevRevenueFromSubscriptions = await Lead.aggregate([
      { $unwind: '$monthlySubscription.scheduledWashes' },
      {
        $match: {
          'monthlySubscription.scheduledWashes.status': 'completed',
          'monthlySubscription.scheduledWashes.is_amountPaid': true,
          'monthlySubscription.scheduledWashes.completedDate': { $gte: prevStartDate, $lt: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$monthlySubscription.scheduledWashes.amount' }
        }
      }
    ]);
    
    const prevPeriodIncome = (prevRevenueFromWashHistory[0]?.totalRevenue || 0) + (prevRevenueFromSubscriptions[0]?.totalRevenue || 0);

    const customerChange = prevPeriodCustomers.length > 0 
      ? ((periodCustomers.length - prevPeriodCustomers.length) / prevPeriodCustomers.length) * 100
      : 0;
    const incomeChange = prevPeriodIncome > 0
      ? ((income - prevPeriodIncome) / prevPeriodIncome) * 100
      : 0;

    const yesterday = new Date(startOfDay);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayLeads = await Lead.countDocuments({
      createdAt: { $gte: yesterday, $lt: startOfDay }
    });

    const leadsChange = yesterdayLeads > 0
      ? ((todayLeads - yesterdayLeads) / yesterdayLeads * 100).toFixed(1)
      : 0;

    // Get expenses using aggregation for better performance
    const expenseResult = await Expense.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalExpenses: { $sum: '$amount' }
        }
      }
    ]);
    
    const prevExpenseResult = await Expense.aggregate([
      {
        $match: {
          date: { $gte: prevStartDate, $lt: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalExpenses: { $sum: '$amount' }
        }
      }
    ]);
    
    const totalExpenses = expenseResult[0]?.totalExpenses || 0;
    const prevTotalExpenses = prevExpenseResult[0]?.totalExpenses || 0;
    
    console.log('Expense calculation:', {
      currentExpenses: totalExpenses,
      prevExpenses: prevTotalExpenses,
      dateRange: { startDate, endDate }
    });
    
    const expenseChange = prevTotalExpenses > 0 ? ((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100 : 0;
    
    console.log('Dashboard stats results:', {
      income,
      totalExpenses,
      activeCustomers,
      todayLeadsCount,
      conversionRate
    });

    res.json({
      activeCustomers: {
        value: activeCustomers,
        change: parseFloat(customerChange.toFixed(1)),
        increasing: parseFloat(customerChange) > 0
      },
      income: {
        value: Math.round(income),
        change: parseFloat(incomeChange.toFixed(1)),
        increasing: parseFloat(incomeChange) > 0
      },
      expenses: {
        value: Math.round(totalExpenses),
        change: parseFloat(expenseChange.toFixed(1)),
        increasing: parseFloat(expenseChange) > 0
      },
      todayLeads: {
        value: todayLeadsCount,
        change: parseFloat(leadsChange),
        increasing: parseFloat(leadsChange) > 0
      },
      conversionRate: {
        value: parseFloat(conversionRate),
        total: totalLeadsInPeriod,
        converted: convertedLeads
      }
    });
  } catch (error) {
    console.error('Error in /stats:', error);
    res.status(500).json({ 
      error: error.message,
      activeCustomers: { value: 0, change: 0, increasing: true },
      income: { value: 0, change: 0, increasing: true },
      todayLeads: { value: 0, change: 0, increasing: true },
      conversionRate: { value: 0, total: 0, converted: 0 }
    });
  }
});

// Get lead acquisition data (last 7 days)
router.get('/lead-acquisition', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const data = [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);
      
      const monthlyCount = await Lead.countDocuments({
        leadType: 'Monthly',
        createdAt: { $gte: date, $lt: nextDate }
      });

      const oneTimeCount = await Lead.countDocuments({
        leadType: 'One-time',
        createdAt: { $gte: date, $lt: nextDate }
      });
      
      data.push({
        date: date.toISOString().split('T')[0],
        monthlyCount,
        oneTimeCount
      });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Error in /lead-acquisition:', error);
    res.status(500).json({ error: error.message });
  }
});



// Get recent leads
router.get('/recent-leads', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const recentLeads = await Lead.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate({
        path: 'assignedWasher',
        select: 'name'
      })
      .select('customerName phone area leadType leadSource carModel status createdAt assignedWasher')
      .lean();

    const formattedLeads = recentLeads.map(lead => ({
      id: lead._id,
      customerName: lead.customerName,
      phone: lead.phone,
      area: lead.area,
      leadType: lead.leadType,
      leadSource: lead.leadSource,
      carModel: lead.carModel,
      assignedWasher: lead.assignedWasher ? lead.assignedWasher.name : null,
      date: lead.createdAt,
      status: lead.status
    }));

    res.json(formattedLeads);
  } catch (error) {
    console.error('Error in /recent-leads:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get washer attendance analytics with real-time data
router.get('/washer-attendance', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      const today = new Date();
      start = new Date(today);
      end = new Date(today);
    }
    
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    
    const washers = await User.find({ role: 'washer' }).select('id name email phone attendance status');
    
    if (washers.length === 0) {
      return res.json([]);
    }
    
    const attendanceData = [];
    
    for (const washer of washers) {
      // Get today's attendance record
      const todayAttendance = washer.attendance ? washer.attendance.find(att => {
        const attDate = new Date(att.date);
        return attDate.toDateString() === start.toDateString();
      }) : null;
      
      // Get attendance records in the selected date range
      const attendanceInRange = washer.attendance ? washer.attendance.filter(att => {
        const attDate = new Date(att.date);
        return attDate >= start && attDate <= end;
      }) : [];
      
      // Count present days (those with both timeIn and timeOut)
      const presentDays = attendanceInRange.filter(att => att.timeIn && att.timeOut).length;
      const incompleteDays = attendanceInRange.filter(att => att.timeIn && !att.timeOut).length;
      const totalDays = Math.max(attendanceInRange.length, 1); // Avoid division by zero
      
      // Calculate total hours from actual clock-in/out times
      const totalHours = attendanceInRange.reduce((sum, att) => {
        if (att.timeIn && att.timeOut) {
          const timeInDate = new Date(att.timeIn);
          const timeOutDate = new Date(att.timeOut);
          const durationMs = timeOutDate.getTime() - timeInDate.getTime();
          const durationHours = durationMs / (1000 * 60 * 60);
          return sum + (durationHours > 0 ? durationHours : 0);
        }
        return sum;
      }, 0);
      
      // Determine current status based on today's attendance
      let currentStatus = 'absent';
      let timeIn = null;
      let timeOut = null;
      
      if (todayAttendance) {
        timeIn = todayAttendance.timeIn;
        timeOut = todayAttendance.timeOut;
        
        if (timeIn && timeOut) {
          currentStatus = 'completed';
        } else if (timeIn && !timeOut) {
          currentStatus = 'active';
        }
      }
      
      // Format recent attendance for display
      const recentAttendance = washer.attendance ? washer.attendance
        .filter(att => {
          const attDate = new Date(att.date);
          return attDate >= start && attDate <= end;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 30)
        .map(att => {
          let calculatedDuration = 0;
          if (att.timeIn && att.timeOut) {
            const timeInDate = new Date(att.timeIn);
            const timeOutDate = new Date(att.timeOut);
            const durationMs = timeOutDate.getTime() - timeInDate.getTime();
            calculatedDuration = durationMs / (1000 * 60 * 60); // Duration in hours
          }
          return {
            date: att.date,
            timeIn: att.timeIn,
            timeOut: att.timeOut,
            duration: calculatedDuration,
            status: att.timeIn && att.timeOut ? 'present' : att.timeIn ? 'incomplete' : 'absent'
          };
        }) : [];
      
      // Show all washers with real attendance data (no fake data)
      attendanceData.push({
        id: washer.id,
        name: washer.name,
        email: washer.email,
        phone: washer.phone,
        status: washer.status,
        currentStatus,
        timeIn,
        timeOut,
        presentDays,
        incompleteDays,
        totalDays: attendanceInRange.length || 0,
        totalHours: parseFloat(totalHours.toFixed(1)),
        attendancePercentage: attendanceInRange.length > 0 ? ((presentDays / attendanceInRange.length) * 100).toFixed(1) : '0.0',
        recentAttendance
      });
    }
    
    res.json(attendanceData);
  } catch (error) {
    console.error('Error in /washer-attendance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get revenue by service type
router.get('/revenue-by-service', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    
    const leads = await Lead.find({});
    const serviceRevenue = {};
    
    leads.forEach(lead => {
      if (lead.washHistory && lead.washHistory.length > 0) {
        lead.washHistory.forEach(wash => {
          if (wash.is_amountPaid && new Date(wash.date) >= firstDayOfMonth) {
            serviceRevenue[wash.washType] = (serviceRevenue[wash.washType] || 0) + wash.amount;
          }
        });
      }
      
      if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
        lead.monthlySubscription.scheduledWashes.forEach(wash => {
          if (wash.is_amountPaid && wash.completedDate && new Date(wash.completedDate) >= firstDayOfMonth) {
            const packageType = lead.monthlySubscription.packageType;
            serviceRevenue[packageType] = (serviceRevenue[packageType] || 0) + (wash.amount || 0);
          }
        });
      }
    });
    
    res.json(Object.entries(serviceRevenue).map(([type, amount]) => ({
      serviceType: type,
      revenue: amount
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get lead source analytics
router.get('/lead-sources', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    
    const leads = await Lead.aggregate([
      {
        $match: {
          createdAt: { $gte: firstDayOfMonth }
        }
      },
      {
        $addFields: {
          hasWashHistory: {
            $cond: [
              { $ifNull: ['$washHistory', false] },
              { $gt: [{ $size: { $ifNull: ['$washHistory', []] } }, 0] },
              false
            ]
          }
        }
      },
      {
        $group: {
          _id: '$leadSource',
          count: { $sum: 1 },
          convertedCount: {
            $sum: { $cond: ['$hasWashHistory', 1, 0] }
          }
        }
      }
    ]);
    
    const formattedData = leads.map(source => ({
      source: source._id,
      totalLeads: source.count,
      convertedLeads: source.convertedCount,
      conversionRate: ((source.convertedCount / source.count) * 100).toFixed(1)
    }));
    
    res.json(formattedData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get area-wise distribution
router.get('/area-distribution', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const areaStats = await Lead.aggregate([
      {
        $group: {
          _id: '$area',
          totalLeads: { $sum: 1 },
          activeCustomers: {
            $sum: {
              $cond: [{ $eq: ['$leadType', 'Monthly'] }, 1, 0]
            }
          }
        }
      }
    ]);
    
    res.json(areaStats.map(area => ({
      area: area._id,
      totalLeads: area.totalLeads,
      activeCustomers: area.activeCustomers
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get customer feedback analytics
router.get('/feedback-analytics', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    
    const leads = await Lead.find({
      'washHistory.date': { $gte: firstDayOfMonth },
      'washHistory.feedback': { $exists: true }
    });
    
    const feedbackCount = {
      total: 0,
      withFeedback: 0
    };
    
    leads.forEach(lead => {
      if (lead.washHistory && lead.washHistory.length > 0) {
        lead.washHistory.forEach(wash => {
          if (new Date(wash.date) >= firstDayOfMonth) {
            feedbackCount.total++;
            if (wash.feedback) {
              feedbackCount.withFeedback++;
            }
          }
        });
      }
    });
    
    res.json({
      totalServices: feedbackCount.total,
      feedbackReceived: feedbackCount.withFeedback,
      feedbackRate: feedbackCount.total > 0 ? ((feedbackCount.withFeedback / feedbackCount.total) * 100).toFixed(1) : '0'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get today's and tomorrow's wash count with date filtering
router.get('/today-tomorrow-wash-count', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    let startDate, endDate;
    
    if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate);
      endDate = new Date(req.query.endDate);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    const todayResult = await Lead.aggregate([
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.date': {
            $gte: today,
            $lt: tomorrow
          }
        }
      },
      { $count: 'count' }
    ]);

    const tomorrowResult = await Lead.aggregate([
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.date': {
            $gte: tomorrow,
            $lt: dayAfterTomorrow
          }
        }
      },
      { $count: 'count' }
    ]);
    
    // Also get wash count for the selected date range
    const rangeResult = await Lead.aggregate([
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.date': {
            $gte: startDate,
            $lte: endDate
          }
        }
      },
      { $count: 'count' }
    ]);
    
    res.json({
      todayCount: todayResult[0]?.count || 0,
      tomorrowCount: tomorrowResult[0]?.count || 0,
      rangeCount: rangeResult[0]?.count || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get customer statistics
router.get('/customer-stats', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    
    // Get all leads
    const allLeads = await Lead.find({});
    
    // Calculate total revenue from paid washes
    let totalRevenue = 0;
    let totalWashes = 0;
    
    allLeads.forEach(lead => {
      if (lead.washHistory && lead.washHistory.length > 0) {
        lead.washHistory.forEach(wash => {
          if (wash.is_amountPaid) {
            totalRevenue += wash.amount || 0;
            totalWashes++;
          }
        });
      }
      
      if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
        lead.monthlySubscription.scheduledWashes.forEach(wash => {
          if (wash.is_amountPaid) {
            totalRevenue += wash.amount || 0;
            totalWashes++;
          }
        });
      }
    });
    
    // Get unique customers
    const totalCustomers = await Lead.distinct('customerName');
    
    // Get unique areas
    const activeAreas = await Lead.distinct('area');
    
    // Get monthly customers (this month)
    const monthlyCustomers = await Lead.countDocuments({
      leadType: 'Monthly',
      createdAt: { $gte: firstDayOfMonth }
    });
    
    // Calculate monthly percentage
    const monthlyPercentage = totalCustomers.length > 0 
      ? ((monthlyCustomers / totalCustomers.length) * 100).toFixed(1)
      : '0.0';
    
    res.json({
      totalRevenue,
      totalCustomers: totalCustomers.length,
      totalWashes,
      activeAreas: activeAreas.length,
      monthlyCustomers,
      monthlyPercentage
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get revenue stats with date filtering (using same logic as revenue module)
router.get('/revenue-stats', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    let startDate, endDate;
    
    if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate);
      endDate = new Date(req.query.endDate);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else {
      const range = req.query.range || '1m';
      const dateRange = getDateRange(range);
      startDate = dateRange.startDate;
      endDate = dateRange.endDate;
    }
    
    const duration = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - duration);
    
    // Calculate current period revenue using aggregation
    const currentWashRevenue = await Lead.aggregate([
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.washStatus': 'completed',
          'washHistory.is_amountPaid': true,
          'washHistory.date': { $gte: startDate, $lte: endDate }
        }
      },
      { $group: { _id: null, total: { $sum: '$washHistory.amount' } } }
    ]);
    
    const currentSubscriptionRevenue = await Lead.aggregate([
      { $unwind: '$monthlySubscription.scheduledWashes' },
      {
        $match: {
          'monthlySubscription.scheduledWashes.status': 'completed',
          'monthlySubscription.scheduledWashes.is_amountPaid': true,
          'monthlySubscription.scheduledWashes.completedDate': { $gte: startDate, $lte: endDate }
        }
      },
      { $group: { _id: null, total: { $sum: '$monthlySubscription.scheduledWashes.amount' } } }
    ]);
    
    const currentRevenue = (currentWashRevenue[0]?.total || 0) + (currentSubscriptionRevenue[0]?.total || 0);
    
    // Calculate previous period revenue using aggregation
    const prevWashRevenue = await Lead.aggregate([
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.washStatus': 'completed',
          'washHistory.is_amountPaid': true,
          'washHistory.date': { $gte: prevStartDate, $lt: startDate }
        }
      },
      { $group: { _id: null, total: { $sum: '$washHistory.amount' } } }
    ]);
    
    const prevSubscriptionRevenue = await Lead.aggregate([
      { $unwind: '$monthlySubscription.scheduledWashes' },
      {
        $match: {
          'monthlySubscription.scheduledWashes.status': 'completed',
          'monthlySubscription.scheduledWashes.is_amountPaid': true,
          'monthlySubscription.scheduledWashes.completedDate': { $gte: prevStartDate, $lt: startDate }
        }
      },
      { $group: { _id: null, total: { $sum: '$monthlySubscription.scheduledWashes.amount' } } }
    ]);
    
    const prevRevenue = (prevWashRevenue[0]?.total || 0) + (prevSubscriptionRevenue[0]?.total || 0);
    
    const revenueChange = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue) * 100 : 0;
    
    console.log('Revenue stats:', { currentRevenue, prevRevenue, revenueChange, startDate, endDate });
    
    res.json({
      value: Math.round(currentRevenue),
      change: parseFloat(revenueChange.toFixed(1)),
      increasing: revenueChange >= 0
    });
  } catch (error) {
    console.error('Error in /revenue-stats:', error);
    res.status(500).json({ 
      error: error.message,
      value: 0,
      change: 0,
      increasing: true
    });
  }
});

// Get direct revenue for dashboard (total revenue like revenue report)
router.get('/direct-revenue', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    // Get all leads and calculate total revenue (no date filter for total)
    const leads = await Lead.find({}).lean();
    
    let totalRevenue = 0;
    
    leads.forEach(lead => {
      // Revenue from wash history (completed and paid)
      if (lead.washHistory && lead.washHistory.length > 0) {
        lead.washHistory.forEach(wash => {
          if (wash.washStatus === 'completed' && wash.is_amountPaid === true) {
            totalRevenue += parseFloat(wash.amount) || 0;
          }
        });
      }
      
      // Revenue from monthly subscriptions (completed and paid)
      if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
        lead.monthlySubscription.scheduledWashes.forEach(wash => {
          if (wash.status === 'completed' && wash.is_amountPaid === true) {
            totalRevenue += parseFloat(wash.amount) || 0;
          }
        });
      }
    });
    
    res.json({
      value: Math.round(totalRevenue),
      change: 0,
      increasing: true
    });
  } catch (error) {
    console.error('Error in /direct-revenue:', error);
    res.status(500).json({ 
      value: 0,
      change: 0,
      increasing: true
    });
  }
});

// Get expenses stats with date filtering
router.get('/expenses-stats', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    let startDate, endDate;
    
    if (req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate);
      endDate = new Date(req.query.endDate);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Default to all time if no dates provided
      const allExpenses = await Expense.find({});
      const totalExpenses = allExpenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
      
      return res.json({
        value: Math.round(totalExpenses),
        change: 0,
        increasing: false
      });
    }
    
    // Calculate expenses using aggregation
    const currentExpenses = await Expense.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    // Calculate previous period for comparison
    const duration = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - duration);
    
    const prevExpenses = await Expense.aggregate([
      {
        $match: {
          date: { $gte: prevStartDate, $lt: startDate }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const totalExpenses = currentExpenses[0]?.total || 0;
    const prevTotalExpenses = prevExpenses[0]?.total || 0;
    
    const expenseChange = prevTotalExpenses > 0 ? ((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100 : 0;
    
    res.json({
      value: Math.round(totalExpenses),
      change: parseFloat(expenseChange.toFixed(1)),
      increasing: expenseChange > 0
    });
  } catch (error) {
    console.error('Error in /expenses-stats:', error);
    res.status(500).json({ 
      error: error.message,
      value: 0,
      change: 0,
      increasing: false
    });
  }
});

// Get washer performance metrics
router.get('/washer-performance', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Default to current month if no dates provided
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    
    // Get all washers
    const washers = await User.find({ role: 'washer' }).lean();
    
    if (washers.length === 0) {
      return res.json({
        totalWashers: 0,
        activeWashers: 0,
        totalWashes: 0,
        avgRating: 0,
        avgAttendance: 0,
        washers: []
      });
    }
    
    const washerPerformance = [];
    let totalWashes = 0;
    let totalRatings = 0;
    let ratingCount = 0;
    let totalAttendancePercentage = 0;
    let activeWashers = 0;
    
    for (const washer of washers) {
      // Get washes assigned to this washer in the date range
      const washHistory = await Lead.aggregate([
        { $unwind: '$washHistory' },
        {
          $match: {
            'washHistory.washer': washer._id,
            'washHistory.date': { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: null,
            totalWashes: { $sum: 1 },
            completedWashes: {
              $sum: { $cond: [{ $eq: ['$washHistory.washStatus', 'completed'] }, 1, 0] }
            },
            totalEarnings: {
              $sum: { $cond: [{ $eq: ['$washHistory.is_amountPaid', true] }, '$washHistory.amount', 0] }
            },
            ratings: {
              $push: {
                $cond: [
                  { $and: [{ $ne: ['$washHistory.feedback', null] }, { $ne: ['$washHistory.feedback', ''] }] },
                  4, // Default rating when feedback exists
                  null
                ]
              }
            }
          }
        }
      ]);
      
      // Get monthly subscription washes
      const monthlyWashes = await Lead.aggregate([
        { $unwind: '$monthlySubscription.scheduledWashes' },
        {
          $match: {
            'monthlySubscription.scheduledWashes.washer': washer._id,
            'monthlySubscription.scheduledWashes.scheduledDate': { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: null,
            totalWashes: { $sum: 1 },
            completedWashes: {
              $sum: { $cond: [{ $eq: ['$monthlySubscription.scheduledWashes.status', 'completed'] }, 1, 0] }
            },
            totalEarnings: {
              $sum: { $cond: [{ $eq: ['$monthlySubscription.scheduledWashes.is_amountPaid', true] }, '$monthlySubscription.scheduledWashes.amount', 0] }
            }
          }
        }
      ]);
      
      const washData = washHistory[0] || { totalWashes: 0, completedWashes: 0, totalEarnings: 0, ratings: [] };
      const monthlyData = monthlyWashes[0] || { totalWashes: 0, completedWashes: 0, totalEarnings: 0 };
      
      const washerTotalWashes = washData.totalWashes + monthlyData.totalWashes;
      const washerCompletedWashes = washData.completedWashes + monthlyData.completedWashes;
      const washerEarnings = washData.totalEarnings + monthlyData.totalEarnings;
      
      // Calculate success rate
      const successRate = washerTotalWashes > 0 ? Math.round((washerCompletedWashes / washerTotalWashes) * 100) : 0;
      
      // Calculate average rating from feedback
      const validRatings = washData.ratings.filter(r => r !== null);
      const avgRating = validRatings.length > 0 ? validRatings.reduce((sum, r) => sum + r, 0) / validRatings.length : 0;
      
      // Calculate attendance percentage for the period
      let attendancePercentage = 0;
      if (washer.attendance && washer.attendance.length > 0) {
        const attendanceInRange = washer.attendance.filter(att => {
          const attDate = new Date(att.date);
          return attDate >= start && attDate <= end;
        });
        
        const presentDays = attendanceInRange.filter(att => att.status === 'present' || (att.timeIn && att.timeOut)).length;
        attendancePercentage = attendanceInRange.length > 0 ? Math.round((presentDays / attendanceInRange.length) * 100) : 0;
      }
      
      // Count as active if has any washes or attendance
      if (washerTotalWashes > 0 || attendancePercentage > 0) {
        activeWashers++;
      }
      
      washerPerformance.push({
        id: washer._id,
        name: washer.name,
        totalWashes: washerTotalWashes,
        completedWashes: washerCompletedWashes,
        successRate,
        rating: Math.round(avgRating * 10) / 10,
        attendancePercentage,
        earnings: Math.round(washerEarnings || 0)
      });
      
      // Add to totals
      totalWashes += washerTotalWashes;
      if (avgRating > 0) {
        totalRatings += avgRating;
        ratingCount++;
      }
      totalAttendancePercentage += attendancePercentage;
    }
    
    const avgRating = ratingCount > 0 ? Math.round((totalRatings / ratingCount) * 10) / 10 : 0;
    const avgAttendance = washers.length > 0 ? Math.round(totalAttendancePercentage / washers.length) : 0;
    
    res.json({
      totalWashers: washers.length,
      activeWashers,
      totalWashes,
      avgRating,
      avgAttendance,
      washers: washerPerformance.sort((a, b) => b.totalWashes - a.totalWashes)
    });
    
  } catch (error) {
    console.error('Error in /washer-performance:', error);
    res.status(500).json({ 
      error: error.message,
      totalWashers: 0,
      activeWashers: 0,
      totalWashes: 0,
      avgRating: 0,
      avgAttendance: 0,
      washers: []
    });
  }
});

module.exports = router;
