const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const { auth, authorize } = require('../middleware/auth');

// Helper function to create wash object
const createWashObject = (lead, washData, type, index = 0) => {
  const { washType, scheduledDate, washer, status, _id } = washData;
  
  return {
    _id: `${type}_${lead._id}${index ? `_${index}` : ''}`,
    customerName: lead.customerName,
    phone: lead.phone,
    area: lead.area,
    carModel: lead.carModel,
    washType: washType || lead.leadType || 'Basic',
    scheduledDate: scheduledDate.toISOString(),
    washer: washer || lead.assignedWasher,
    leadId: lead._id,
    status: determineStatus(status, washer || lead.assignedWasher)
  };
};

// Helper function to determine status
const determineStatus = (washStatus, washer) => {
  if (washStatus === 'completed') return 'completed';
  if (washer) return 'assigned';
  return 'pending';
};

// Validate date parameters
const validateDates = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid date format provided');
  }
  
  if (start > end) {
    throw new Error('Start date cannot be after end date');
  }
  
  return { start, end };
};

// Build optimized MongoDB query
const buildOptimizedQuery = (start, end) => {
  return {
    $or: [
      // One-time washes within date range
      {
        'oneTimeWash.scheduledDate': { $gte: start, $lte: end }
      },
      // Monthly subscription washes within date range
      {
        'monthlySubscription.scheduledWashes.scheduledDate': { $gte: start, $lte: end }
      },
      // Wash history within date range
      {
        'washHistory.date': { $gte: start, $lte: end }
      },
      // Recently assigned leads without specific dates
      {
        assignedWasher: { $exists: true },
        $and: [
          { 'washHistory.0': { $exists: false } },
          { oneTimeWash: { $exists: false } },
          { 'monthlySubscription.scheduledWashes.0': { $exists: false } }
        ],
        createdAt: { $gte: start, $lte: end }
      }
    ]
  };
};

// Get scheduled washes for calendar view
router.get('/scheduled-washes', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false,
        message: 'Start date and end date are required',
        code: 'MISSING_DATES'
      });
    }

    const { start, end } = validateDates(startDate, endDate);
    
    // Optimized query to fetch only relevant leads
    const query = buildOptimizedQuery(start, end);
    
    const leads = await Lead.find(query)
      .populate('assignedWasher', 'name')
      .populate('washHistory.washer', 'name')
      .populate('monthlySubscription.scheduledWashes.washer', 'name')
      .populate('oneTimeWash.washer', 'name')
      .lean(); // Use lean() for better performance

    const scheduledWashes = [];

    leads.forEach(lead => {
      // Process one-time wash
      if (lead.oneTimeWash) {
        const washDate = lead.oneTimeWash.scheduledDate ? 
          new Date(lead.oneTimeWash.scheduledDate) : 
          new Date(new Date().setHours(0, 0, 0, 0));
        
        if (washDate >= start && washDate <= end) {
          scheduledWashes.push(createWashObject(lead, {
            washType: lead.oneTimeWash.washType,
            scheduledDate: washDate,
            washer: lead.oneTimeWash.washer,
            status: lead.oneTimeWash.status
          }, 'onetime'));
        }
      }
      
      // Process monthly subscription washes
      if (lead.monthlySubscription?.scheduledWashes) {
        lead.monthlySubscription.scheduledWashes.forEach((scheduledWash, index) => {
          const washDate = new Date(scheduledWash.scheduledDate);
          if (washDate >= start && washDate <= end) {
            scheduledWashes.push(createWashObject(lead, {
              washType: lead.monthlySubscription.packageType,
              scheduledDate: washDate,
              washer: scheduledWash.washer,
              status: scheduledWash.status
            }, 'monthly', index));
          }
        });
      }
      
      // Process wash history
      if (lead.washHistory?.length > 0) {
        lead.washHistory.forEach((wash, index) => {
          const washDate = new Date(wash.date);
          if (!isNaN(washDate.getTime()) && washDate >= start && washDate <= end) {
            scheduledWashes.push(createWashObject(lead, {
              washType: wash.washType,
              scheduledDate: washDate,
              washer: wash.washer,
              status: wash.washStatus
            }, 'history', index));
          }
        });
      }
      
      // Process unscheduled assigned leads
      if (!lead.washHistory?.length && 
          !lead.oneTimeWash && 
          !lead.monthlySubscription?.scheduledWashes?.length &&
          lead.assignedWasher) {
        
        const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
        
        if (todayStart >= start && todayStart <= end) {
          scheduledWashes.push(createWashObject(lead, {
            washType: lead.leadType,
            scheduledDate: todayStart,
            washer: null,
            status: 'assigned'
          }, 'lead'));
        }
      }
    });

    // Remove duplicates and sort
    const uniqueWashes = scheduledWashes.filter((wash, index, self) => 
      index === self.findIndex(w => w._id === wash._id)
    );
    
    uniqueWashes.sort((a, b) => {
      const dateA = new Date(a.scheduledDate);
      const dateB = new Date(b.scheduledDate);
      if (dateA.getTime() === dateB.getTime()) {
        const statusPriority = { assigned: 0, pending: 1, completed: 2 };
        return statusPriority[a.status] - statusPriority[b.status];
      }
      return dateA.getTime() - dateB.getTime();
    });
    
    res.json({
      success: true,
      data: uniqueWashes,
      count: uniqueWashes.length,
      dateRange: { start: start.toISOString(), end: end.toISOString() }
    });
    
  } catch (error) {
    console.error('Error fetching scheduled washes:', error);
    
    // Structured error response
    const errorResponse = {
      success: false,
      message: error.message || 'Failed to fetch scheduled washes',
      code: error.name || 'FETCH_ERROR'
    };
    
    if (error.message.includes('Invalid date')) {
      return res.status(400).json(errorResponse);
    }
    
    res.status(500).json(errorResponse);
  }
});

module.exports = router;