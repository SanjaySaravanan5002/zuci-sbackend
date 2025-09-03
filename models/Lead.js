const mongoose = require('mongoose');
const Counter = require('./Counter');

const scheduledWashSchema = new mongoose.Schema({
  washNumber: {
    type: Number,
    required: true
  },
  scheduledDate: {
    type: Date,
    required: true
  },
  scheduledTime: {
    type: String,
    default: '10:00'
  },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'missed'],
    default: 'scheduled'
  },
  completedDate: Date,
  washer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  feedback: String,
  amount: Number,
  is_amountPaid: {
    type: Boolean,
    default: false
  },
  washServiceType: {
    type: String,
    enum: ['Interior', 'Exterior'],
    default: 'Exterior'
  },
  duration: {
    type: Number // in minutes
  }
}, { timestamps: true });

const monthlySubscriptionSchema = new mongoose.Schema({
  packageType: {
    type: String,
    required: true
  },
  customPlanName: {
    type: String,
    default: ''
  },
  totalWashes: {
    type: Number,
    required: true
  },
  totalInteriorWashes: {
    type: Number,
    default: 0
  },
  usedInteriorWashes: {
    type: Number,
    default: 0
  },
  completedWashes: {
    type: Number,
    default: 0
  },
  monthlyPrice: {
    type: Number,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
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
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  feedback: {
    type: String,
    trim: true
  },
  is_amountPaid: {
    type: Boolean,
    default: false
  },
  washStatus: {
    type: String,
    enum: ['pending', 'completed', 'notcompleted', 'in-progress'],
    default: 'pending'
  },
  washServiceType: {
    type: String,
    enum: ['Interior', 'Exterior'],
    default: 'Exterior'
  },
  startTime: {
    type: Date
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number // in minutes
  }
}, { timestamps: true });

const leadSchema = new mongoose.Schema({
  id: {
    type: Number
  },
  leadType: {
    type: String,
    enum: ['One-time', 'Monthly'],
    required: true
  },
  leadSource: {
    type: String,
    enum: ['Pamphlet', 'WhatsApp', 'Referral', 'Walk-in', 'Other','Social Media', 'Website'],
    required: true
  },
  customerName: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  area: {
    type: String,
    required: true
  },
  carModel: String,
  vehicleNumber: String,
  notes: String,
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
    amount: Number,
    scheduledDate: Date,
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
      enum: ['Interior', 'Exterior'],
      default: 'Exterior'
    },
    duration: {
      type: Number // in minutes
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
      required: true
    }
  },
  reminder: {
    date: Date,
    note: String
  },
  status: {
    type: String,
    enum: ['New', 'Converted'],
    default: 'New'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Auto-increment ID middleware
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
    next(error);
  }
});

// Indexes
leadSchema.index({ location: '2dsphere' });
leadSchema.index({ id: 1 }, { unique: true });
leadSchema.index({ phone: 1 }, { unique: true });

// Create the model
module.exports = mongoose.model('Lead', leadSchema);
