const Lead = require('../models/Lead');

class ScheduleService {
  /**
   * Get scheduled washes with optimized queries
   */
  async getScheduledWashes(startDate, endDate, options = {}) {
    try {
      const { washerId, status } = options;
      
      // Build optimized query
      const query = this._buildOptimizedQuery(startDate, endDate, { washerId, status });
      
      const leads = await Lead.find(query)
        .populate('assignedWasher', 'name')
        .populate('washHistory.washer', 'name')
        .populate('monthlySubscription.scheduledWashes.washer', 'name')
        .populate('oneTimeWash.washer', 'name')
        .lean();

      const scheduledWashes = this._processLeadsToWashes(leads, startDate, endDate);
      
      // Remove duplicates and sort
      const uniqueWashes = this._removeDuplicatesAndSort(scheduledWashes);
      
      return {
        success: true,
        data: uniqueWashes,
        total: uniqueWashes.length,
        dateRange: { start: startDate.toISOString(), end: endDate.toISOString() }
      };
      
    } catch (error) {
      console.error('Error in getScheduledWashes:', error);
      throw new Error(`Failed to fetch scheduled washes: ${error.message}`);
    }
  }

  /**
   * Build optimized MongoDB query
   */
  _buildOptimizedQuery(startDate, endDate, options = {}) {
    const { washerId } = options;
    
    const baseQuery = {
      $or: [
        { 'oneTimeWash.scheduledDate': { $gte: startDate, $lte: endDate } },
        { 'monthlySubscription.scheduledWashes.scheduledDate': { $gte: startDate, $lte: endDate } },
        { 'washHistory.date': { $gte: startDate, $lte: endDate } },
        {
          assignedWasher: { $exists: true },
          'washHistory.0': { $exists: false },
          oneTimeWash: { $exists: false },
          'monthlySubscription.scheduledWashes.0': { $exists: false },
          createdAt: { $gte: startDate, $lte: endDate }
        }
      ]
    };

    if (washerId) {
      baseQuery.$and = [{
        $or: [
          { assignedWasher: washerId },
          { 'oneTimeWash.washer': washerId },
          { 'washHistory.washer': washerId },
          { 'monthlySubscription.scheduledWashes.washer': washerId }
        ]
      }];
    }

    return baseQuery;
  }

  /**
   * Process leads into wash objects
   */
  _processLeadsToWashes(leads, startDate, endDate) {
    const scheduledWashes = [];

    leads.forEach(lead => {
      // One-time wash
      if (lead.oneTimeWash) {
        const washDate = lead.oneTimeWash.scheduledDate ? 
          new Date(lead.oneTimeWash.scheduledDate) : 
          new Date(new Date().setHours(0, 0, 0, 0));
        
        if (washDate >= startDate && washDate <= endDate) {
          scheduledWashes.push(this._createWashObject(lead, {
            washType: lead.oneTimeWash.washType,
            scheduledDate: washDate,
            washer: lead.oneTimeWash.washer,
            status: lead.oneTimeWash.status
          }, 'onetime'));
        }
      }
      
      // Monthly subscription washes
      if (lead.monthlySubscription?.scheduledWashes) {
        lead.monthlySubscription.scheduledWashes.forEach((scheduledWash, index) => {
          const washDate = new Date(scheduledWash.scheduledDate);
          if (washDate >= startDate && washDate <= endDate) {
            scheduledWashes.push(this._createWashObject(lead, {
              washType: lead.monthlySubscription.packageType,
              scheduledDate: washDate,
              washer: scheduledWash.washer,
              status: scheduledWash.status
            }, 'monthly', index));
          }
        });
      }
      
      // Wash history
      if (lead.washHistory?.length > 0) {
        lead.washHistory.forEach((wash, index) => {
          const washDate = new Date(wash.date);
          if (!isNaN(washDate.getTime()) && washDate >= startDate && washDate <= endDate) {
            scheduledWashes.push(this._createWashObject(lead, {
              washType: wash.washType,
              scheduledDate: washDate,
              washer: wash.washer,
              status: wash.washStatus
            }, 'history', index));
          }
        });
      }
      
      // Unscheduled assigned leads
      if (!lead.washHistory?.length && 
          !lead.oneTimeWash && 
          !lead.monthlySubscription?.scheduledWashes?.length &&
          lead.assignedWasher) {
        
        const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
        
        if (todayStart >= startDate && todayStart <= endDate) {
          scheduledWashes.push(this._createWashObject(lead, {
            washType: lead.leadType,
            scheduledDate: todayStart,
            washer: null,
            status: 'assigned'
          }, 'lead'));
        }
      }
    });

    return scheduledWashes;
  }

  /**
   * Create standardized wash object
   */
  _createWashObject(lead, washData, type, index = 0) {
    const { washType, scheduledDate, washer, status } = washData;
    
    return {
      _id: `${type}_${lead._id}${index ? `_${index}` : ''}`,
      customerName: lead.customerName,
      phone: lead.phone,
      area: lead.area,
      carModel: lead.carModel,
      washType: washType || lead.leadType || 'Basic',
      scheduledDate: scheduledDate.toISOString(),
      washer: washer || lead.assignedWasher,
      leadId: lead._id,
      status: this._determineStatus(status, washer || lead.assignedWasher)
    };
  }

  /**
   * Determine wash status
   */
  _determineStatus(washStatus, washer) {
    if (washStatus === 'completed') return 'completed';
    if (washer) return 'assigned';
    return 'pending';
  }

  /**
   * Remove duplicates and sort washes
   */
  _removeDuplicatesAndSort(scheduledWashes) {
    const uniqueWashes = scheduledWashes.filter((wash, index, self) => 
      index === self.findIndex(w => w._id === wash._id)
    );
    
    uniqueWashes.sort((a, b) => {
      const dateA = new Date(a.scheduledDate);
      const dateB = new Date(b.scheduledDate);
      if (dateA.getTime() === dateB.getTime()) {
        const statusPriority = { assigned: 0, pending: 1, completed: 2 };
        return statusPriority[a.status] - statusPriority[b.status];
      }
      return dateA.getTime() - dateB.getTime();
    });
    
    return uniqueWashes;
  }

  /**
   * Validate date range
   */
  validateDateRange(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Invalid date format provided');
    }
    
    if (start > end) {
      throw new Error('Start date cannot be after end date');
    }
    
    return { start, end };
  }
}

module.exports = new ScheduleService();