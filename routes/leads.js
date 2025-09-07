const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');
const { autoGenerateScheduledWashes } = require('../utils/subscriptionScheduler');

// Get all leads with filters (exclude template leads)
router.get('/', auth, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const {
      searchQuery,
      leadType,
      leadSource,
      status,
      startDate,
      endDate
    } = req.query;

    // Build filter object
    const filter = {};

    // Search query filter (name, phone, or area)
    if (searchQuery) {
      filter.$or = [
        { customerName: { $regex: searchQuery, $options: 'i' } },
        { phone: { $regex: searchQuery, $options: 'i' } },
        { area: { $regex: searchQuery, $options: 'i' } }
      ];
    }

    // Lead type filter
    if (leadType) {
      filter.leadType = leadType;
    }

    // Lead source filter
    if (leadSource) {
      filter.leadSource = leadSource;
    }

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate);
      }
    }

    // Exclude template leads from regular lead queries
    filter.customerName = { $not: /^Template-/ };
    
    const leads = await Lead.find(filter)
      .populate('assignedWasher', 'name')
      .sort({ id: -1 }); // Sort by auto-incrementing ID

    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get existing custom plans
router.get('/custom-plans', async (req, res) => {
  try {
    const customPlans = await Lead.aggregate([
      {
        $match: {
          'monthlySubscription.packageType': 'Custom',
          'monthlySubscription.customPlanName': { $exists: true, $ne: '' }
        }
      },
      {
        $group: {
          _id: '$monthlySubscription.customPlanName',
          name: { $first: '$monthlySubscription.customPlanName' },
          washes: { $first: '$monthlySubscription.totalWashes' },
          price: { $first: '$monthlySubscription.monthlyPrice' },
          interiorWashes: { $first: '$monthlySubscription.totalInteriorWashes' }
        }
      },
      {
        $sort: { name: 1 }
      }
    ]);

    res.json(customPlans);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create new custom plan template
router.post('/custom-plans', auth, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { name, price, washes, interiorWashes } = req.body;
    
    if (!name || !price || !washes) {
      return res.status(400).json({ message: 'Plan name, price, and number of washes are required' });
    }

    // Check if plan name already exists
    const existingPlan = await Lead.findOne({
      'monthlySubscription.customPlanName': name
    });
    
    if (existingPlan) {
      return res.status(400).json({ message: 'Plan name already exists' });
    }

    // Create a template lead entry to store the custom plan
    const templateLead = new Lead({
      customerName: `Template-${name}`,
      phone: `template-${Date.now()}`,
      area: 'Template',
      carModel: 'Template',
      leadType: 'Monthly',
      leadSource: 'Other',
      status: 'Converted',
      location: {
        type: 'Point',
        coordinates: [0, 0]
      },
      monthlySubscription: {
        packageType: 'Custom',
        customPlanName: name,
        totalWashes: parseInt(washes),
        totalInteriorWashes: parseInt(interiorWashes) || 0,
        monthlyPrice: parseFloat(price),
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isTemplate: true,
        isActive: false,
        scheduledWashes: [],
        completedWashes: 0
      }
    });

    await templateLead.save();
    
    res.json({ 
      message: 'Custom plan created successfully',
      plan: {
        name,
        price: parseFloat(price),
        washes: parseInt(washes),
        interiorWashes: parseInt(interiorWashes) || 0
      }
    });
  } catch (error) {
    console.error('Error creating custom plan:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get upcoming washes
router.get('/upcoming-washes', auth, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { date = 'today', type, source, search } = req.query;
    
    // Calculate date range - use current date
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let startDate, endDate;
    switch (date) {
      case 'tomorrow':
        startDate = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        endDate = new Date(today.getTime() + 48 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(today);
        endDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      default: // today
        startDate = new Date(today);
        endDate = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    }
    
    // Find all leads with proper population - FIXED: Remove assignedWasher filter
    const allLeads = await Lead.find({})
      .populate('assignedWasher', 'name')
      .populate('washHistory.washer', 'name')
      .populate('monthlySubscription.scheduledWashes.washer', 'name')
      .populate('oneTimeWash.washer', 'name')
      .sort({ createdAt: -1 });
    
    const upcomingWashes = [];
    
    allLeads.forEach(lead => {
      let hasUpcomingWash = false;
      let upcomingWashDetails = null;
      
      // Check monthly subscription scheduled washes FIRST - FIXED
      if (lead.leadType === 'Monthly' && lead.monthlySubscription?.scheduledWashes) {
        const upcomingMonthlyWash = lead.monthlySubscription.scheduledWashes.find(w => {
          const washDate = new Date(w.scheduledDate);
          return washDate >= startDate && washDate < endDate && 
                 ['scheduled', 'pending'].includes(w.status);
        });
        
        if (upcomingMonthlyWash) {
          hasUpcomingWash = true;
          upcomingWashDetails = {
            date: upcomingMonthlyWash.scheduledDate,
            washType: lead.monthlySubscription.packageType || lead.monthlySubscription.customPlanName,
            washer: upcomingMonthlyWash.washer?.name || lead.assignedWasher?.name,
            status: upcomingMonthlyWash.status
          };
        }
      }
      
      // Check one-time wash if no monthly wash found
      if (!hasUpcomingWash && lead.leadType === 'One-time' && lead.oneTimeWash?.scheduledDate) {
        const washDate = new Date(lead.oneTimeWash.scheduledDate);
        if (washDate >= startDate && washDate < endDate && 
            ['scheduled', 'pending'].includes(lead.oneTimeWash.status)) {
          hasUpcomingWash = true;
          upcomingWashDetails = {
            date: lead.oneTimeWash.scheduledDate,
            washType: lead.oneTimeWash.washType,
            washer: lead.oneTimeWash.washer?.name || lead.assignedWasher?.name,
            status: lead.oneTimeWash.status
          };
        }
      }
      
      // Check wash history for pending washes if no specific wash found
      if (!hasUpcomingWash && lead.washHistory?.length > 0) {
        const pendingWash = lead.washHistory.find(w => {
          const washDate = new Date(w.date);
          return washDate >= startDate && washDate < endDate && 
                 ['scheduled', 'pending'].includes(w.washStatus);
        });
        
        if (pendingWash) {
          hasUpcomingWash = true;
          upcomingWashDetails = {
            date: pendingWash.date,
            washType: pendingWash.washType,
            washer: pendingWash.washer?.name || lead.assignedWasher?.name,
            status: pendingWash.washStatus
          };
        }
      }
    
      // Only include leads with upcoming washes and apply filters
      if (hasUpcomingWash && upcomingWashDetails) {
        // Apply filters
        if (type && lead.leadType !== type) return;
        if (source && lead.leadSource !== source) return;
        if (search) {
          const searchLower = search.toLowerCase();
          if (!lead.customerName.toLowerCase().includes(searchLower) &&
              !lead.phone.includes(search) &&
              !lead.area.toLowerCase().includes(searchLower)) {
            return;
          }
        }
        
        // Get last completed wash
        let lastWash = null;
        if (lead.washHistory && lead.washHistory.length > 0) {
          const completedWashes = lead.washHistory
            .filter(w => w.washStatus === 'completed')
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          
          if (completedWashes.length > 0) {
            const wash = completedWashes[0];
            lastWash = {
              date: wash.date,
              washer: wash.washer?.name || 'Unknown',
              washType: wash.washServiceType || wash.washType
            };
          }
        }
        
        upcomingWashes.push({
          id: lead.id,
          customerName: lead.customerName,
          phone: lead.phone,
          area: lead.area,
          carModel: lead.carModel,
          leadType: lead.leadType,
          leadSource: lead.leadSource,
          status: lead.status,
          createdAt: lead.createdAt,
          lastWash,
          upcomingWash: upcomingWashDetails
        });
      }
    });
    
    console.log(`Date filter: ${date}, Start: ${startDate}, End: ${endDate}`);
    console.log(`Total upcoming washes found: ${upcomingWashes.length}`);
    console.log('Monthly customers:', upcomingWashes.filter(w => w.leadType === 'Monthly').map(w => w.customerName));
    
    res.json(upcomingWashes);
  } catch (error) {
    console.error('Error fetching upcoming washes:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get leads statistics (MOVED BEFORE PARAMETERIZED ROUTES)
router.get('/stats/overview', async (req, res) => {
  try {
    const { leadType, leadSource, dateRange, status } = req.query;

    // Build query based on filters
    const query = {};
    if (leadType) query.leadType = leadType;
    if (leadSource) query.leadSource = leadSource;
    if (dateRange?.start && dateRange?.end) {
      query.createdAt = {
        $gte: new Date(dateRange.start),
        $lte: new Date(dateRange.end)
      };
    }

    // Get total leads
    const totalLeads = await Lead.countDocuments(query);

    // Get new leads today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newToday = await Lead.countDocuments({
      ...query,
      createdAt: { $gte: today }
    });

    // Get pending follow-ups
    const followUpQuery = {
      ...query,
      status: 'New',
      lastFollowUp: { 
        $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // More than 24 hours ago
      }
    };
    const pendingFollowUps = await Lead.countDocuments(followUpQuery);

    // Get converted leads
    const convertedLeads = await Lead.countDocuments({
      ...query,
      status: 'Converted'
    });

    // Get total revenue and wash stats for converted leads
    const revenueStats = await Lead.aggregate([
      { $match: { ...query, status: 'Converted' } },
      {
        $project: {
          completedWashes: {
            $filter: {
              input: '$washHistory',
              as: 'wash',
              cond: { $eq: ['$$wash.washStatus', 'completed'] }
            }
          }
        }
      },
      {
        $project: {
          totalAmount: { $sum: '$completedWashes.amount' },
          hasCompletedWash: { $gt: [{ $size: '$completedWashes' }, 0] }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalWashes: { $sum: { $cond: ['$hasCompletedWash', 1, 0] } }
        }
      }
    ]);

    // Get area distribution
    const areaStats = await Lead.aggregate([
      { $match: { ...query, status: 'Converted' } },
      {
        $group: {
          _id: '$area',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get type distribution
    const typeStats = await Lead.aggregate([
      { $match: { ...query, status: 'Converted' } },
      {
        $group: {
          _id: '$leadType',
          count: { $sum: 1 }
        }
      }
    ]);

    const areaDistribution = areaStats.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    const typeDistribution = typeStats.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    res.json({
      totalLeads,
      newToday,
      pendingFollowUps,
      convertedLeads,
      totalRevenue: revenueStats[0]?.totalRevenue || 0,
      totalWashes: revenueStats[0]?.totalWashes || 0,
      areaDistribution,
      typeDistribution
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get assigned one-time washes for washer
router.get('/washer/:washerId/onetime-washes', async (req, res) => {
  try {
    const washerId = req.params.washerId;
    
    const leads = await Lead.find({
      'oneTimeWash.washer': washerId,
      'oneTimeWash.status': 'pending'
    })
    .populate('oneTimeWash.washer', 'name')
    .select('id customerName phone area oneTimeWash');

    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get leads with monthly subscriptions for washer (both active and completed)
router.get('/washer/:washerId/monthly-subscriptions', async (req, res) => {
  try {
    const washerId = req.params.washerId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const leads = await Lead.find({
      assignedWasher: washerId,
      leadType: 'Monthly',
      monthlySubscription: { $exists: true },
      $or: [
        // Active subscriptions with today's scheduled washes
        {
          'monthlySubscription.isActive': true,
          'monthlySubscription.scheduledWashes': {
            $elemMatch: {
              scheduledDate: {
                $gte: today,
                $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
              },
              status: 'scheduled'
            }
          }
        },
        // Recently completed subscriptions (within last 7 days)
        {
          'monthlySubscription.isActive': false,
          'monthlySubscription.completedWashes': { $gte: 1 },
          'monthlySubscription.scheduledWashes': {
            $elemMatch: {
              status: 'completed',
              completedDate: {
                $gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
              }
            }
          }
        }
      ]
    })
    .populate('assignedWasher', 'name')
    .populate('monthlySubscription.scheduledWashes.washer', 'name')
    .select('id customerName phone area monthlySubscription');

    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create new lead
router.post('/', async (req, res) => {
  try {
    // For one-time leads, check if customer already exists
    if (req.body.leadType === 'One-time') {
      const existingLead = await Lead.findOne({ 
        phone: req.body.phone,
        leadType: 'One-time'
      });
      
      if (existingLead) {
        // Return existing lead instead of creating new one
        const populatedLead = await Lead.findById(existingLead._id)
          .populate('assignedWasher', 'name');
        return res.status(200).json(populatedLead);
      }
    }

    const lead = new Lead({
      customerName: req.body.name,
      phone: req.body.phone,
      area: req.body.area,
      carModel: req.body.carModel,
      leadType: req.body.leadType,
      leadSource: req.body.leadSource,
      assignedWasher: req.body.assignedWasher,
      notes: req.body.notes,
      status: 'New',
      location: {
        type: 'Point',
        coordinates: req.body.coordinates || [0, 0] // Default coordinates if not provided
      }
    });

    const newLead = await lead.save();
    // Populate the washer information before sending response
    const populatedLead = await Lead.findById(newLead._id)
      .populate('assignedWasher', 'name');

    res.status(201).json(populatedLead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Get lead by ID (handles both numeric ID and MongoDB ObjectId)
router.get('/:id', async (req, res) => {
  try {
    let lead;
    
    // Try numeric ID first
    if (!isNaN(req.params.id)) {
      lead = await Lead.findOne({ id: parseInt(req.params.id) })
        .populate('assignedWasher', 'name');
    }
    
    // If not found by numeric ID and ID looks like ObjectId, try MongoDB ID
    if (!lead && req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      lead = await Lead.findById(req.params.id)
        .populate('assignedWasher', 'name');
    }
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update lead
router.put('/:id', async (req, res) => {
  try {
    const updates = {
      customerName: req.body.name,
      phone: req.body.phone,
      area: req.body.area,
      carModel: req.body.carModel,
      leadType: req.body.leadType,
      leadSource: req.body.leadSource,
      assignedWasher: req.body.assignedWasher,
      notes: req.body.notes,
      status: req.body.status
    };

    // Remove undefined fields
    Object.keys(updates).forEach(key => 
      updates[key] === undefined && delete updates[key]
    );

    let lead;
    // Try to find by numeric ID first
    if (!isNaN(req.params.id)) {
      lead = await Lead.findOneAndUpdate(
        { id: parseInt(req.params.id) },
        updates,
        { new: true }
      ).populate('assignedWasher', 'name');
    }

    // If not found by numeric ID or if ID is not numeric, try MongoDB ObjectId
    if (!lead && req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      lead = await Lead.findByIdAndUpdate(
        req.params.id,
        updates,
        { new: true }
      ).populate('assignedWasher', 'name');
    }

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    res.json(lead);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete lead
router.delete('/:id', async (req, res) => {
  try {
    let lead;
    
    // Try numeric ID first
    if (!isNaN(req.params.id)) {
      lead = await Lead.findOneAndDelete({ id: parseInt(req.params.id) });
    }
    
    // If not found by numeric ID and ID looks like ObjectId, try MongoDB ID
    if (!lead && req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      lead = await Lead.findByIdAndDelete(req.params.id);
    }
    
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Assign one-time wash to lead
router.put('/:id/assign-onetime', async (req, res) => {
  try {
    const { washType, amount, scheduledDate, washerId, paymentStatus, completionStatus, washServiceType } = req.body;
    
    const lead = await Lead.findOne({ id: parseInt(req.params.id) });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const washer = await User.findOne({ id: parseInt(washerId) });
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Check if scheduled date is today or tomorrow for auto-assignment
    const washDate = new Date(scheduledDate);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const isToday = washDate.toDateString() === today.toDateString();
    const isTomorrow = washDate.toDateString() === tomorrow.toDateString();

    // Assign one-time wash
    lead.oneTimeWash = {
      washType,
      amount,
      scheduledDate: new Date(scheduledDate),
      washer: washer._id,
      status: completionStatus || 'pending',
      is_amountPaid: paymentStatus || false,
      washServiceType: washServiceType || 'Exterior'
    };

    // Auto-assign washer to lead if wash is today or tomorrow
    if (isToday || isTomorrow) {
      lead.assignedWasher = washer._id;
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedWasher', 'name')
      .populate('oneTimeWash.washer', 'name');

    res.json({
      ...updatedLead.toObject(),
      autoAssigned: isToday || isTomorrow,
      assignmentDate: washDate.toDateString()
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update one-time wash status (for washers)
router.put('/:id/onetime-wash/update', async (req, res) => {
  try {
    const { status, feedback, startTime, endTime, duration } = req.body;
    
    const lead = await Lead.findOne({ id: parseInt(req.params.id) });
    if (!lead || !lead.oneTimeWash) {
      return res.status(404).json({ message: 'Lead or one-time wash not found' });
    }

    lead.oneTimeWash.status = status;
    
    if (status === 'completed') {
      // Calculate and store duration in one-time wash
      if (startTime && endTime) {
        const start = new Date(startTime);
        const end = new Date(endTime);
        lead.oneTimeWash.duration = Math.round((end - start) / (1000 * 60)); // in minutes
      } else if (duration) {
        lead.oneTimeWash.duration = parseInt(duration);
      }
      
      // Add to wash history when completed with timing data
      lead.washHistory.push({
        washType: lead.oneTimeWash.washType,
        washer: lead.oneTimeWash.washer,
        amount: lead.oneTimeWash.amount,
        date: new Date(),
        feedback: feedback || '',
        is_amountPaid: false,
        washStatus: 'completed',
        washServiceType: lead.oneTimeWash.washServiceType || 'Exterior',
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : new Date(),
        duration: lead.oneTimeWash.duration || duration || 0
      });
      
      lead.status = 'Converted';
      
      // Create customer if needed
      if (lead.leadType === 'One-time' && lead.washHistory.length >= 2) {
        await createOrUpdateCustomer(lead);
      }
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedWasher', 'name')
      .populate('oneTimeWash.washer', 'name')
      .populate('washHistory.washer', 'name');

    res.json(updatedLead);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Assign washer to lead
router.put('/:id/assign', async (req, res) => {
  try {
    console.log("req.body", req.body);
    const { washerId, washDate, washType, amount } = req.body;
    console.log("washerId", washerId);
    if (!washerId) {
      return res.status(400).json({ message: 'Washer ID is required' });
    }

    // Find washer by numeric ID
    const washer = await User.findOne({ id: parseInt(washerId) });
    console.log("washer", washer);
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    const lead = await Lead.findOne({ id: parseInt(req.params.id) });
    console.log("lead", lead);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Update lead with washer's MongoDB ID
    lead.assignedWasher = washer._id;
    
    // If washDate is provided, create appropriate wash entry for upcoming wash
    if (washDate) {
      const scheduledDate = new Date(washDate);
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const isToday = scheduledDate.toDateString() === today.toDateString();
      const isTomorrow = scheduledDate.toDateString() === tomorrow.toDateString();
      
      if (lead.leadType === 'One-time') {
        // Create or update one-time wash
        lead.oneTimeWash = {
          washType: washType || 'Basic',
          amount: amount || 100,
          scheduledDate: scheduledDate,
          washer: washer._id,
          status: 'pending',
          is_amountPaid: false,
          washServiceType: 'Exterior'
        };
      } else {
        // For monthly or other types, add to wash history with pending status
        lead.washHistory.push({
          washType: washType || 'Basic',
          washer: washer._id,
          amount: amount || 100,
          date: scheduledDate,
          feedback: '',
          is_amountPaid: false,
          washStatus: 'pending',
          washServiceType: 'Exterior'
        });
      }
      
      // Mark as converted if wash is assigned
      lead.status = 'Converted';
    }
    
    console.log("lead", lead);
    await lead.save();

    // Customer creation logic
    const Customer = require('../models/Customer');
    if (lead.leadType === 'Monthly') {
      // For Monthly leads, create customer immediately after first wash
      await createOrUpdateCustomer(lead);
    } else if (lead.leadType === 'One-time' && lead.washHistory.length >= 2) {
      // For One-time leads, create customer only after 2nd wash
      await createOrUpdateCustomer(lead);
    }

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedWasher', 'name')
      .populate('oneTimeWash.washer', 'name')
      .populate('washHistory.washer', 'name');
    console.log("updatedLead", updatedLead);

    res.json({
      ...updatedLead.toObject(),
      message: washDate ? 'Washer assigned and wash scheduled successfully' : 'Washer assigned successfully'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get detailed revenue statistics
// Get wash history for a lead
router.get('/:id/wash-history', async (req, res) => {
  try {
    const lead = await Lead.findOne({ id: parseInt(req.params.id) })
      .populate({
        path: 'washHistory.washer',
        select: 'name'
      })
      .select('washHistory');

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Sort wash history by date (newest first)
    const sortedWashHistory = lead.washHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(sortedWashHistory);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add wash history entry (from Add Wash Entry modal)
router.post('/:id/wash-history', async (req, res) => {
  try {
    const lead = await Lead.findOne({ id: req.params.id });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const { washType, washerId, amount, date, feedback, is_amountPaid, washStatus, washServiceType } = req.body;

    // Find washer by ID
    let washer = null;
    if (washerId) {
      if (!isNaN(washerId)) {
        washer = await User.findOne({ id: parseInt(washerId) });
      } else if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
        washer = await User.findById(washerId);
      }
    }

    // Add wash history entry
    const washEntry = {
      washType,
      washer: washer ? washer._id : null,
      amount: parseFloat(amount) || 0,
      date: date ? new Date(date) : new Date(),
      feedback: feedback || '',
      is_amountPaid: Boolean(is_amountPaid),
      washStatus: washStatus || 'pending',
      washServiceType: washServiceType || 'Exterior'
    };

    lead.washHistory.push(washEntry);
    lead.status = 'Converted';

    // Auto-assign washer based on wash date if it's today or tomorrow
    // Parse MM/DD/YYYY format
    let washDate;
    if (date && date.includes('/')) {
      const [month, day, year] = date.split('/');
      washDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    } else {
      washDate = new Date(date || new Date());
    }
    
    // Use current date
    const today = new Date(); // Use actual current date
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const washDateLocal = new Date(washDate.getFullYear(), washDate.getMonth(), washDate.getDate());
    const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const tomorrowLocal = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
    
    const isToday = washDateLocal.getTime() === todayLocal.getTime();
    const isTomorrow = washDateLocal.getTime() === tomorrowLocal.getTime();
    
    if ((isToday || isTomorrow) && washer) {
      // Always assign washer to lead for today/tomorrow washes
      lead.assignedWasher = washer._id;
      
      // Also ensure the wash entry has the washer assigned
      washEntry.washer = washer._id;
    }

    await lead.save();

    // Get updated wash history with populated washer info
    const updatedLead = await Lead.findById(lead._id)
      .populate('washHistory.washer', 'name')
      .populate('assignedWasher', 'name')
      .select('washHistory assignedWasher');

    res.json({
      washHistory: updatedLead.washHistory,
      assignedWasher: updatedLead.assignedWasher,
      autoAssigned: (isToday || isTomorrow) && washer ? true : false,
      assignmentDate: washDate.toDateString()
    });
  } catch (err) {
    console.error('Error adding wash history:', err);
    res.status(500).json({ message: err.message });
  }
});

// Helper function to create or update customer
async function createOrUpdateCustomer(lead) {
  const Customer = require('../models/Customer');
  
  try {
    let customer = await Customer.findOne({ phone: lead.phone });
    
    if (!customer) {
      // Create new customer
      customer = new Customer({
        customerName: lead.customerName,
        phone: lead.phone,
        area: lead.area,
        carModel: lead.carModel,
        customerType: lead.leadType,
        leadSource: lead.leadSource,
        totalWashes: lead.washHistory.length,
        totalAmount: lead.washHistory.reduce((sum, wash) => sum + (wash.amount || 0), 0),
        lastWashDate: lead.washHistory[lead.washHistory.length - 1]?.date
      });
      await customer.save();
    } else {
      // Update existing customer
      customer.totalWashes = lead.washHistory.length;
      customer.totalAmount = lead.washHistory.reduce((sum, wash) => sum + (wash.amount || 0), 0);
      customer.lastWashDate = lead.washHistory[lead.washHistory.length - 1]?.date;
      await customer.save();
    }
  } catch (error) {
    console.error('Error creating/updating customer:', error);
  }
}

// Start wash (for washers)
router.put('/:id/wash-history/:entryId/start', async (req, res) => {
  try {
    const { id, entryId } = req.params;
    const lead = await Lead.findOne({ id: parseInt(id) });
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const washEntry = lead.washHistory.id(entryId);
    if (!washEntry) return res.status(404).json({ message: 'Wash entry not found' });

    washEntry.startTime = new Date();
    washEntry.washStatus = 'in-progress';
    await lead.save();

    res.json({ message: 'Wash started', startTime: washEntry.startTime });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// End wash (for washers)
router.put('/:id/wash-history/:entryId/end', async (req, res) => {
  try {
    const { id, entryId } = req.params;
    const { feedback, amountPaid } = req.body;
    
    const lead = await Lead.findOne({ id: parseInt(id) });
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const washEntry = lead.washHistory.id(entryId);
    if (!washEntry) return res.status(404).json({ message: 'Wash entry not found' });

    washEntry.endTime = new Date();
    washEntry.washStatus = 'completed';
    washEntry.feedback = feedback || '';
    washEntry.is_amountPaid = Boolean(amountPaid);
    
    if (washEntry.startTime) {
      washEntry.duration = Math.round((washEntry.endTime - washEntry.startTime) / (1000 * 60)); // minutes
    }
    
    await lead.save();
    res.json({ 
      message: 'Wash completed', 
      duration: washEntry.duration,
      endTime: washEntry.endTime 
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update wash history entry (for washers to update status, payment, feedback)
router.put('/:id/wash-history/:entryId', async (req, res) => {
  try {
    const { id, entryId } = req.params;
    const { washType, washerId, amount, date, feedback, amountPaid, washStatus, washServiceType } = req.body;

    // Find the lead
    const lead = await Lead.findOne({ id: parseInt(id) });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Find the wash history entry
    const washEntry = lead.washHistory.id(entryId);
    if (!washEntry) {
      return res.status(404).json({ message: 'Wash entry not found' });
    }

    // Update fields (washers can update status, payment, and feedback)
    if (washType !== undefined) washEntry.washType = washType;
    if (amount !== undefined) washEntry.amount = amount;
    if (date !== undefined) washEntry.date = new Date(date);
    if (feedback !== undefined) washEntry.feedback = feedback;
    if (amountPaid !== undefined) washEntry.is_amountPaid = Boolean(amountPaid);
    if (washStatus !== undefined) {
      washEntry.washStatus = washStatus;
      if (washStatus === 'completed' && !washEntry.endTime) {
        washEntry.endTime = new Date();
        if (washEntry.startTime) {
          washEntry.duration = Math.round((washEntry.endTime - washEntry.startTime) / (1000 * 60));
        }
      }
    }
    if (req.body.duration !== undefined) {
      washEntry.duration = parseInt(req.body.duration);
    }
    if (washServiceType !== undefined) washEntry.washServiceType = washServiceType;
    
    // Update washer if provided
    if (washerId) {
      let washer = null;
      if (!isNaN(washerId)) {
        washer = await User.findOne({ id: parseInt(washerId) });
      } else if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
        washer = await User.findById(washerId);
      }
      if (washer) {
        washEntry.washer = washer._id;
      }
    }

    await lead.save();

    // Return updated wash history
    const updatedLead = await Lead.findById(lead._id)
      .populate('washHistory.washer', 'name')
      .select('washHistory');

    res.json(updatedLead.washHistory);
  } catch (err) {
    console.error('Error updating wash history:', err);
    res.status(500).json({ message: err.message });
  }
});



// Helper function to create or update customer
async function createOrUpdateCustomer(lead) {
  const Customer = require('../models/Customer');
  
  try {
    let customer = await Customer.findOne({ phone: lead.phone });
    
    if (!customer) {
      // Create new customer
      customer = new Customer({
        customerName: lead.customerName,
        phone: lead.phone,
        area: lead.area,
        carModel: lead.carModel,
        customerType: lead.leadType,
        leadSource: lead.leadSource,
        totalWashes: lead.washHistory.length,
        totalAmount: lead.washHistory.reduce((sum, wash) => sum + (wash.amount || 0), 0),
        lastWashDate: lead.washHistory[lead.washHistory.length - 1]?.date
      });
      await customer.save();
    } else {
      // Update existing customer
      customer.totalWashes = lead.washHistory.length;
      customer.totalAmount = lead.washHistory.reduce((sum, wash) => sum + (wash.amount || 0), 0);
      customer.lastWashDate = lead.washHistory[lead.washHistory.length - 1]?.date;
      await customer.save();
    }
  } catch (error) {
    console.error('Error creating/updating customer:', error);
  }
}

// Convert one-time lead to monthly subscription
router.put('/:id/convert-to-monthly', async (req, res) => {
  try {
    const { packageType, scheduledDates, customWashes, customAmount, paymentStatus, customPlanName, totalInteriorWashes } = req.body;
    
    const lead = await Lead.findOne({ id: parseInt(req.params.id) });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    if (!packageType || !scheduledDates || scheduledDates.length === 0) {
      return res.status(400).json({ message: 'Package type and scheduled dates are required' });
    }

    // Get package details - allow any custom package name
    let washes, price, interiorWashes;
    if (packageType === 'Basic') {
      washes = 3; price = 300; interiorWashes = 1;
    } else if (packageType === 'Premium') {
      washes = 4; price = 400; interiorWashes = 2;
    } else if (packageType === 'Deluxe') {
      washes = 5; price = 500; interiorWashes = 3;
    } else {
      // For any custom package type (including custom plan names)
      washes = parseInt(customWashes) || 3;
      price = parseFloat(customAmount) || 300;
      interiorWashes = parseInt(totalInteriorWashes) || 0;
    }

    // Create scheduled washes with equal amount distribution
    const amountPerWash = Math.round(price / washes);
    const scheduledWashes = scheduledDates.map((date, index) => ({
      washNumber: index + 1,
      scheduledDate: new Date(date),
      status: 'scheduled',
      amount: amountPerWash,
      is_amountPaid: Boolean(paymentStatus),
      washServiceType: 'Exterior'
    }));

    // Create subscription - use actual custom plan name as packageType
    const actualPackageType = packageType === 'Custom' ? customPlanName : packageType;
    lead.monthlySubscription = {
      packageType: actualPackageType,
      customPlanName: customPlanName || packageType,
      totalWashes: washes,
      totalInteriorWashes: interiorWashes,
      usedInteriorWashes: 0,
      monthlyPrice: price,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      scheduledWashes,
      completedWashes: 0,
      isActive: true
    };

    lead.leadType = 'Monthly';
    lead.status = 'Converted';

    // Add wash history entries with equal amount distribution
    const actualWashType = actualPackageType;
    scheduledWashes.forEach((wash) => {
      lead.washHistory.push({
        washType: actualWashType,
        washer: null,
        amount: amountPerWash,
        date: wash.scheduledDate,
        feedback: '',
        is_amountPaid: Boolean(paymentStatus),
        washStatus: 'pending'
      });
    });

    await lead.save();
    
    const updatedLead = await Lead.findById(lead._id).populate('assignedWasher', 'name');
    res.json(updatedLead);
    
  } catch (error) {
    console.error('Error converting to monthly subscription:', error);
    res.status(500).json({ message: error.message });
  }
});

// Debug route for testing
router.post('/:id/test-subscription', async (req, res) => {
  try {
    console.log('Test route called with body:', req.body);
    const lead = await Lead.findOne({ id: parseInt(req.params.id) });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    res.json({ message: 'Test successful', leadId: lead.id, leadType: lead.leadType });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create monthly subscription for a lead
router.post('/:id/monthly-subscription', async (req, res) => {
  try {
    const leadId = parseInt(req.params.id);
    const { packageType, scheduledDates, customWashes, customAmount, paymentStatus, customPlanName, totalInteriorWashes, washerId } = req.body;
    
    const lead = await Lead.findOne({ id: leadId });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    if (!packageType || !scheduledDates || scheduledDates.length === 0) {
      return res.status(400).json({ message: 'Package type and scheduled dates are required' });
    }

    // Find washer if provided
    let washer = null;
    if (washerId) {
      if (!isNaN(washerId)) {
        washer = await User.findOne({ id: parseInt(washerId) });
      } else if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
        washer = await User.findById(washerId);
      }
    }

    // Get package details - allow any custom package name
    let washes, price, interiorWashes;
    if (packageType === 'Basic') {
      washes = 3; price = 300; interiorWashes = 1;
    } else if (packageType === 'Premium') {
      washes = 4; price = 400; interiorWashes = 2;
    } else if (packageType === 'Deluxe') {
      washes = 5; price = 500; interiorWashes = 3;
    } else {
      // For any custom package type (including custom plan names)
      washes = parseInt(customWashes) || 3;
      price = parseFloat(customAmount) || 300;
      interiorWashes = parseInt(totalInteriorWashes) || 0;
    }

    // Check for today/tomorrow dates for auto-assignment
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    let hasAutoAssignmentDate = false;
    
    // Create scheduled washes with equal amount distribution
    const amountPerWash = Math.round(price / washes);
    const scheduledWashes = scheduledDates.map((date, index) => {
      const washDate = new Date(date);
      const isToday = washDate.toDateString() === today.toDateString();
      const isTomorrow = washDate.toDateString() === tomorrow.toDateString();
      
      if (isToday || isTomorrow) {
        hasAutoAssignmentDate = true;
      }
      
      return {
        washNumber: index + 1,
        scheduledDate: washDate,
        status: 'scheduled',
        amount: amountPerWash,
        is_amountPaid: Boolean(paymentStatus),
        washServiceType: 'Exterior',
        washer: (isToday || isTomorrow) && washer ? washer._id : null
      };
    });

    // Create subscription - use actual custom plan name as packageType
    const actualPackageType = packageType === 'Custom' ? customPlanName : packageType;
    lead.monthlySubscription = {
      packageType: actualPackageType,
      customPlanName: customPlanName || packageType,
      totalWashes: washes,
      totalInteriorWashes: interiorWashes,
      usedInteriorWashes: 0,
      monthlyPrice: price,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      scheduledWashes,
      completedWashes: 0,
      isActive: true
    };

    lead.leadType = 'Monthly';
    lead.status = 'Converted';

    // Auto-assign washer to lead if any wash is today or tomorrow
    if (hasAutoAssignmentDate && washer) {
      lead.assignedWasher = washer._id;
    }

    // Add wash history entries with equal amount distribution
    const actualWashType = actualPackageType;
    scheduledWashes.forEach((wash) => {
      lead.washHistory.push({
        washType: actualWashType,
        washer: wash.washer,
        amount: amountPerWash,
        date: wash.scheduledDate,
        feedback: '',
        is_amountPaid: Boolean(paymentStatus),
        washStatus: 'pending'
      });
    });

    await lead.save();
    
    // Auto-generate additional scheduled washes if none provided or if we need regular intervals
    try {
      await autoGenerateScheduledWashes(lead._id);
    } catch (error) {
      console.log('Note: Could not auto-generate additional schedules:', error.message);
    }
    
    res.json({ 
      message: 'Monthly subscription created successfully',
      autoAssigned: hasAutoAssignmentDate && washer ? true : false,
      assignedWasher: washer ? washer.name : null
    });

  } catch (error) {
    console.error('Monthly subscription error:', error);
    res.status(500).json({ message: 'Failed to create monthly subscription', error: error.message });
  }
});

// Get monthly subscription details
router.get('/:id/monthly-subscription', async (req, res) => {
  try {
    const lead = await Lead.findOne({ id: parseInt(req.params.id) })
      .populate('monthlySubscription.scheduledWashes.washer', 'name')
      .select('monthlySubscription customerName phone');

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    if (!lead.monthlySubscription) {
      return res.status(404).json({ message: 'No monthly subscription found' });
    }

    res.json(lead.monthlySubscription);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Mark scheduled wash as completed (Washers can only update status, payment, and feedback)
router.put('/:id/monthly-subscription/wash/:washId', async (req, res) => {
  try {
    const { status, feedback, washerId, amountPaid, washServiceType } = req.body;
    console.log('Updating wash:', { leadId: req.params.id, washId: req.params.washId, body: req.body });
    
    const lead = await Lead.findOne({ id: parseInt(req.params.id) });
    if (!lead || !lead.monthlySubscription) {
      console.log('Lead or subscription not found');
      return res.status(404).json({ message: 'Lead or subscription not found' });
    }

    const scheduledWash = lead.monthlySubscription.scheduledWashes.id(req.params.washId);
    if (!scheduledWash) {
      console.log('Scheduled wash not found with ID:', req.params.washId);
      return res.status(404).json({ message: 'Scheduled wash not found' });
    }

    console.log('Found scheduled wash:', scheduledWash);

    // Find washer by ID
    let washer = null;
    if (washerId) {
      if (!isNaN(washerId)) {
        washer = await User.findOne({ id: parseInt(washerId) });
      } else if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
        washer = await User.findById(washerId);
      }
    }
    
    // Update wash status (washers can only update status, payment, and feedback)
    scheduledWash.status = status || 'completed';
    if (scheduledWash.status === 'completed') {
      scheduledWash.completedDate = new Date();
      scheduledWash.washer = washer ? washer._id : null;
      scheduledWash.feedback = feedback || '';
      scheduledWash.is_amountPaid = Boolean(amountPaid);
      scheduledWash.washServiceType = washServiceType || scheduledWash.washServiceType || 'Exterior';
      
      // Calculate duration if start and end times are available from frontend timer
      if (req.body.startTime && req.body.endTime) {
        const startTime = new Date(req.body.startTime);
        const endTime = new Date(req.body.endTime);
        scheduledWash.duration = Math.round((endTime - startTime) / (1000 * 60)); // in minutes
      } else if (req.body.duration) {
        scheduledWash.duration = parseInt(req.body.duration);
      }
      
      // Amount is set by admin during subscription creation, washers cannot modify it
      if (!scheduledWash.amount) {
        // Set default amount based on package type if not already set by admin
        const packagePricing = {
          'Basic': 100,
          'Premium': 125,
          'Deluxe': 150
        };
        scheduledWash.amount = packagePricing[lead.monthlySubscription.packageType] || 100;
      }
      
      // Find and update corresponding wash history entry
      const historyEntry = lead.washHistory.find(h => {
        const historyDate = new Date(h.date);
        const scheduledDate = new Date(scheduledWash.scheduledDate);
        return historyDate.toDateString() === scheduledDate.toDateString() &&
               h.washType === lead.monthlySubscription.packageType &&
               h.washStatus === 'pending';
      });
      
      if (historyEntry) {
        historyEntry.washer = washer ? washer._id : null;
        historyEntry.feedback = feedback || '';
        historyEntry.is_amountPaid = Boolean(amountPaid);
        historyEntry.washStatus = 'completed';
        historyEntry.washServiceType = scheduledWash.washServiceType || 'Exterior';
        historyEntry.date = new Date(); // Update to actual completion date
        historyEntry.duration = scheduledWash.duration; // Copy duration from scheduled wash
      } else {
        // If no matching history entry found, create one
        lead.washHistory.push({
          washType: lead.monthlySubscription.packageType,
          washer: washer ? washer._id : null,
          amount: scheduledWash.amount,
          date: new Date(),
          feedback: feedback || '',
          is_amountPaid: Boolean(amountPaid),
          washStatus: 'completed',
          washServiceType: scheduledWash.washServiceType || 'Exterior',
          duration: scheduledWash.duration
        });
      }
      
      lead.monthlySubscription.completedWashes += 1;

      console.log('Updated wash to completed, total completed:', lead.monthlySubscription.completedWashes);

      // Check if all washes completed and paid
      const allWashesCompleted = lead.monthlySubscription.completedWashes >= lead.monthlySubscription.totalWashes;
      const allWashesPaid = lead.monthlySubscription.scheduledWashes.every(w => 
        w.status !== 'completed' || w.is_amountPaid
      );
      
      if (allWashesCompleted) {
        lead.monthlySubscription.isActive = false;
        console.log('All washes completed, marking subscription inactive');
        
        // Only add to revenue if all washes are completed AND paid
        if (allWashesPaid) {
          console.log('All washes completed and paid - eligible for revenue');
        }
      }
    }

    await lead.save();
    console.log('Lead saved successfully');

    const updatedLead = await Lead.findById(lead._id).select('monthlySubscription');
    res.json(updatedLead.monthlySubscription);
  } catch (error) {
    console.error('Error updating wash:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
