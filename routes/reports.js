const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Expense = require('../models/Expense');
const { auth, authorize } = require('../middleware/auth');

// Revenue and Income Reports - For superadmin and admin users
router.get('/revenue_and_income', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate, washType, area, customerType } = req.query;
    const matchConditions = { status: 'Converted' };

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      matchConditions.createdAt = {
        $gte: start,
        $lte: end
      };
    }

    if (customerType && customerType !== 'All Types') {
      matchConditions.leadType = customerType;
    }

    const leads = await Lead.find(matchConditions)
      .select('washHistory leadType customerName area phone monthlySubscription')
      .populate({
        path: 'washHistory.washer',
        select: 'name'
      })
      .populate({
        path: 'monthlySubscription.scheduledWashes.washer',
        select: 'name'
      })
      .lean();

    let totalRevenue = 0;
    let totalWashes = 0;
    let totalCustomers = leads.length;
    let revenueByWashType = {};
    let washesByType = {};
    let revenueByCustomerType = {};
    let customersByType = {};
    let recentTransactions = [];
    let paymentSummary = { total: 0, paid: 0, unpaid: 0 };

    // Count customers by type
    leads.forEach(lead => {
      const type = lead.leadType || 'Unknown';
      customersByType[type] = (customersByType[type] || 0) + 1;
    });

    // Process wash history
    leads.forEach(lead => {
      if (Array.isArray(lead.washHistory)) {
        lead.washHistory.forEach(wash => {
          if (wash.washStatus === 'completed') {
            const amount = parseFloat(wash.amount) || 0;
            const washTypeFilter = washType && washType !== 'All Types' ? wash.washType === washType : true;
            const areaFilter = area ? lead.area === area : true;
            const dateFilter = startDate && endDate ? 
              new Date(wash.date) >= new Date(startDate) && new Date(wash.date) <= new Date(endDate) : true;
            
            if (washTypeFilter && areaFilter && dateFilter) {
              totalRevenue += amount;
              totalWashes++;
              
              // Revenue by wash type
              if (wash.washType) {
                revenueByWashType[wash.washType] = (revenueByWashType[wash.washType] || 0) + amount;
                washesByType[wash.washType] = (washesByType[wash.washType] || 0) + 1;
              }
              
              // Revenue by customer type
              const customerType = lead.leadType || 'Unknown';
              revenueByCustomerType[customerType] = (revenueByCustomerType[customerType] || 0) + amount;
              
              // Payment summary
              paymentSummary.total += amount;
              if (wash.is_amountPaid) {
                paymentSummary.paid += amount;
              } else {
                paymentSummary.unpaid += amount;
              }
              
              // Recent transactions
              recentTransactions.push({
                transactionId: `${lead._id}_${wash._id || Date.now()}`,
                customerId: lead._id,
                customerName: lead.customerName || 'Unknown Customer',
                area: lead.area || 'Unknown Area',
                washType: wash.washType || 'Standard',
                amount: amount,
                date: wash.date || new Date(),
                washerName: wash.washer?.name || 'Unassigned',
                customerType: lead.leadType || 'One-time',
                isPaid: wash.is_amountPaid || false
              });
            }
          }
        });
      }
      
      // Process monthly subscription washes
      if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
        lead.monthlySubscription.scheduledWashes.forEach(wash => {
          if (wash.status === 'completed') {
            const amount = parseFloat(wash.amount) || 0;
            const washTypeFilter = washType && washType !== 'All Types' ? lead.monthlySubscription.packageType === washType : true;
            const areaFilter = area ? lead.area === area : true;
            const dateFilter = startDate && endDate ? 
              new Date(wash.completedDate || wash.scheduledDate) >= new Date(startDate) && 
              new Date(wash.completedDate || wash.scheduledDate) <= new Date(endDate) : true;
            
            if (washTypeFilter && areaFilter && dateFilter) {
              totalRevenue += amount;
              totalWashes++;
              
              // Revenue by wash type
              const packageType = lead.monthlySubscription.packageType || 'Standard';
              revenueByWashType[packageType] = (revenueByWashType[packageType] || 0) + amount;
              washesByType[packageType] = (washesByType[packageType] || 0) + 1;
              
              // Revenue by customer type
              const customerType = lead.leadType || 'Unknown';
              revenueByCustomerType[customerType] = (revenueByCustomerType[customerType] || 0) + amount;
              
              // Payment summary
              paymentSummary.total += amount;
              if (wash.is_amountPaid) {
                paymentSummary.paid += amount;
              } else {
                paymentSummary.unpaid += amount;
              }
              
              // Recent transactions
              recentTransactions.push({
                transactionId: `${lead._id}_monthly_${wash._id || Date.now()}`,
                customerId: lead._id,
                customerName: lead.customerName || 'Unknown Customer',
                area: lead.area || 'Unknown Area',
                washType: packageType,
                amount: amount,
                date: wash.completedDate || wash.scheduledDate || new Date(),
                washerName: wash.washer?.name || 'Unassigned',
                customerType: lead.leadType || 'Monthly',
                isPaid: wash.is_amountPaid || false
              });
            }
          }
        });
      }
    });

    // Get expenses for the same period
    let expenseMatchConditions = {};
    if (startDate && endDate) {
      expenseMatchConditions.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const expenses = await Expense.find(expenseMatchConditions).lean();
    const totalExpenses = expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
    const netRevenue = totalRevenue - totalExpenses;

    // Sort transactions by date (newest first)
    recentTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      totalRevenue: totalRevenue || 0,
      netRevenue: netRevenue || 0,
      totalExpenses: totalExpenses || 0,
      totalWashes: totalWashes || 0,
      totalCustomers: totalCustomers || 0,
      revenueByWashType: revenueByWashType || {},
      washesByType: washesByType || {},
      revenueByCustomerType: revenueByCustomerType || {},
      customersByType: customersByType || {},
      recentTransactions: recentTransactions || [],
      paymentSummary: paymentSummary || { total: 0, paid: 0, unpaid: 0 },
      expenses: expenses || [],
      message: 'Revenue and income data retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Financial Reports - For superadmin and admin users
router.get('/revenue', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const matchConditions = { status: 'Converted' };

    if (startDate && endDate) {
      matchConditions.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const leads = await Lead.find(matchConditions)
      .select('washHistory leadType customerName area')
      .lean();

    let totalRevenue = 0;
    let revenueByMonth = {};
    let revenueByService = {};

    leads.forEach(lead => {
      if (Array.isArray(lead.washHistory)) {
        lead.washHistory.forEach(wash => {
          if (wash.washStatus === 'completed' && wash.is_amountPaid === true) {
            const amount = parseFloat(wash.amount) || 0;
            const date = new Date(wash.date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            // Total revenue
            totalRevenue += amount;

            // Revenue by month
            revenueByMonth[monthKey] = (revenueByMonth[monthKey] || 0) + amount;

            // Revenue by service type
            if (wash.washType) {
              revenueByService[wash.washType] = (revenueByService[wash.washType] || 0) + amount;
            }
          }
        });
      }
    });

    res.json({
      totalRevenue,
      revenueByMonth,
      revenueByService
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Customer Reports - Available to all admin types
router.get('/customers', auth, authorize('superadmin', 'admin', 'limited_admin'), async (req, res) => {
  try {
    const { startDate, endDate, type, monthly } = req.query;
    const matchConditions = { status: 'Converted' };

    // Date filter - fix to work properly
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999); // Include the entire end date
      
      matchConditions.createdAt = {
        $gte: start,
        $lte: end
      };
    }

    if (type) {
      matchConditions.leadType = type;
    }

    let aggregationPipeline = [
      { $match: matchConditions }
    ];

    if (monthly === 'true') {
      // Monthly-wise report
      aggregationPipeline.push(
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              leadType: '$leadType'
            },
            count: { $sum: 1 },
            customers: {
              $push: {
                name: '$customerName',
                area: '$area',
                phone: '$phone',
                totalWashes: { $size: '$washHistory' },
                createdAt: '$createdAt'
              }
            }
          }
        },
        {
          $sort: { '_id.year': -1, '_id.month': -1 }
        }
      );
    } else {
      // Regular report
      aggregationPipeline.push(
        {
          $group: {
            _id: '$leadType',
            count: { $sum: 1 },
            customers: {
              $push: {
                name: '$customerName',
                area: '$area',
                phone: '$phone',
                totalWashes: { $size: '$washHistory' },
                createdAt: '$createdAt'
              }
            }
          }
        }
      );
    }

    const customers = await Lead.aggregate(aggregationPipeline);
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Debug endpoint to check washer data availability
router.get('/washers/debug', auth, authorize('superadmin', 'admin', 'limited_admin'), async (req, res) => {
  try {
    // Check washers in database
    const totalWashers = await User.countDocuments({ role: 'washer' });
    const washers = await User.find({ role: 'washer' }).select('name phone email status').lean();
    
    // Check leads with wash history
    const leadsWithWashes = await Lead.countDocuments({ 'washHistory.0': { $exists: true } });
    const completedWashes = await Lead.countDocuments({ 'washHistory.washStatus': 'completed' });
    const washesWithWashers = await Lead.countDocuments({ 'washHistory.washer': { $ne: null } });
    
    // Check monthly subscriptions
    const monthlyLeads = await Lead.countDocuments({ leadType: 'Monthly' });
    const monthlyWithWashes = await Lead.countDocuments({ 'monthlySubscription.scheduledWashes.0': { $exists: true } });
    
    // Sample wash data
    const sampleWashes = await Lead.find({ 'washHistory.0': { $exists: true } })
      .select('customerName washHistory.washer washHistory.washStatus washHistory.date')
      .limit(3)
      .lean();
    
    res.json({
      database_status: {
        total_washers: totalWashers,
        washers_list: washers,
        leads_with_washes: leadsWithWashes,
        completed_washes: completedWashes,
        washes_with_assigned_washers: washesWithWashers,
        monthly_leads: monthlyLeads,
        monthly_with_scheduled_washes: monthlyWithWashes
      },
      sample_data: {
        sample_washes: sampleWashes
      },
      recommendations: {
        need_washers: totalWashers === 0,
        need_wash_assignments: washesWithWashers === 0,
        need_completed_washes: completedWashes === 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Washer Reports - Available to all admin types
router.get('/washers', auth, authorize('superadmin', 'admin', 'limited_admin'), async (req, res) => {
  try {
    const { startDate, endDate, washerId } = req.query;
    
    // Get all washers first
    let washerQuery = { role: 'washer' };
    if (washerId) {
      if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
        washerQuery._id = new mongoose.Types.ObjectId(washerId);
      } else {
        washerQuery.id = parseInt(washerId);
      }
    }
    
    const allWashers = await User.find(washerQuery).lean();
    
    if (allWashers.length === 0) {
      return res.json({
        message: 'No washers found in database. Please add washers first.',
        washers: [],
        totalWashers: 0,
        debug_info: {
          total_users: await User.countDocuments(),
          washer_users: await User.countDocuments({ role: 'washer' }),
          all_roles: await User.distinct('role')
        }
      });
    }
    
    // Build match conditions for wash data
    let washHistoryMatch = {
      'washHistory.washStatus': 'completed'
    };
    
    let monthlyMatch = {
      'monthlySubscription.scheduledWashes.status': 'completed'
    };

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      washHistoryMatch['washHistory.date'] = { $gte: start, $lte: end };
      monthlyMatch['monthlySubscription.scheduledWashes.completedDate'] = { $gte: start, $lte: end };
    }

    // Get wash history data
    const washHistoryData = await Lead.aggregate([
      { $unwind: { path: '$washHistory', preserveNullAndEmptyArrays: false } },
      { $match: washHistoryMatch },
      { $match: { 'washHistory.washer': { $ne: null } } }, // Only include washes with assigned washers
      {
        $group: {
          _id: '$washHistory.washer',
          totalWashes: { $sum: 1 },
          totalRevenue: { $sum: { $toDouble: '$washHistory.amount' } },
          completedWashes: {
            $push: {
              date: '$washHistory.date',
              type: '$washHistory.washType',
              amount: '$washHistory.amount',
              customerName: '$customerName',
              area: '$area',
              feedback: '$washHistory.feedback',
              isPaid: '$washHistory.is_amountPaid'
            }
          }
        }
      }
    ]);

    // Get monthly subscription data
    const monthlyData = await Lead.aggregate([
      { $match: { leadType: 'Monthly', 'monthlySubscription.scheduledWashes': { $exists: true } } },
      { $unwind: { path: '$monthlySubscription.scheduledWashes', preserveNullAndEmptyArrays: false } },
      { $match: monthlyMatch },
      { $match: { 'monthlySubscription.scheduledWashes.washer': { $ne: null } } }, // Only include washes with assigned washers
      {
        $group: {
          _id: '$monthlySubscription.scheduledWashes.washer',
          totalWashes: { $sum: 1 },
          totalRevenue: { $sum: { $toDouble: '$monthlySubscription.scheduledWashes.amount' } },
          completedWashes: {
            $push: {
              date: '$monthlySubscription.scheduledWashes.completedDate',
              type: '$monthlySubscription.packageType',
              amount: '$monthlySubscription.scheduledWashes.amount',
              customerName: '$customerName',
              area: '$area',
              feedback: '$monthlySubscription.scheduledWashes.feedback',
              isPaid: '$monthlySubscription.scheduledWashes.is_amountPaid'
            }
          }
        }
      }
    ]);

    // Combine both datasets
    const combinedData = new Map();
    
    // Add wash history data
    washHistoryData.forEach(washer => {
      combinedData.set(washer._id.toString(), {
        _id: washer._id,
        totalWashes: washer.totalWashes,
        totalRevenue: washer.totalRevenue,
        completedWashes: washer.completedWashes
      });
    });
    
    // Add monthly subscription data
    monthlyData.forEach(washer => {
      const washerId = washer._id.toString();
      if (combinedData.has(washerId)) {
        const existing = combinedData.get(washerId);
        existing.totalWashes += washer.totalWashes;
        existing.totalRevenue += washer.totalRevenue;
        existing.completedWashes = existing.completedWashes.concat(washer.completedWashes);
      } else {
        combinedData.set(washerId, {
          _id: washer._id,
          totalWashes: washer.totalWashes,
          totalRevenue: washer.totalRevenue,
          completedWashes: washer.completedWashes
        });
      }
    });

    // Process all washers (including those with no washes)
    const washers = await Promise.all(
      allWashers.map(async (washerDetails) => {
        const washerId = washerDetails._id;
        const washerData = combinedData.get(washerId.toString()) || {
          _id: washerId,
          totalWashes: 0,
          totalRevenue: 0,
          completedWashes: []
        };
        
        // Get monthly wash count
        const monthlyWashCount = await Lead.aggregate([
          { $unwind: '$washHistory' },
          {
            $match: {
              'washHistory.washer': washerId,
              'washHistory.washStatus': 'completed',
              ...(startDate && endDate && {
                'washHistory.date': { $gte: new Date(startDate), $lte: new Date(endDate) }
              })
            }
          },
          {
            $group: {
              _id: {
                year: { $year: '$washHistory.date' },
                month: { $month: '$washHistory.date' }
              },
              count: { $sum: 1 },
              revenue: { $sum: { $toDouble: '$washHistory.amount' } }
            }
          },
          { $sort: { '_id.year': -1, '_id.month': -1 } }
        ]);

        // Get customer details with dates
        const customerDetails = await Lead.aggregate([
          { $unwind: '$washHistory' },
          {
            $match: {
              'washHistory.washer': washerId,
              'washHistory.washStatus': 'completed',
              ...(startDate && endDate && {
                'washHistory.date': { $gte: new Date(startDate), $lte: new Date(endDate) }
              })
            }
          },
          {
            $group: {
              _id: '$_id',
              customerName: { $first: '$customerName' },
              area: { $first: '$area' },
              phone: { $first: '$phone' },
              totalAmount: { $sum: { $toDouble: '$washHistory.amount' } },
              washCount: { $sum: 1 },
              lastWashDate: { $max: '$washHistory.date' },
              firstWashDate: { $min: '$washHistory.date' },
              washes: {
                $push: {
                  date: '$washHistory.date',
                  type: '$washHistory.washType',
                  amount: '$washHistory.amount',
                  feedback: '$washHistory.feedback'
                }
              }
            }
          },
          { $sort: { lastWashDate: -1 } }
        ]);

        // Get attendance data for the period (or overall if no date range)
        let attendance = null;
        if (washerDetails?.attendance) {
          let attendanceData;
          if (startDate && endDate) {
            // Filter by date range
            attendanceData = washerDetails.attendance.filter(att => {
              const attDate = new Date(att.date);
              return attDate >= new Date(startDate) && attDate <= new Date(endDate);
            });
          } else {
            // Show overall attendance
            attendanceData = washerDetails.attendance;
          }
          
          const presentDays = attendanceData.filter(att => 
            att.status === 'present' || (att.timeIn && att.timeOut)
          ).length;
          const totalDays = attendanceData.length;
          
          attendance = {
            presentDays,
            totalDays,
            percentage: totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0,
            details: attendanceData.slice(-30).map(att => ({
              date: att.date,
              status: att.status || (att.timeIn && att.timeOut ? 'present' : 'absent'),
              timeIn: att.timeIn,
              timeOut: att.timeOut,
              duration: att.duration
            }))
          };
        }

        // Calculate performance metrics
        const performance = {
          avgWashesPerDay: attendance?.presentDays > 0 ? Math.round(washerData.totalWashes / attendance.presentDays * 10) / 10 : 0,
          avgRevenuePerWash: washerData.totalWashes > 0 ? Math.round(washerData.totalRevenue / washerData.totalWashes) : 0,
          completionRate: washerData.totalWashes > 0 ? Math.round((washerData.totalWashes / washerData.totalWashes) * 100) : 100
        };

        return {
          _id: washerId,
          totalWashes: washerData.totalWashes || 0,
          totalRevenue: washerData.totalRevenue || 0,
          completedWashes: washerData.completedWashes || [],
          washerName: washerDetails?.name || 'Unknown Washer',
          washerPhone: washerDetails?.phone || 'N/A',
          washerEmail: washerDetails?.email || 'N/A',
          washerStatus: washerDetails?.status || 'Unknown',
          monthlyWashCount: monthlyWashCount || [],
          customerDetails: customerDetails || [],
          attendance,
          performance
        };
      })
    );

    res.json({
      washers,
      totalWashers: washers.length,
      message: 'Washer reports retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
