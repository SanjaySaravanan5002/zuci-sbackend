const mongoose = require('mongoose');
const Counter = require('./Counter');

const scheduledWashSchema = new mongoose.Schema({
  washNumber: {
    type: Number,
    required: true
  },
  scheduledDate: {
    type: Date,
    required: true,
    index: true // Add index for better query performance
  },
  scheduledTime: {
    type: String,
    default: '10:00',
    validate: {
      validator: function(v) {
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
      },
      message: 'Invalid time format. Use HH:MM format.'
    }
  },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'missed', 'cancelled'],
    default: 'scheduled'
  },
  completedDate: Date,
  washer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  feedback: {
    type: String,
    maxlength: 500
  },
  amount: {
    type: Number,
    min: 0
  },
  is_amountPaid: {
    type: Boolean,
    default: false
  },
  washServiceType: {
    type: String,
    enum: ['Interior', 'Exterior', 'Both'],
    default: 'Exterior'
  },
  duration: {
    type: Number,
    min: 0,
    max: 480 // Max 8 hours
  }
}, { timestamps: true });

const monthlySubscriptionSchema = new mongoose.Schema({
  packageType: {
    type: String,
    required: true
  },
  customPlanName: {
    type: String,
    default: '',
    maxlength: 100
  },
  totalWashes: {
    type: Number,
    required: true,
    min: 1
  },
  totalInteriorWashes: {
    type: Number,
    default: 0,
    min: 0
  },
  usedInteriorWashes: {
    type: Number,
    default: 0,
    min: 0
  },
  completedWashes: {
    type: Number,
    default: 0,
    min: 0
  },
  monthlyPrice: {
    type: Number,
    required: true,
    min: 0
  },
  startDate: {
    type: Date,
    required: true,
    index: true
  },
  endDate: {
    type: Date,
    required: true,
    index: true
  },
  scheduledWashes: [scheduledWashSchema],
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

const washHistorySchema = new mongoose.Schema({
  washType: {
    type: String,
    required: true
  },
  washer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
    index: true // Add index for better query performance
  },
  feedback: {
    type: String,
    trim: true,
    maxlength: 500
  },
  is_amountPaid: {
    type: Boolean,
    default: false
  },
  washStatus: {
    type: String,
    enum: ['pending', 'completed', 'notcompleted', 'in-progress', 'cancelled'],
    default: 'pending'
  },
  washServiceType: {
    type: String,
    enum: ['Interior', 'Exterior', 'Both'],
    default: 'Exterior'
  },
  startTime: {
    type: Date
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number,
    min: 0,
    max: 480
  }
}, { timestamps: true });

const leadSchema = new mongoose.Schema({
  id: {
    type: Number,
    unique: true
  },
  leadType: {
    type: String,
    enum: ['One-time', 'Monthly'],
    required: true
  },
  leadSource: {
    type: String,
    enum: ['Pamphlet', 'WhatsApp', 'Referral', 'Walk-in', 'Other', 'Social Media', 'Website'],
    required: true
  },
  customerName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^\+?[\d\s\-\(\)]{10,15}$/.test(v);
      },
      message: 'Invalid phone number format'
    }
  },
  area: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  carModel: {
    type: String,
    trim: true,
    maxlength: 50
  },
  vehicleNumber: {
    type: String,
    trim: true,
    maxlength: 20
  },
  notes: {
    type: String,
    maxlength: 1000
  },
  washHistory: [washHistorySchema],
  monthlySubscription: monthlySubscriptionSchema,
  assignedWasher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  oneTimeWash: {
    washType: {
      type: String,
      enum: ['Basic', 'Premium', 'Deluxe']
    },
    amount: {
      type: Number,
      min: 0
    },
    scheduledDate: {
      type: Date,
      index: true
    },
    washer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'cancelled'],
      default: 'pending'
    },
    assignedAt: {
      type: Date,
      default: Date.now
    },
    washServiceType: {
      type: String,
      enum: ['Interior', 'Exterior', 'Both'],
      default: 'Exterior'
    },
    duration: {
      type: Number,
      min: 0,
      max: 480
    }
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: function(v) {
          return v.length === 2 && 
                 v[0] >= -180 && v[0] <= 180 && 
                 v[1] >= -90 && v[1] <= 90;
        },
        message: 'Invalid coordinates format'
      }
    }
  },
  reminder: {
    date: Date,
    note: {
      type: String,
      maxlength: 200
    }
  },
  status: {
    type: String,
    enum: ['New', 'Converted', 'Cancelled'],
    default: 'New'
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Validation middleware
leadSchema.pre('save', function(next) {
  // Validate subscription dates
  if (this.monthlySubscription && this.monthlySubscription.startDate && this.monthlySubscription.endDate) {
    if (this.monthlySubscription.startDate >= this.monthlySubscription.endDate) {
      return next(new Error('Subscription end date must be after start date'));
    }
  }
  
  // Validate wash history dates
  if (this.washHistory && this.washHistory.length > 0) {
    for (let wash of this.washHistory) {
      if (wash.startTime && wash.endTime && wash.startTime >= wash.endTime) {
        return next(new Error('Wash end time must be after start time'));
      }
    }
  }
  
  next();
});

// Auto-increment ID middleware with better error handling
leadSchema.pre('save', async function(next) {
  try {
    if (!this.id) {
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'leadId' },
        { $inc: { sequence_value: 1 } },
        { new: true, upsert: true }
      );
      this.id = counter.sequence_value;
    }
    next();
  } catch (error) {
    console.error('Error generating lead ID:', error);
    next(new Error('Failed to generate lead ID'));
  }
});

