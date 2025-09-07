const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const { auth, authorize } = require('../middleware/auth');

// Get scheduled washes for calendar view
router.get('/scheduled-washes', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Find all leads (both assigned and unassigned)
    const leads = await Lead.find({})
      .populate('assignedWasher', 'name')
      .populate('washHistory.washer', 'name')
      .populate('monthlySubscription.scheduledWashes.washer', 'name')
      .populate('oneTimeWash.washer', 'name');

    const scheduledWashes = [];

    leads.forEach(lead => {
      // One-time wash - use scheduled date or today if just created/assigned
      if (lead.oneTimeWash) {
        let washDate;
        if (lead.oneTimeWash.scheduledDate) {
          washDate = new Date(lead.oneTimeWash.scheduledDate);
        } else {
          // If no scheduled date, use creation date
          washDate = new Date(lead.createdAt);
        }
        
        if (washDate >= start && washDate <= end) {
          const washerInfo = lead.oneTimeWash.washer || lead.assignedWasher;
          if (washerInfo) {
            scheduledWashes.push({
              _id: `onetime_${lead._id}`,
              customerName: lead.customerName,
              phone: lead.phone,
              area: lead.area,
              carModel: lead.carModel,
              washType: lead.oneTimeWash.washType || 'One-time',
              scheduledDate: washDate.toISOString(),
              washer: washerInfo,
              leadId: lead._id,
              leadType: 'One-time',
              status: lead.oneTimeWash.status === 'completed' ? 'completed' : 'pending',
              source: 'oneTimeWash'
            });
          }
        }
      }
      
      // Monthly subscription scheduled washes - FIXED: Always show if has washer
      if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
        lead.monthlySubscription.scheduledWashes.forEach((scheduledWash, index) => {
          const washDate = new Date(scheduledWash.scheduledDate);
          if (washDate >= start && washDate <= end) {
            // Show if has washer assigned OR if lead has assignedWasher
            const washerInfo = scheduledWash.washer || lead.assignedWasher;
            if (washerInfo) {
              scheduledWashes.push({
                _id: `monthly_${lead._id}_${index}`,
                customerName: lead.customerName,
                phone: lead.phone,
                area: lead.area,
                carModel: lead.carModel,
                washType: lead.monthlySubscription.packageType || lead.monthlySubscription.customPlanName || 'Monthly',
                scheduledDate: washDate.toISOString(),
                washer: washerInfo,
                leadId: lead._id,
                leadType: 'Monthly',
                status: scheduledWash.status === 'completed' ? 'completed' : 'pending',
                source: 'monthlySubscription'
              });
            }
          }
        });
      }
      
      // Wash history entries - only if not covered by above
      if (lead.washHistory && lead.washHistory.length > 0) {
        lead.washHistory.forEach((wash, index) => {
          const washDate = new Date(wash.date);
          if (!isNaN(washDate.getTime()) && washDate >= start && washDate <= end) {
            const washerInfo = wash.washer || lead.assignedWasher;
            if (washerInfo) {
              // Check if this wash is already covered by monthly subscription or one-time
              const alreadyCovered = scheduledWashes.some(sw => 
                sw.customerName === lead.customerName && 
                new Date(sw.scheduledDate).toDateString() === washDate.toDateString()
              );
              
              if (!alreadyCovered) {
                scheduledWashes.push({
                  _id: `history_${lead._id}_${index}`,
                  customerName: lead.customerName,
                  phone: lead.phone,
                  area: lead.area,
                  carModel: lead.carModel,
                  washType: wash.washType || 'Basic',
                  scheduledDate: washDate.toISOString(),
                  washer: washerInfo,
                  leadId: lead._id,
                  leadType: lead.leadType,
                  status: wash.washStatus === 'completed' ? 'completed' : 'pending',
                  source: 'washHistory'
                });
              }
            }
          }
        });
      }
      
      // Show leads that have no specific wash dates but are assigned to washers
      // Only show if no wash history, one-time wash, or monthly subscription exists
      if (!lead.washHistory?.length && 
          !lead.oneTimeWash && 
          !lead.monthlySubscription?.scheduledWashes?.length &&
          lead.assignedWasher) {
        
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        
        const createdDate = new Date(lead.createdAt);
        const createdDateOnly = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
        
        if (createdDateOnly >= start && createdDateOnly <= end) {
          scheduledWashes.push({
            _id: `lead_${lead._id}`,
            customerName: lead.customerName,
            phone: lead.phone,
            area: lead.area,
            carModel: lead.carModel,
            washType: lead.leadType || 'Basic',
            scheduledDate: createdDateOnly.toISOString(),
            washer: lead.assignedWasher,
            leadId: lead._id,
            status: 'pending'
          });
        }
      }
    });

    // Remove duplicates with source priority
    const uniqueWashes = [];
    const seenWashes = new Map();
    
    scheduledWashes.forEach(wash => {
      const key = `${wash.customerName}_${wash.scheduledDate.split('T')[0]}`;
      const existing = seenWashes.get(key);
      
      if (!existing) {
        seenWashes.set(key, wash);
        uniqueWashes.push(wash);
      } else {
        // Priority: monthlySubscription > oneTimeWash > washHistory
        const priorities = { monthlySubscription: 3, oneTimeWash: 2, washHistory: 1 };
        if (priorities[wash.source] > priorities[existing.source]) {
          const index = uniqueWashes.findIndex(w => w === existing);
          uniqueWashes[index] = wash;
          seenWashes.set(key, wash);
        }
      }
    });
    
    uniqueWashes.sort((a, b) => {
      const dateA = new Date(a.scheduledDate);
      const dateB = new Date(b.scheduledDate);
      if (dateA.getTime() === dateB.getTime()) {
        // If same date, prioritize assigned over pending
        if (a.status === 'assigned' && b.status === 'pending') return -1;
        if (a.status === 'pending' && b.status === 'assigned') return 1;
      }
      return dateA.getTime() - dateB.getTime();
    });
    
    console.log(`Returning ${uniqueWashes.length} scheduled washes`);
    console.log('Monthly customers in calendar:', uniqueWashes.filter(w => w.leadType === 'Monthly').map(w => w.customerName));
    
    res.json(uniqueWashes);
  } catch (error) {
    console.error('Error fetching scheduled washes:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update wash details (reschedule date, change washer, etc.)
router.put('/update-wash/:washId', auth, async (req, res) => {
  console.log('Update wash route hit:', req.params.washId, req.body);
  try {
    const { washId } = req.params;
    const { scheduledDate, washType, washer } = req.body;
    
    // Parse washId to determine source and lead
    const [source, leadId, index] = washId.split('_');
    
    const lead = await Lead.findById(leadId).populate('assignedWasher', 'name');
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }
    
    // Find washer by name if provided
    let washerObj = null;
    if (washer) {
      const User = require('../models/User');
      washerObj = await User.findOne({ name: washer, role: 'washer' });
    }
    
    // Update based on source
    if (source === 'onetime' && lead.oneTimeWash) {
      if (scheduledDate) lead.oneTimeWash.scheduledDate = new Date(scheduledDate);
      if (washType) lead.oneTimeWash.washType = washType;
      if (washerObj) lead.oneTimeWash.washer = washerObj._id;
    } else if (source === 'monthly' && lead.monthlySubscription?.scheduledWashes) {
      const washIndex = parseInt(index);
      if (lead.monthlySubscription.scheduledWashes[washIndex]) {
        if (scheduledDate) lead.monthlySubscription.scheduledWashes[washIndex].scheduledDate = new Date(scheduledDate);
        if (washerObj) lead.monthlySubscription.scheduledWashes[washIndex].washer = washerObj._id;
      }
      if (washType) lead.monthlySubscription.packageType = washType;
    } else if (source === 'history' && lead.washHistory) {
      const washIndex = parseInt(index);
      if (lead.washHistory[washIndex]) {
        if (scheduledDate) lead.washHistory[washIndex].date = new Date(scheduledDate);
        if (washType) lead.washHistory[washIndex].washType = washType;
        if (washerObj) lead.washHistory[washIndex].washer = washerObj._id;
      }
    }
    
    // Update assigned washer if provided
    if (washerObj) {
      lead.assignedWasher = washerObj._id;
    }
    
    await lead.save();
    
    res.json({ message: 'Wash updated successfully', lead });
  } catch (error) {
    console.error('Error updating wash:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
