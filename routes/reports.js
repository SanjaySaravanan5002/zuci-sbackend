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

// Washer Reports - Available to all admin types
router.get('/washers', auth, authorize('superadmin', 'admin', 'limited_admin'), async (req, res) => {
  try {
    const { startDate, endDate, washerId, monthly } = req.query;
    // Build match conditions
    let washHistoryMatch = {
      'washHistory.washStatus': 'completed',
      'washHistory.is_amountPaid': true
    };
    
    let monthlyMatch = {
      'monthlySubscription.scheduledWashes.status': 'completed',
      'monthlySubscription.scheduledWashes.is_amountPaid': true
    };

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      washHistoryMatch['washHistory.date'] = { $gte: start, $lte: end };
      monthlyMatch['monthlySubscription.scheduledWashes.completedDate'] = { $gte: start, $lte: end };
    }

    if (washerId) {
      let washerObjectId;
      if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
        washerObjectId = new mongoose.Types.ObjectId(washerId);
      } else {
        const user = await User.findOne({ id: parseInt(washerId) });
        if (user) {
          washerObjectId = user._id;
        }
      }
      
      if (washerObjectId) {
        washHistoryMatch['washHistory.washer'] = washerObjectId;
        monthlyMatch['monthlySubscription.scheduledWashes.washer'] = washerObjectId;
      }
    }

    // Get wash history data
    const washHistoryData = await Lead.aggregate([
      { $unwind: '$washHistory' },
      { $match: washHistoryMatch },
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
      { $match: monthlyMatch },
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
        
        // Get monthly wash count
        const monthlyWashCount = await Lead.aggregate([
          { $unwind: '$washHistory' },
          {
            $match: {
              'washHistory.washer': washer._id,
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
              'washHistory.washer': washer._id,
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

        // Get attendance data for the period
        let attendance = null;
        if (washerDetails?.attendance) {
          const attendanceData = washerDetails.attendance.filter(att => {
            if (!startDate || !endDate) return true;
            const attDate = new Date(att.date);
            return attDate >= new Date(startDate) && attDate <= new Date(endDate);
          });
          
          const presentDays = attendanceData.filter(att => att.status === 'present').length;
          const totalDays = attendanceData.length;
          
          attendance = {
            presentDays,
            totalDays,
            percentage: totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0,
            details: attendanceData.map(att => ({
              date: att.date,
              status: att.status,
              timeIn: att.timeIn,
              timeOut: att.timeOut,
              duration: att.duration
            }))
          };
        }

        // Calculate performance metrics
        const performance = {
          avgWashesPerDay: attendance?.presentDays > 0 ? Math.round(washer.totalWashes / attendance.presentDays * 10) / 10 : 0,
          avgRevenuePerWash: washer.totalWashes > 0 ? Math.round(washer.totalRevenue / washer.totalWashes) : 0,
          completionRate: washer.totalWashes > 0 ? Math.round((washer.totalWashes / washer.totalWashes) * 100) : 100
        };

        return {
          _id: washer._id,
          totalWashes: washer.totalWashes,
          totalRevenue: washer.totalRevenue,
          completedWashes: washer.completedWashes,
          washerName: washerDetails?.name || 'Unknown Washer',
          washerPhone: washerDetails?.phone || 'N/A',
          washerEmail: washerDetails?.email || 'N/A',
          washerStatus: washerDetails?.status || 'Unknown',
          monthlyWashCount,
          customerDetails,
          attendance,
          performance
        };
      })
    );

    res.json(washers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
