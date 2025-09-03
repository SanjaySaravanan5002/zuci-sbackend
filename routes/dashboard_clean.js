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
      startDate.setMonth(currentDate.getMonth() - 1);
  }

  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(currentDate);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
};

// Get dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const range = req.query.range || '1m';
    const { startDate, endDate } = getDateRange(range);
    
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

    const income = leads.reduce((total, lead) => {
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

// Get washer attendance analytics with real-time data
router.get('/washer-attendance', async (req, res) => {
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
    const attendanceData = [];
    
    for (const washer of washers) {
      const todayAttendance = washer.attendance.find(att => {
        const attDate = new Date(att.date);
        return attDate.toDateString() === start.toDateString();
      });
      
      const attendanceInRange = washer.attendance.filter(att => {
        const attDate = new Date(att.date);
        return attDate >= start && attDate <= end;
      });
      
      const presentDays = attendanceInRange.filter(att => att.status === 'present').length;
      const incompleteDays = attendanceInRange.filter(att => att.status === 'incomplete').length;
      const totalDays = attendanceInRange.length;
      const totalHours = attendanceInRange.reduce((sum, att) => sum + (att.duration || 0), 0);
      
      let currentStatus = 'absent';
      let timeIn = null;
      let timeOut = null;
      
      if (todayAttendance) {
        timeIn = todayAttendance.timeIn;
        timeOut = todayAttendance.timeOut;
        
        if (timeIn && timeOut) {
          currentStatus = 'completed';
        } else if (timeIn) {
          currentStatus = 'active';
        }
      }
      
      const recentAttendance = washer.attendance
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 7)
        .map(att => ({
          date: att.date,
          timeIn: att.timeIn,
          timeOut: att.timeOut,
          duration: att.duration,
          status: att.status
        }));
      
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
        totalDays,
        totalHours: parseFloat(totalHours.toFixed(2)),
        attendancePercentage: totalDays > 0 ? ((presentDays / totalDays) * 100).toFixed(1) : '0',
        recentAttendance
      });
    }
    
    res.json(attendanceData);
  } catch (error) {
    console.error('Error in /washer-attendance:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;