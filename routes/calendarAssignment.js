const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// Assign customer to washer on specific date
router.post('/assign-washer-date', auth, async (req, res) => {
  try {
    const { leadId, washerId, targetDate, washType } = req.body;
    
    const lead = await Lead.findById(leadId);
    const washer = await User.findById(washerId);
    
    if (!lead || !washer) {
      return res.status(404).json({ message: 'Lead or washer not found' });
    }

    const washDate = new Date(targetDate);
    
    // Add wash history with washer assignment
    lead.washHistory.push({
      washType: washType || 'Basic',
      washer: washer._id,
      amount: 100,
      date: washDate,
      washStatus: 'pending',
      washServiceType: 'Exterior'
    });

    // Assign washer to lead
    lead.assignedWasher = washer._id;
    lead.status = 'Converted';
    
    await lead.save();

    res.json({
      success: true,
      message: `${lead.customerName} assigned to ${washer.name} on ${washDate.toDateString()}`,
      assignment: {
        customer: lead.customerName,
        washer: washer.name,
        date: washDate.toDateString(),
        status: 'pending'
      }
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get calendar assignments for date range
router.get('/calendar-assignments', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const leads = await Lead.find({
      $or: [
        { 'washHistory.date': { $gte: new Date(startDate), $lte: new Date(endDate) } },
        { 'oneTimeWash.scheduledDate': { $gte: new Date(startDate), $lte: new Date(endDate) } }
      ]
    })
    .populate('assignedWasher', 'name')
    .populate('washHistory.washer', 'name')
    .populate('oneTimeWash.washer', 'name');

    const assignments = [];

    leads.forEach(lead => {
      // Process wash history
      lead.washHistory.forEach(wash => {
        const washDate = new Date(wash.date);
        if (washDate >= new Date(startDate) && washDate <= new Date(endDate)) {
          assignments.push({
            _id: `history_${lead._id}_${wash._id}`,
            customerName: lead.customerName,
            phone: lead.phone,
            area: lead.area,
            washerName: wash.washer?.name || 'Unassigned',
            date: washDate.toISOString(),
            status: wash.washStatus,
            washType: wash.washType,
            message: `${lead.customerName} → ${wash.washer?.name || 'Unassigned'} (${wash.washStatus})`
          });
        }
      });

      // Process one-time washes
      if (lead.oneTimeWash?.scheduledDate) {
        const washDate = new Date(lead.oneTimeWash.scheduledDate);
        if (washDate >= new Date(startDate) && washDate <= new Date(endDate)) {
          assignments.push({
            _id: `onetime_${lead._id}`,
            customerName: lead.customerName,
            phone: lead.phone,
            area: lead.area,
            washerName: lead.oneTimeWash.washer?.name || lead.assignedWasher?.name || 'Unassigned',
            date: washDate.toISOString(),
            status: lead.oneTimeWash.status,
            washType: lead.oneTimeWash.washType,
            message: `${lead.customerName} → ${lead.oneTimeWash.washer?.name || lead.assignedWasher?.name || 'Unassigned'} (${lead.oneTimeWash.status})`
          });
        }
      }
    });

    res.json({ success: true, assignments });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;