const mongoose = require('mongoose');
const Lead = require('../models/Lead');

/**
 * Generate scheduled wash dates for a monthly subscription
 * @param {Object} subscription - Monthly subscription object
 * @param {Date} startDate - Start date for generating schedules
 * @param {Date} endDate - End date for generating schedules
 * @returns {Array} Array of scheduled wash objects
 */
const generateScheduledWashes = (subscription, startDate = null, endDate = null) => {
  const scheduledWashes = [];
  
  if (!subscription.startDate || !subscription.totalWashes) {
    return scheduledWashes;
  }
  
  const subscriptionStart = startDate || new Date(subscription.startDate);
  const subscriptionEnd = endDate || new Date(subscription.endDate);
  
  // Calculate interval between washes
  const totalDaysInSubscription = Math.ceil((subscriptionEnd - subscriptionStart) / (1000 * 60 * 60 * 24));
  const totalWashesInPeriod = Math.ceil(totalDaysInSubscription / 30) * subscription.totalWashes;
  const daysBetweenWashes = Math.floor(totalDaysInSubscription / totalWashesInPeriod);
  
  let currentDate = new Date(subscriptionStart);
  let washNumber = 1;
  
  while (currentDate <= subscriptionEnd && washNumber <= totalWashesInPeriod) {
    scheduledWashes.push({
      washNumber: washNumber,
      scheduledDate: new Date(currentDate),
      scheduledTime: '10:00',
      status: 'scheduled',
      washServiceType: 'Exterior'
    });
    
    // Move to next wash date
    currentDate.setDate(currentDate.getDate() + daysBetweenWashes);
    washNumber++;
  }
  
  return scheduledWashes;
};

/**
 * Auto-generate scheduled washes for a lead's monthly subscription
 * @param {String} leadId - Lead ID
 * @returns {Promise} Updated lead object
 */
const autoGenerateScheduledWashes = async (leadId) => {
  try {
    const lead = await Lead.findById(leadId);
    
    if (!lead || !lead.monthlySubscription || !lead.monthlySubscription.isActive) {
      return lead;
    }
    
    // Only generate if no scheduled washes exist
    if (lead.monthlySubscription.scheduledWashes && lead.monthlySubscription.scheduledWashes.length > 0) {
      return lead;
    }
    
    const scheduledWashes = generateScheduledWashes(lead.monthlySubscription);
    
    if (scheduledWashes.length > 0) {
      lead.monthlySubscription.scheduledWashes = scheduledWashes;
      await lead.save();
    }
    
    return lead;
  } catch (error) {
    console.error('Error auto-generating scheduled washes:', error);
    return null;
  }
};

/**
 * Update scheduled washes for all active monthly subscriptions
 * @returns {Promise} Number of updated leads
 */
const updateAllSubscriptionSchedules = async () => {
  try {
    const leads = await Lead.find({
      'monthlySubscription.isActive': true,
      'monthlySubscription.scheduledWashes': { $size: 0 }
    });
    
    let updatedCount = 0;
    
    for (const lead of leads) {
      if (lead.monthlySubscription && lead.monthlySubscription.isActive) {
        const scheduledWashes = generateScheduledWashes(lead.monthlySubscription);
        if (scheduledWashes.length > 0) {
          lead.monthlySubscription.scheduledWashes = scheduledWashes;
          await lead.save();
          updatedCount++;
        }
      }
    }
    
    return updatedCount;
  } catch (error) {
    console.error('Error updating all subscription schedules:', error);
    throw error;
  }
};

module.exports = {
  generateScheduledWashes,
  autoGenerateScheduledWashes,
  updateAllSubscriptionSchedules
};