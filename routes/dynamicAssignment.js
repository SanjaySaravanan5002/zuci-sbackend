const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const { auth } = require('../middleware/auth');

// Assign customer to specific date
router.post('/assign-to-date', auth, async (req, res) => {
  try {
    const { leadId, targetDate, washType } = req.body;
    
    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const washDate = new Date(targetDate);
    
    // Add wash history entry
    lead.washHistory.push({
      washType: washType || 'Basic',
      amount: getWashAmount(washType),
      date: washDate,
      washStatus: 'pending',
      washServiceType: 'Exterior'
    });

    // Auto-assign if today/tomorrow
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const isToday = washDate.toDateString() === today.toDateString();
    const isTomorrow = washDate.toDateString() === tomorrow.toDateString();
    
    if (isToday || isTomorrow) {
      lead.status = 'Converted';
    }

    await lead.save();

    res.json({
      success: true,
      message: 'Customer assigned to date successfully',
      autoAssigned: isToday || isTomorrow
    });

  } catch (error) {
    console.error('Error assigning customer:', error);
    res.status(500).json({ message: error.message });
  }
});

// Quick assign multiple customers
router.post('/bulk-assign', auth, async (req, res) => {
  try {
    const { assignments } = req.body; // [{ leadId, targetDate, washType }]
    
    const results = [];
    
    for (const assignment of assignments) {
      const lead = await Lead.findById(assignment.leadId);
      if (lead) {
        lead.washHistory.push({
          washType: assignment.washType || 'Basic',
          amount: getWashAmount(assignment.washType),
          date: new Date(assignment.targetDate),
          washStatus: 'pending',
          washServiceType: 'Exterior'
        });
        await lead.save();
        results.push({ leadId: assignment.leadId, success: true });
      }
    }

    res.json({
      success: true,
      results,
      assigned: results.length
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

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

module.exports = router;