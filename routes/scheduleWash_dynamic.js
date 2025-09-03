const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const { auth } = require('../middleware/auth');

// Dynamic customer addition to schedule
router.post('/add-customer-to-date', auth, async (req, res) => {
  try {
    const { leadId, targetDate, washType, washerId } = req.body;
    
    if (!leadId || !targetDate) {
      return res.status(400).json({ 
        success: false, 
        message: 'Lead ID and target date are required' 
      });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lead not found' 
      });
    }

    const washDate = new Date(targetDate);
    
    // Add wash history entry for the specific date
    const washEntry = {
      washType: washType || lead.leadType || 'Basic',
      washer: washerId || lead.assignedWasher,
      amount: getWashAmount(washType || lead.leadType),
      date: washDate,
      washStatus: 'pending',
      washServiceType: 'Exterior'
    };

    lead.washHistory.push(washEntry);
    await lead.save();

    res.json({
      success: true,
      message: 'Customer added to date successfully',
      wash: washEntry
    });

  } catch (error) {
    console.error('Error adding customer to date:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get optimized scheduled washes
router.get('/scheduled-washes', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false,
        message: 'Start date and end date are required' 
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Optimized aggregation pipeline
    const pipeline = [
      {
        $match: {
          $or: [
            { 'oneTimeWash.scheduledDate': { $gte: start, $lte: end } },
            { 'monthlySubscription.scheduledWashes.scheduledDate': { $gte: start, $lte: end } },
            { 'washHistory.date': { $gte: start, $lte: end } },
            {
              assignedWasher: { $exists: true },
              'washHistory.0': { $exists: false },
              oneTimeWash: { $exists: false },
              'monthlySubscription.scheduledWashes.0': { $exists: false },
              createdAt: { $gte: start, $lte: end }
            }
          ]
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedWasher',
          foreignField: '_id',
          as: 'assignedWasherInfo'
        }
      }
    ];

    const leads = await Lead.aggregate(pipeline);
    const scheduledWashes = processLeadsToWashes(leads, start, end);

    res.json({
      success: true,
      data: scheduledWashes,
      count: scheduledWashes.length
    });

  } catch (error) {
    console.error('Error fetching scheduled washes:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Helper functions
function getWashAmount(washType) {
  const pricing = {
    'Basic': 100,
    'Premium': 150,
    'Deluxe': 200,
    'One-time': 120,
    'Monthly': 100
  };
  return pricing[washType] || 100;
}

function processLeadsToWashes(leads, start, end) {
  const scheduledWashes = [];

  leads.forEach(lead => {
    // One-time wash
    if (lead.oneTimeWash) {
      const washDate = lead.oneTimeWash.scheduledDate ? 
        new Date(lead.oneTimeWash.scheduledDate) : 
        new Date();
      
      if (washDate >= start && washDate <= end) {
        scheduledWashes.push({
          _id: `onetime_${lead._id}`,
          customerName: lead.customerName,
          phone: lead.phone,
          area: lead.area,
          carModel: lead.carModel,
          washType: lead.oneTimeWash.washType,
          scheduledDate: washDate.toISOString(),
          washer: lead.assignedWasherInfo?.[0] || null,
          leadId: lead._id,
          status: determineStatus(lead.oneTimeWash.status, lead.assignedWasherInfo?.[0])
        });
      }
    }
    
    // Monthly subscription washes
    if (lead.monthlySubscription?.scheduledWashes) {
      lead.monthlySubscription.scheduledWashes.forEach((wash, index) => {
        const washDate = new Date(wash.scheduledDate);
        if (washDate >= start && washDate <= end) {
          scheduledWashes.push({
            _id: `monthly_${lead._id}_${index}`,
            customerName: lead.customerName,
            phone: lead.phone,
            area: lead.area,
            carModel: lead.carModel,
            washType: lead.monthlySubscription.packageType,
            scheduledDate: washDate.toISOString(),
            washer: lead.assignedWasherInfo?.[0] || null,
            leadId: lead._id,
            status: determineStatus(wash.status, lead.assignedWasherInfo?.[0])
          });
        }
      });
    }
    
    // Wash history
    if (lead.washHistory?.length > 0) {
      lead.washHistory.forEach((wash, index) => {
        const washDate = new Date(wash.date);
        if (washDate >= start && washDate <= end) {
          scheduledWashes.push({
            _id: `history_${lead._id}_${index}`,
            customerName: lead.customerName,
            phone: lead.phone,
            area: lead.area,
            carModel: lead.carModel,
            washType: wash.washType,
            scheduledDate: washDate.toISOString(),
            washer: lead.assignedWasherInfo?.[0] || null,
            leadId: lead._id,
            status: determineStatus(wash.washStatus, lead.assignedWasherInfo?.[0])
          });
        }
      });
    }
  });

  return scheduledWashes.sort((a, b) => 
    new Date(a.scheduledDate) - new Date(b.scheduledDate)
  );
}

function determineStatus(washStatus, washer) {
  if (washStatus === 'completed') return 'completed';
  if (washer) return 'assigned';
  return 'pending';
}

module.exports = router;