// Fixed version of the scheduled-washes endpoint
// Replace the existing endpoint in routes/scheduleWash.js

// Get scheduled washes for calendar view - FIXED VERSION
router.get('/scheduled-washes', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Find all leads with proper population
    const leads = await Lead.find({})
      .populate('assignedWasher', 'name')
      .populate('washHistory.washer', 'name')
      .populate('monthlySubscription.scheduledWashes.washer', 'name')
      .populate('oneTimeWash.washer', 'name');

    const scheduledWashes = [];

    leads.forEach(lead => {
      // Monthly subscription scheduled washes - PRIORITY 1
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
      
      // One-time wash - PRIORITY 2
      if (lead.oneTimeWash) {
        let washDate;
        if (lead.oneTimeWash.scheduledDate) {
          washDate = new Date(lead.oneTimeWash.scheduledDate);
        } else {
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
      
      // Wash history entries - PRIORITY 3 (only if not covered by above)
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
    });

    // Remove duplicates and sort
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
    
    uniqueWashes.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
    
    console.log(`Returning ${uniqueWashes.length} scheduled washes`);
    console.log('Monthly customers in calendar:', uniqueWashes.filter(w => w.leadType === 'Monthly').map(w => w.customerName));
    
    res.json(uniqueWashes);
  } catch (error) {
    console.error('Error fetching scheduled washes:', error);
    res.status(500).json({ message: error.message });
  }
});