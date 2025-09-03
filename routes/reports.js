const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Expense = require('../models/Expense');
const { auth, authorize } = require('../middleware/auth');

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
    const { startDate, endDate, type } = req.query;
    const matchConditions = { status: 'Converted' };

    if (startDate && endDate) {
      matchConditions.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (type) {
      matchConditions.leadType = type;
    }

    const customers = await Lead.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: '$leadType',
          count: { $sum: 1 },
          customers: {
            $push: {
              name: '$customerName',
              area: '$area',
              phone: '$phone',
              totalWashes: { $size: '$washHistory' }
            }
          }
        }
      }
    ]);

    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Washer Reports - Available to all admin types
router.get('/washers', auth, authorize('superadmin', 'admin', 'limited_admin'), async (req, res) => {
  try {
    const { startDate, endDate, washerId } = req.query;
    let dateFilter = {};
    let monthlyDateFilter = {};

    if (startDate && endDate) {
      dateFilter = {
        'washHistory.date': {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
      monthlyDateFilter = {
        'monthlySubscription.scheduledWashes.completedDate': {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    }

    let washerFilter = {};
    let monthlyWasherFilter = {};
    if (washerId) {
      // Handle both ObjectId and numeric ID
      if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
        washerFilter = { 'washHistory.washer': new mongoose.Types.ObjectId(washerId) };
        monthlyWasherFilter = { 'monthlySubscription.scheduledWashes.washer': new mongoose.Types.ObjectId(washerId) };
      } else {
        // Find user by numeric ID first
        const user = await User.findOne({ id: parseInt(washerId) });
        if (user) {
          washerFilter = { 'washHistory.washer': user._id };
          monthlyWasherFilter = { 'monthlySubscription.scheduledWashes.washer': user._id };
        }
      }
    }

    // Update dateFilter for monthly subscriptions
    Object.assign(dateFilter, monthlyDateFilter);
    Object.assign(washerFilter, monthlyWasherFilter);

    // Get wash history data
    const washHistoryData = await Lead.aggregate([
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.washStatus': 'completed',
          'washHistory.is_amountPaid': true,
          ...dateFilter,
          ...washerFilter
        }
      },
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
      { $unwind: '$monthlySubscription.scheduledWashes' },
      {
        $match: {
          'monthlySubscription.scheduledWashes.status': 'completed',
          'monthlySubscription.scheduledWashes.is_amountPaid': true,
          ...dateFilter,
          ...washerFilter
        }
      },
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

    // Convert to array and add washer details
    const washers = await Promise.all(
      Array.from(combinedData.values()).map(async (washer) => {
        const washerDetails = await User.findById(washer._id);
        return {
          _id: washer._id,
          totalWashes: washer.totalWashes,
          totalRevenue: washer.totalRevenue,
          completedWashes: washer.completedWashes,
          washerName: washerDetails?.name || 'Unknown Washer',
          washerPhone: washerDetails?.phone || 'N/A',
          washerEmail: washerDetails?.email || 'N/A',
          washerStatus: washerDetails?.status || 'Unknown'
        };
      })
    );

    // Sort by total revenue
    washers.sort((a, b) => b.totalRevenue - a.totalRevenue);

    res.json(washers);
  } catch (error) {
    console.error('Washer reports error:', error);
    res.status(500).json({ message: error.message });
  }
});


router.get('/revenue_and_income', auth, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      washType,
      area,
      customerType
    } = req.query;

    // Build base query - only converted leads
    const baseQuery = { status: 'Converted' };

    // Apply area filter if provided
    if (area) {
      baseQuery.area = { $regex: area, $options: 'i' };
    }

    // Apply customer type filter if provided
    if (customerType) {
      baseQuery.leadType = customerType === 'Monthly' ? 'Monthly' : 'One-time';
    }

    // Calculate totals from both wash history and monthly subscriptions
    const allTransactions = await Lead.aggregate([
      { $match: baseQuery },
      {
        $facet: {
          washHistory: [
            { $unwind: '$washHistory' },
            {
              $match: {
                'washHistory.washStatus': 'completed',
                ...((startDate || endDate) && {
                  'washHistory.date': {
                    ...(startDate && { $gte: new Date(startDate) }),
                    ...(endDate && { $lte: new Date(endDate) })
                  }
                }),
                ...(washType && { 'washHistory.washType': washType }),
                ...(area && { area: { $regex: area, $options: 'i' } }),
                ...(customerType && { leadType: customerType === 'Monthly' ? 'Monthly' : 'One-time' })
              }
            },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: { $cond: [{ $and: [{ $eq: ['$washHistory.washStatus', 'completed'] }, { $eq: ['$washHistory.is_amountPaid', true] }] }, '$washHistory.amount', 0] } },
                totalWashes: { $sum: 1 },
                paidAmount: { $sum: { $cond: [{ $eq: ['$washHistory.is_amountPaid', true] }, '$washHistory.amount', 0] } },
                unpaidAmount: { $sum: { $cond: [{ $ne: ['$washHistory.is_amountPaid', true] }, '$washHistory.amount', 0] } },
                customers: { $addToSet: '$_id' }
              }
            }
          ],
          monthlySubscriptions: [
            { $match: { leadType: 'Monthly', 'monthlySubscription.scheduledWashes': { $exists: true } } },
            { $unwind: '$monthlySubscription.scheduledWashes' },
            {
              $match: {
                'monthlySubscription.scheduledWashes.status': 'completed',
                ...((startDate || endDate) && {
                  'monthlySubscription.scheduledWashes.completedDate': {
                    ...(startDate && { $gte: new Date(startDate) }),
                    ...(endDate && { $lte: new Date(endDate) })
                  }
                }),
                ...(area && { area: { $regex: area, $options: 'i' } }),
                ...(customerType && { leadType: customerType === 'Monthly' ? 'Monthly' : 'One-time' })
              }
            },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: { $cond: [{ $and: [{ $eq: ['$monthlySubscription.scheduledWashes.status', 'completed'] }, { $eq: ['$monthlySubscription.scheduledWashes.is_amountPaid', true] }] }, '$monthlySubscription.scheduledWashes.amount', 0] } },
                totalWashes: { $sum: 1 },
                paidAmount: { $sum: { $cond: [{ $eq: ['$monthlySubscription.scheduledWashes.is_amountPaid', true] }, '$monthlySubscription.scheduledWashes.amount', 0] } },
                unpaidAmount: { $sum: { $cond: [{ $ne: ['$monthlySubscription.scheduledWashes.is_amountPaid', true] }, '$monthlySubscription.scheduledWashes.amount', 0] } },
                customers: { $addToSet: '$_id' }
              }
            }
          ]
        }
      }
    ]);

    // Combine totals from both sources
    const combinedTotals = allTransactions[0];
    const washHistoryTotals = combinedTotals.washHistory[0] || { totalRevenue: 0, totalWashes: 0, paidAmount: 0, unpaidAmount: 0, customers: [] };
    const monthlyTotals = combinedTotals.monthlySubscriptions[0] || { totalRevenue: 0, totalWashes: 0, paidAmount: 0, unpaidAmount: 0, customers: [] };

    const finalTotals = {
      totalRevenue: washHistoryTotals.totalRevenue + monthlyTotals.totalRevenue,
      totalWashes: washHistoryTotals.totalWashes + monthlyTotals.totalWashes,
      paidAmount: washHistoryTotals.paidAmount + monthlyTotals.paidAmount,
      unpaidAmount: washHistoryTotals.unpaidAmount + monthlyTotals.unpaidAmount,
      totalCustomers: new Set([...washHistoryTotals.customers, ...monthlyTotals.customers]).size
    };

    // Get revenue breakdown by wash type
    const revenueByWashType = await Lead.aggregate([
      { $match: baseQuery },
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.washStatus': 'completed',
          ...((startDate || endDate) && {
            'washHistory.date': {
              ...(startDate && { $gte: new Date(startDate) }),
              ...(endDate && { $lte: new Date(endDate) })
            }
          }),
          ...(washType && { 'washHistory.washType': washType })
        }
      },
      {
        $group: {
          _id: '$washHistory.washType',
          revenue: { $sum: { $cond: [{ $eq: ['$washHistory.is_amountPaid', true] }, '$washHistory.amount', 0] } },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get revenue breakdown by customer type
    const revenueByCustomerType = await Lead.aggregate([
      { $match: baseQuery },
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.washStatus': 'completed',
          ...((startDate || endDate) && {
            'washHistory.date': {
              ...(startDate && { $gte: new Date(startDate) }),
              ...(endDate && { $lte: new Date(endDate) })
            }
          }),
          ...(washType && { 'washHistory.washType': washType })
        }
      },
      {
        $group: {
          _id: '$leadType',
          revenue: { $sum: { $cond: [{ $eq: ['$washHistory.is_amountPaid', true] }, '$washHistory.amount', 0] } },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get transactions from both washHistory and monthly subscriptions
    const washHistoryTransactions = await Lead.aggregate([
      { $match: baseQuery },
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.washStatus': 'completed',
          ...((startDate || endDate) && {
            'washHistory.date': {
              ...(startDate && { $gte: new Date(startDate) }),
              ...(endDate && { $lte: new Date(endDate) })
            }
          }),
          ...(washType && { 'washHistory.washType': washType })
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'washHistory.washer',
          foreignField: '_id',
          as: 'washerInfo'
        }
      },
      {
        $project: {
          _id: 0,
          transactionId: '$washHistory._id',
          customerId: '$_id',
          customerName: '$customerName',
          area: '$area',
          washType: '$washHistory.washType',
          amount: '$washHistory.amount',
          date: '$washHistory.date',
          washerName: { 
            $cond: {
              if: { $gt: [{ $size: '$washerInfo' }, 0] },
              then: { $arrayElemAt: ['$washerInfo.name', 0] },
              else: 'Unknown Washer'
            }
          },
          customerType: '$leadType',
          isPaid: { $ifNull: ['$washHistory.is_amountPaid', false] },
          source: 'washHistory'
        }
      }
    ]);

    // Get monthly subscription transactions
    const monthlyTransactions = await Lead.aggregate([
      { $match: { ...baseQuery, leadType: 'Monthly', 'monthlySubscription.scheduledWashes': { $exists: true } } },
      { $unwind: '$monthlySubscription.scheduledWashes' },
      {
        $match: {
          'monthlySubscription.scheduledWashes.status': 'completed',
          ...((startDate || endDate) && {
            'monthlySubscription.scheduledWashes.completedDate': {
              ...(startDate && { $gte: new Date(startDate) }),
              ...(endDate && { $lte: new Date(endDate) })
            }
          })
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'monthlySubscription.scheduledWashes.washer',
          foreignField: '_id',
          as: 'washerInfo'
        }
      },
      {
        $project: {
          _id: 0,
          transactionId: '$monthlySubscription.scheduledWashes._id',
          customerId: '$_id',
          customerName: '$customerName',
          area: '$area',
          washType: '$monthlySubscription.packageType',
          amount: '$monthlySubscription.scheduledWashes.amount',
          date: '$monthlySubscription.scheduledWashes.completedDate',
          washerName: { 
            $cond: {
              if: { $gt: [{ $size: '$washerInfo' }, 0] },
              then: { $arrayElemAt: ['$washerInfo.name', 0] },
              else: 'Unknown Washer'
            }
          },
          customerType: '$leadType',
          isPaid: { $ifNull: ['$monthlySubscription.scheduledWashes.is_amountPaid', false] },
          source: 'monthlySubscription'
        }
      }
    ]);

    // Combine and sort transactions
    const recentTransactions = [...washHistoryTransactions, ...monthlyTransactions].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Calculate total expenses for the same date range
    let expenseQuery = {};
    if (startDate || endDate) {
      expenseQuery.date = {
        ...(startDate && { $gte: new Date(startDate) }),
        ...(endDate && { $lte: new Date(endDate) })
      };
    }
    
    const expenses = await Expense.find(expenseQuery);
    const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const netRevenue = finalTotals.totalRevenue - totalExpenses;

    // Format the response
    const revenueByWashTypeMap = revenueByWashType.reduce((acc, { _id, revenue, count }) => {
      acc[_id] = revenue;
      return acc;
    }, {});

    const washesByTypeMap = revenueByWashType.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    const revenueByCustomerTypeMap = revenueByCustomerType.reduce((acc, { _id, revenue, count }) => {
      acc[_id] = revenue;
      return acc;
    }, {});

    const customersByTypeMap = revenueByCustomerType.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    res.json({
      totalRevenue: finalTotals.totalRevenue || 0,
      netRevenue: netRevenue || 0,
      totalExpenses: totalExpenses || 0,
      totalWashes: finalTotals.totalWashes || 0,
      totalCustomers: finalTotals.totalCustomers || 0,
      revenueByWashType: revenueByWashTypeMap || {},
      washesByType: washesByTypeMap || {},
      revenueByCustomerType: revenueByCustomerTypeMap || {},
      customersByType: customersByTypeMap || {},
      recentTransactions: recentTransactions || [],
      paymentSummary: {
        total: finalTotals.totalRevenue || 0,
        paid: finalTotals.paidAmount || 0,
        unpaid: finalTotals.unpaidAmount || 0
      },
      expenses: expenses || []
    });
  } catch (error) {
    console.error('Error fetching revenue stats:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
