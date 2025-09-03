const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

// Auto-assign leads based on wash entry dates
router.post('/auto-assign', auth, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { leadId, washDate, washerId } = req.body;

    if (!leadId || !washDate) {
      return res.status(400).json({ message: 'Lead ID and wash date are required' });
    }

    // Find the lead
    const lead = await Lead.findOne({ id: parseInt(leadId) });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
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

    // Parse the wash date
    const targetDate = new Date(washDate);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Check if the wash date is today or tomorrow
    const isToday = targetDate.toDateString() === today.toDateString();
    const isTomorrow = targetDate.toDateString() === tomorrow.toDateString();

    if (!isToday && !isTomorrow) {
      return res.status(400).json({ 
        message: 'Auto-assignment only works for today and tomorrow dates' 
      });
    }

    // Assign washer to lead if not already assigned or if different washer
    if (washer && (!lead.assignedWasher || lead.assignedWasher.toString() !== washer._id.toString())) {
      lead.assignedWasher = washer._id;
      await lead.save();
    }

    // Update wash history entries for the specific date
    const washHistoryUpdated = lead.washHistory.filter(wash => {
      const washDate = new Date(wash.date);
      return washDate.toDateString() === targetDate.toDateString();
    });

    // Update monthly subscription scheduled washes for the specific date
    if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
      const scheduledWashesUpdated = lead.monthlySubscription.scheduledWashes.filter(wash => {
        const scheduledDate = new Date(wash.scheduledDate);
        return scheduledDate.toDateString() === targetDate.toDateString();
      });

      // Assign washer to scheduled washes
      scheduledWashesUpdated.forEach(wash => {
        if (washer && wash.status === 'scheduled') {
          wash.washer = washer._id;
        }
      });
    }

    // Update one-time wash if it matches the date
    if (lead.oneTimeWash && lead.oneTimeWash.scheduledDate) {
      const oneTimeDate = new Date(lead.oneTimeWash.scheduledDate);
      if (oneTimeDate.toDateString() === targetDate.toDateString() && washer) {
        lead.oneTimeWash.washer = washer._id;
      }
    }

    await lead.save();

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedWasher', 'name')
      .populate('washHistory.washer', 'name')
      .populate('monthlySubscription.scheduledWashes.washer', 'name')
      .populate('oneTimeWash.washer', 'name');

    res.json({
      message: 'Lead assignment updated successfully',
      lead: updatedLead,
      assignmentInfo: {
        date: targetDate.toDateString(),
        isToday,
        isTomorrow,
        washerAssigned: washer ? washer.name : 'No washer assigned',
        washHistoryCount: washHistoryUpdated.length,
        scheduledWashesCount: lead.monthlySubscription ? 
          lead.monthlySubscription.scheduledWashes.filter(w => 
            new Date(w.scheduledDate).toDateString() === targetDate.toDateString()
          ).length : 0
      }
    });

  } catch (error) {
    console.error('Auto-assignment error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get leads that need assignment for specific date
router.get('/pending-assignments/:date', auth, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const targetDate = new Date(req.params.date);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    // Find leads with wash entries for the target date but no assigned washer
    const leadsNeedingAssignment = await Lead.find({
      $or: [
        // Leads with wash history for target date but no assigned washer
        {
          'washHistory.date': {
            $gte: new Date(targetDateStr),
            $lt: new Date(new Date(targetDateStr).getTime() + 24 * 60 * 60 * 1000)
          },
          assignedWasher: { $exists: false }
        },
        // Leads with scheduled washes for target date but no assigned washer
        {
          'monthlySubscription.scheduledWashes.scheduledDate': {
            $gte: new Date(targetDateStr),
            $lt: new Date(new Date(targetDateStr).getTime() + 24 * 60 * 60 * 1000)
          },
          assignedWasher: { $exists: false }
        },
        // One-time washes for target date but no assigned washer
        {
          'oneTimeWash.scheduledDate': {
            $gte: new Date(targetDateStr),
            $lt: new Date(new Date(targetDateStr).getTime() + 24 * 60 * 60 * 1000)
          },
          assignedWasher: { $exists: false }
        }
      ]
    }).populate('assignedWasher', 'name');

    res.json({
      date: targetDateStr,
      count: leadsNeedingAssignment.length,
      leads: leadsNeedingAssignment
    });

  } catch (error) {
    console.error('Error fetching pending assignments:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;