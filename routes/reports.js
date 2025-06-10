const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');

// Financial Reports
router.get('/revenue', async (req, res) => {
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
          if (wash.washStatus === 'completed') {
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

// Customer Reports
router.get('/customers', async (req, res) => {
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

// Washer Reports
router.get('/washers', async (req, res) => {
  try {
    const { startDate, endDate, washerId } = req.query;
    const matchConditions = {};

    if (startDate && endDate) {
      matchConditions.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (washerId) {
      matchConditions['washHistory.washer'] = washerId;
    }

    const washers = await Lead.aggregate([
      { $unwind: '$washHistory' },
      {
        $match: {
          'washHistory.washStatus': 'completed',
          ...matchConditions
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
              area: '$area'
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'washerDetails'
        }
      },
      { $unwind: '$washerDetails' }
    ]);

    res.json(washers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


router.get('/revenue_and_income', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      washType,
      area,
      customerType
    } = req.query;

    // Build query based on filters
    const query = { status: 'Converted' };
    
    // Apply date range filter if provided
    if (startDate || endDate) {
      query['washHistory.date'] = {};
      if (startDate) {
        query['washHistory.date'].$gte = new Date(startDate);
      }
      if (endDate) {
        query['washHistory.date'].$lte = new Date(endDate);
      }
    }

    // Apply wash type filter if provided
    if (washType) {
      query['washHistory.washType'] = washType;
    }

    // Apply area filter if provided
    if (area) {
      query.area = { $regex: area, $options: 'i' };
    }

    // Apply customer type filter if provided
    if (customerType) {
      query.leadType = customerType === 'Monthly' ? 'Monthly' : 'One-time';
    }

    // Aggregate to calculate revenue statistics
    const revenueStats = await Lead.aggregate([
      { $match: query },
      { $unwind: '$washHistory' },
      // Apply filters on the unwound washHistory
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
          _id: null,
          totalRevenue: { $sum: '$washHistory.amount' },
          totalWashes: { $sum: 1 },
          totalCustomers: { $addToSet: '$_id' }
        }
      },
      {
        $project: {
          _id: 0,
          totalRevenue: 1,
          totalWashes: 1,
          totalCustomers: { $size: '$totalCustomers' }
        }
      }
    ]);

    // Get revenue breakdown by wash type
    const revenueByWashType = await Lead.aggregate([
      { $match: query },
      { $unwind: '$washHistory' },
      // Apply filters on the unwound washHistory
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
          revenue: { $sum: '$washHistory.amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get revenue breakdown by customer type
    const revenueByCustomerType = await Lead.aggregate([
      { $match: query },
      { $unwind: '$washHistory' },
      // Apply filters on the unwound washHistory
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
          revenue: { $sum: '$washHistory.amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get recent transactions
    const recentTransactions = await Lead.aggregate([
      { $match: query },
      { $unwind: '$washHistory' },
      // Apply filters on the unwound washHistory
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
          washerName: { $arrayElemAt: ['$washerInfo.name', 0] },
          customerType: '$leadType',
          isPaid: { $ifNull: ['$washHistory.is_amountPaid', false] }
        }
      },
      { $sort: { date: -1 } } // Sort by date descending
    ]);

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

    // Calculate paid vs unpaid revenue
    const paidUnpaidSummary = await Lead.aggregate([
      { $match: query },
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
          _id: null,
          total: { $sum: '$washHistory.amount' },
          paid: { $sum: { $cond: [{ $eq: ['$washHistory.is_amountPaid', true] }, '$washHistory.amount', 0] } },
          unpaid: { $sum: { $cond: [{ $ne: ['$washHistory.is_amountPaid', true] }, '$washHistory.amount', 0] } }
        }
      }
    ]);

    res.json({
      totalRevenue: revenueStats[0]?.totalRevenue || 0,
      totalWashes: revenueStats[0]?.totalWashes || 0,
      totalCustomers: revenueStats[0]?.totalCustomers || 0,
      revenueByWashType: revenueByWashTypeMap,
      washesByType: washesByTypeMap,
      revenueByCustomerType: revenueByCustomerTypeMap,
      customersByType: customersByTypeMap,
      recentTransactions: recentTransactions,
      paymentSummary: paidUnpaidSummary[0] || { total: 0, paid: 0, unpaid: 0 }
    });
  } catch (error) {
    console.error('Error fetching revenue stats:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