// Compound indexes for better query performance
leadSchema.index({ location: '2dsphere' });
leadSchema.index({ id: 1 }, { unique: true });
// Remove unique constraint from phone to allow multiple leads per phone
leadSchema.index({ phone: 1 }); 
leadSchema.index({ customerName: 1, phone: 1 }); // Compound index for customer lookup
leadSchema.index({ assignedWasher: 1, createdAt: -1 }); // For washer assignments
leadSchema.index({ 'oneTimeWash.scheduledDate': 1 }); // For one-time wash queries
leadSchema.index({ 'monthlySubscription.startDate': 1, 'monthlySubscription.endDate': 1 }); // For subscription queries
leadSchema.index({ 'washHistory.date': -1 }); // For wash history queries
leadSchema.index({ status: 1, createdAt: -1 }); // For status-based queries

// Virtual for remaining washes in subscription
monthlySubscriptionSchema.virtual('remainingWashes').get(function() {
  return Math.max(0, this.totalWashes - this.completedWashes);
});

// Virtual for subscription progress
monthlySubscriptionSchema.virtual('progressPercentage').get(function() {
  return this.totalWashes > 0 ? Math.round((this.completedWashes / this.totalWashes) * 100) : 0;
});

// Static methods for common queries
leadSchema.statics.findScheduledWashes = function(startDate, endDate) {
  return this.find({
    $or: [
      { 'oneTimeWash.scheduledDate': { $gte: startDate, $lte: endDate } },
      { 'monthlySubscription.scheduledWashes.scheduledDate': { $gte: startDate, $lte: endDate } },
      { 'washHistory.date': { $gte: startDate, $lte: endDate } }
    ]
  }).populate('assignedWasher washHistory.washer monthlySubscription.scheduledWashes.washer oneTimeWash.washer');
};

leadSchema.statics.findByWasher = function(washerId, startDate, endDate) {
  const query = {
    $or: [
      { assignedWasher: washerId },
      { 'oneTimeWash.washer': washerId },
      { 'washHistory.washer': washerId },
      { 'monthlySubscription.scheduledWashes.washer': washerId }
    ]
  };
  
  if (startDate && endDate) {
    query.$and = [{
      $or: [
        { 'oneTimeWash.scheduledDate': { $gte: startDate, $lte: endDate } },
        { 'monthlySubscription.scheduledWashes.scheduledDate': { $gte: startDate, $lte: endDate } },
        { 'washHistory.date': { $gte: startDate, $lte: endDate } }
      ]
    }];
  }
  
  return this.find(query);
};

module.exports = mongoose.model('Lead', leadSchema);