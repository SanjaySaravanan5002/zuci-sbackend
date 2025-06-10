const mongoose = require('mongoose');
const Counter = require('./Counter');

const washHistorySchema = new mongoose.Schema({
  washType: {
    type: String,
    required: true,
    enum: ['Basic', 'Premium', 'Deluxe']
  },
  washer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
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
    enum: ['completed', 'notcompleted'],
    default: 'completed'
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
    enum: ['Pamphlet', 'WhatsApp', 'Referral', 'Walk-in', 'Other','Social Media'],
    required: true
  },
  customerName: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true,
    index: true
  },
  area: {
    type: String,
    required: true
  },
  carModel: String,
  notes: String,
  washHistory: [washHistorySchema],
  assignedWasher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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
