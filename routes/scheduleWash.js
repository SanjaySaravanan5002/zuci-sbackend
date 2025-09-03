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
        
        if (washDate >= start && washDate <= end && (lead.oneTimeWash.washer || lead.assignedWasher)) {
          scheduledWashes.push({
            _id: `onetime_${lead._id}`,
            customerName: lead.customerName,
            phone: lead.phone,
            area: lead.area,
            carModel: lead.carModel,
            washType: lead.oneTimeWash.washType || 'Basic',
            scheduledDate: washDate.toISOString(),
            washer: lead.oneTimeWash.washer || lead.assignedWasher,
            leadId: lead._id,
            status: lead.oneTimeWash.status === 'completed' ? 'completed' : 'pending'
          });
        }
      }
      
      // Monthly subscription scheduled washes
      if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
        lead.monthlySubscription.scheduledWashes.forEach((scheduledWash, index) => {
          const washDate = new Date(scheduledWash.scheduledDate);
          if (washDate >= start && washDate <= end && (scheduledWash.washer || lead.assignedWasher)) {
            scheduledWashes.push({
              _id: `monthly_${lead._id}_${index}`,
              customerName: lead.customerName,
              phone: lead.phone,
              area: lead.area,
              carModel: lead.carModel,
              washType: lead.monthlySubscription.packageType || lead.monthlySubscription.customPlanName || 'Basic',
              scheduledDate: washDate.toISOString(),
              washer: scheduledWash.washer || lead.assignedWasher,
              leadId: lead._id,
              status: scheduledWash.status === 'completed' ? 'completed' : 'pending'
            });
          }
        });
      }
      
      // Wash history entries (pending/assigned washes)
      if (lead.washHistory && lead.washHistory.length > 0) {
        lead.washHistory.forEach((wash, index) => {
          const washDate = new Date(wash.date);
          if (!isNaN(washDate.getTime()) && washDate >= start && washDate <= end && (wash.washer || lead.assignedWasher)) {
            scheduledWashes.push({
              _id: `history_${lead._id}_${index}`,
              customerName: lead.customerName,
              phone: lead.phone,
              area: lead.area,
              carModel: lead.carModel,
              washType: wash.washType || 'Basic',
              scheduledDate: washDate.toISOString(),
              washer: wash.washer || lead.assignedWasher,
              leadId: lead._id,
              status: wash.washStatus === 'completed' ? 'completed' : 'pending'
            });
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

    // Remove duplicates and prioritize completed over pending for same customer/date
    const uniqueWashes = [];
    const seenWashes = new Map();
    
    scheduledWashes.forEach(wash => {
      const key = `${wash.customerName}_${wash.scheduledDate.split('T')[0]}`;
      const existing = seenWashes.get(key);
      
      if (!existing) {
        seenWashes.set(key, wash);
        uniqueWashes.push(wash);
      } else if (wash.status === 'completed' && existing.status === 'pending') {
        // Replace pending with completed for same customer/date
        const index = uniqueWashes.findIndex(w => w === existing);
        uniqueWashes[index] = wash;
        seenWashes.set(key, wash);
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
    
    console.log('Returning scheduled washes:', uniqueWashes.length);
    uniqueWashes.forEach(wash => {
      console.log(`${wash.customerName} - ${wash.scheduledDate} - Washer: ${wash.washer?.name || 'None'}`);
    });
    res.json(uniqueWashes);
  } catch (error) {
    console.error('Error fetching scheduled washes:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;