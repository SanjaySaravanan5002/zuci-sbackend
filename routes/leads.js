const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');

// Get all leads with filters
router.get('/', async (req, res) => {
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

    const leads = await Lead.find(filter)
      .populate('assignedWasher', 'name')
      .sort({ id: -1 }); // Sort by auto-incrementing ID

    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create new lead
router.post('/', async (req, res) => {
  try {
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

// Get lead by numeric ID
router.get('/:id', async (req, res) => {
  try {
    const lead = await Lead.findOne({ id: parseInt(req.params.id) })
      .populate('assignedWasher', 'name');
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get lead by MongoDB ID
router.get('/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedWasher', 'name');
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
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    res.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get leads statistics
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

// Assign washer to lead
// Assign washer to lead
router.put('/:id/assign', async (req, res) => {
  try {
    console.log("req.body", req.body);
    const washerId = req.body.washerId;
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
    console.log("lead", lead);
    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedWasher', 'name');
    console.log("updatedLead", updatedLead);

    res.json(updatedLead);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get detailed revenue statistics
// Get wash history for a lead
router.get('/:id/wash-history', async (req, res) => {
  try {
    const lead = await Lead.findOne({ id: req.params.id })
      .populate({
        path: 'washHistory.washer',
        select: 'name'
      })
      .select('washHistory');

    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    res.json(lead.washHistory);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add wash history entry
router.post('/:id/wash-history', async (req, res) => {
  try {
    const lead = await Lead.findOne({ id: req.params.id });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    console.log("body", req.body);

    const { washType, washerId, amount, date, feedback, amountPaid, washStatus } = req.body;
    console.log("feedback", feedback);
    console.log("amount", amount);
    console.log("date", date);
    console.log("washerId", washerId);
    console.log("washType", washType);  
    console.log("amountPaid", amountPaid);
    console.log("washStatus", washStatus);

    // Add wash history
    lead.washHistory.push({
      washType,
      washer: washerId,
      amount,
      feedback,
      amountPaid,
      date: date || new Date(),
      washStatus
    });

    // Update lead status to converted
    lead.status = 'Converted';
    
    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('washHistory.washer', 'name')
      .select('washHistory status');

    res.json(updatedLead.washHistory);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update wash history entry
router.put('/:id/wash-history/:entryId', async (req, res) => {
  try {
    const { id, entryId } = req.params;
    const { washType, washerId, amount, date, feedback, amountPaid, washStatus } = req.body;
    console.log("feedback", feedback);
    console.log("amount", amount);
    console.log("date", date);
    console.log("washerId", washerId);
    console.log("washType", washType);  
    console.log("amountPaid", amountPaid);
    console.log("washStatus", washStatus);

    // Find the lead and update the specific wash history entry
    const lead = await Lead.findOne({ id: parseInt(id) });
    console.log("lead", lead);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Find the wash history entry using the subdocument id method
    const washEntry = lead.washHistory.id(entryId);
    console.log("washEntry", washEntry);
    if (!washEntry) {
      return res.status(404).json({ message: 'Wash history entry not found' });
    }

    // Update the wash entry fields
    if (washType) washEntry.washType = washType;
    if (amount) washEntry.amount = amount;
    if (date) washEntry.date = date;
    if (washerId) washEntry.washer = washerId;
    if (feedback !== undefined) washEntry.feedback = feedback;
    if (amountPaid !== undefined) washEntry.is_amountPaid = amountPaid;
    if (washStatus) washEntry.washStatus = washStatus;
    console.log("washEntry", washEntry);

    // Save the lead document which will save the subdocument changes
    await lead.save();

    // Get the updated lead with populated washer information
    const updatedLead = await Lead.findById(lead._id)
      .populate('washHistory.washer', 'name')
      .select('washHistory');

    res.json(updatedLead.washHistory);
  } catch (err) {
    console.error('Error updating wash history:', err);
    res.status(500).json({ message: err.message });
  }
});



//revenu and income api

module.exports = router;
