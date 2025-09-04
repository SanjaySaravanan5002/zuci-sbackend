// Fixed version of the upcoming-washes endpoint
// Replace the existing endpoint in routes/leads.js

// Get upcoming washes - FIXED VERSION
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
    
    // Find all leads with proper population
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
      
      // Check monthly subscription scheduled washes FIRST
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
      
      // Only include leads with upcoming washes
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