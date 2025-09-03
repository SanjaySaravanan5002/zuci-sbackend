const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');

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
      // Default to 1 month
      startDate.setMonth(currentDate.getMonth() - 1);
  }

  // Set time to start of day for start date and end of day for end date
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(currentDate);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
};

// Get dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const range = req.query.range || '1m'; // Default to 1 month if not specified
    const { startDate, endDate } = getDateRange(range);
    
    // For previous period comparison
    const duration = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - duration);
    const prevEndDate = new Date(startDate);
    
    // Get monthly customers (unique customers this month)

    const lead = await Lead.find();

    console.log("lead detials",JSON.stringify(lead))
    const periodCustomers = await Lead.distinct('customerName', {
      createdAt: { $gte: startDate, $lte: endDate }
    });

    // Calculate income from paid washes only
    const leads = await Lead.find({
      createdAt: { $gte: startDate, $lte: endDate }
    });

    const income = leads.reduce((total, lead) => {
      // Calculate total income from paid washes only
      const paidWashes = lead.washHistory.filter(wash => wash.is_amountPaid === true);
      const washIncome = paidWashes.reduce((washTotal, wash) => washTotal + (wash.amount || 0), 0);
      
      // Add monthly subscription paid washes
      let subscriptionIncome = 0;
      if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
        subscriptionIncome = lead.monthlySubscription.scheduledWashes
          .filter(wash => wash.is_amountPaid === true)
          .reduce((subTotal, wash) => subTotal + (wash.amount || 0), 0);
      }
      
      return total + washIncome + subscriptionIncome;
    }, 0);

    // Get today's leads
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayLeads = await Lead.countDocuments({
      createdAt: { $gte: startOfDay }
    });

    // Get previous period's data for comparison
    const prevPeriodCustomers = await Lead.distinct('customerName', {
      createdAt: { $gte: prevStartDate, $lte: prevEndDate }
    });

    const prevPeriodLeads = await Lead.find({
      createdAt: { $gte: prevStartDate, $lte: prevEndDate }
    });

    const prevPeriodIncome = prevPeriodLeads.reduce((total, lead) => {
      const paidWashes = lead.washHistory.filter(wash => wash.is_amountPaid === true);
      const washIncome = paidWashes.reduce((washTotal, wash) => washTotal + (wash.amount || 0), 0);
      
      let subscriptionIncome = 0;
      if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
        subscriptionIncome = lead.monthlySubscription.scheduledWashes
          .filter(wash => wash.is_amountPaid === true)
          .reduce((subTotal, wash) => subTotal + (wash.amount || 0), 0);
      }
      
      return total + washIncome + subscriptionIncome;
    }, 0);

    // Calculate percentage changes
    const customerChange = prevPeriodCustomers.length > 0 
      ? ((periodCustomers.length - prevPeriodCustomers.length) / prevPeriodCustomers.length) * 100
      : 0;
    const incomeChange = prevPeriodIncome > 0
      ? ((income - prevPeriodIncome) / prevPeriodIncome) * 100
      : 0;

    // Get yesterday's leads for comparison
    const yesterday = new Date(startOfDay);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayLeads = await Lead.countDocuments({
      createdAt: { $gte: yesterday, $lt: startOfDay }
    });

    const leadsChange = yesterdayLeads > 0
      ? ((todayLeads - yesterdayLeads) / yesterdayLeads * 100).toFixed(1)
      : 0;

    res.json({
      periodCustomers: {
        value: periodCustomers.length,
        change: parseFloat(customerChange.toFixed(1)),
        increasing: parseFloat(customerChange) > 0
      },
      income: {
        value: income,
        change: parseFloat(incomeChange),
        increasing: parseFloat(incomeChange) > 0
      },
      todayLeads: {
        value: todayLeads,
        change: parseFloat(leadsChange),
        increasing: parseFloat(leadsChange) > 0
      },
      conversionRate: {
        value: periodCustomers.length > 0 ? parseFloat(((leads.length / periodCustomers.length) * 100).toFixed(1)) : 0,
        total: leads.length,
        converted: periodCustomers.length
      }
    });
  } catch (error) {
    console.error('Error in /stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get lead acquisition data (last 7 days)
router.get('/lead-acquisition', async (req, res) => {
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

// Get washer performance data
router.get('/washer-performance', async (req, res) => {
  try {
    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    
    const washers = await User.find({ role: 'washer' });
    const performanceData = [];
    
    for (const washer of washers) {
      // Count completed washes for this month
      const leads = await Lead.find({
        'washHistory': {
          $elemMatch: {
            washer: washer._id,
            date: { $gte: firstDayOfMonth },
            washStatus: 'completed'
          }
        }
      });

      const washCount = leads.reduce((total, lead) => {
        return total + lead.washHistory.filter(wash => 
          wash.washer.toString() === washer._id.toString() &&
          wash.washStatus === 'completed' &&
          new Date(wash.date) >= firstDayOfMonth
        ).length;
      }, 0);
      
      performanceData.push({
        name: washer.name,
        washes: washCount
      });
    }
    
    // Sort by number of washes in descending order
    performanceData.sort((a, b) => b.washes - a.washes);
    
    res.json(performanceData);
  } catch (error) {
    console.error('Error in /washer-performance:', error);
    res.status(500).json({ error: error.message });
  }
});



// Get recent leads
router.get('/recent-leads', async (req, res) => {
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

// Get washer attendance analytics
router.get('/washer-attendance', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Set date range - default to current month if not provided
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      const currentDate = new Date();
      start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    }
    
    const washers = await User.find({ role: 'washer' });
    const attendanceData = [];
    
    for (const washer of washers) {
      // Filter attendance within date range
      const attendanceInRange = washer.attendance.filter(att => {
        const attDate = new Date(att.date);
        return attDate >= start && attDate <= end;
      });
      
      const presentDays = attendanceInRange.filter(att => att.status === 'present').length;
      const incompleteDays = attendanceInRange.filter(att => att.status === 'incomplete').length;
      const totalDays = attendanceInRange.length;
      const totalHours = attendanceInRange.reduce((sum, att) => sum + (att.duration || 0), 0);
      
      // Calculate working days in the range
      const workingDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      
      attendanceData.push({
        id: washer.id,
        name: washer.name,
        email: washer.email,
        phone: washer.phone,
        status: washer.status,
        presentDays,
        incompleteDays,
        totalDays,
        totalHours: parseFloat(totalHours.toFixed(2)),
        attendancePercentage: workingDays > 0 ? ((presentDays / workingDays) * 100).toFixed(1) : 0,
        recentAttendance: attendanceInRange.slice(-7).map(att => ({
          date: att.date,
          timeIn: att.timeIn,
          timeOut: att.timeOut,
          duration: att.duration,
          status: att.status
        }))
      });
    }
    
    res.json(attendanceData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get revenue by service type
router.get('/revenue-by-service', async (req, res) => {
  try {
    const currentDate = new Date();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    
    const leads = await Lead.find({});

    const serviceRevenue = {};
    leads.forEach(lead => {
      // Process wash history
      lead.washHistory.forEach(wash => {
        if (wash.is_amountPaid && new Date(wash.date) >= firstDayOfMonth) {
          serviceRevenue[wash.washType] = (serviceRevenue[wash.washType] || 0) + wash.amount;
        }
      });
      
      // Process monthly subscription washes
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
router.get('/lead-sources', async (req, res) => {
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
router.get('/area-distribution', async (req, res) => {
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
router.get('/feedback-analytics', async (req, res) => {
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
      lead.washHistory.forEach(wash => {
        if (new Date(wash.date) >= firstDayOfMonth) {
          feedbackCount.total++;
          if (wash.feedback) {
            feedbackCount.withFeedback++;
          }
        }
      });
    });
    
    res.json({
      totalServices: feedbackCount.total,
      feedbackReceived: feedbackCount.withFeedback,
      feedbackRate: ((feedbackCount.withFeedback / feedbackCount.total) * 100).toFixed(1)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//get the count of today's wash and tomorrow wash count 
router.get('/today-tomorrow-wash-count', async (req, res) => {
  try {
    // Set today to start of day (00:00:00)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Set tomorrow to start of next day
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Set day after tomorrow to get tomorrow's range
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    // Count washes scheduled for today
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

    // Count washes scheduled for tomorrow
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
    
    res.json({
      todayCount: todayResult[0]?.count || 0,
      tomorrowCount: tomorrowResult[0]?.count || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get detailed attendance for a specific washer
router.get('/washer-attendance/:washerId', async (req, res) => {
  try {
    const { washerId } = req.params;
    const { startDate, endDate } = req.query;
    
    const washer = await User.findOne({ id: parseInt(washerId) });
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }
    
    let attendance = washer.attendance || [];
    
    // Filter by date range if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      attendance = attendance.filter(att => {
        const attDate = new Date(att.date);
        return attDate >= start && attDate <= end;
      });
    }
    
    // Calculate stats
    const presentDays = attendance.filter(att => att.status === 'present').length;
    const incompleteDays = attendance.filter(att => att.status === 'incomplete').length;
    const totalHours = attendance.reduce((sum, att) => sum + (att.duration || 0), 0);
    
    res.json({
      washer: {
        id: washer.id,
        name: washer.name,
        email: washer.email,
        phone: washer.phone,
        status: washer.status
      },
      stats: {
        totalDays: attendance.length,
        presentDays,
        incompleteDays,
        totalHours: parseFloat(totalHours.toFixed(2)),
        averageHoursPerDay: attendance.length > 0 ? parseFloat((totalHours / attendance.length).toFixed(2)) : 0
      },
      attendance: attendance.sort((a, b) => new Date(b.date) - new Date(a.date))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

// Get washer attendance data for admin
router.get('/washer-attendance', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Set default date range if not provided
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();
    
    // Set time to start/end of day
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    
    // Get all washers
    const washers = await User.find({ role: 'washer' }).select('id name email phone attendance');
    
    const attendanceData = washers.map(washer => {
      // Filter attendance for the date range
      const relevantAttendance = washer.attendance.filter(record => {
        const recordDate = new Date(record.date);
        return recordDate >= start && recordDate <= end;
      });
      
      // Calculate stats
      const presentDays = relevantAttendance.filter(record => record.status === 'present').length;
      const incompleteDays = relevantAttendance.filter(record => record.status === 'incomplete').length;
      const totalDays = relevantAttendance.length;
      
      const totalHours = relevantAttendance.reduce((total, record) => {
        return total + (record.duration || 0);
      }, 0);
      
      const attendancePercentage = totalDays > 0 ? ((presentDays / totalDays) * 100).toFixed(1) : '0';
      
      // Get recent attendance (last 7 records)
      const recentAttendance = relevantAttendance
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 7)
        .map(record => ({
          date: record.date,
          timeIn: record.timeIn,
          timeOut: record.timeOut,
          duration: record.duration,
          status: record.status
        }));
      
      return {
        id: washer.id,
        name: washer.name,
        email: washer.email,
        phone: washer.phone,
        presentDays,
        incompleteDays,
        totalDays,
        totalHours,
        attendancePercentage,
        recentAttendance
      };
    });
    
    res.json(attendanceData);
  } catch (error) {
    console.error('Error in /washer-attendance:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;