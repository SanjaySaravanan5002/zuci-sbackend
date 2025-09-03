const mongoose = require('mongoose');

const washHistorySchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  washer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  remarks: String,
  rating: {
    type: Number,
    min: 1,
    max: 5
  }
});

const customerSchema = new mongoose.Schema({
  name: {
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
  customerType: {
    type: String,
    enum: ['Monthly', 'One-time'],
    required: true
  },
  plan: {
    type: String,
    enum: ['Basic', 'Premium', 'Deluxe', 'One-time'],
    required: true
  },
  planDetails: {
    startDate: Date,
    nextWashDate: Date,
    washesUsed: {
      type: Number,
      default: 0
    },
    totalWashes: Number
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
  status: {
    type: String,
    enum: ['Active', 'Suspended'],
    default: 'Active'
  },
  suspensionDetails: {
    reason: {
      type: String,
      enum: ['Non-payment', 'Not reachable', 'Requested pause', 'Other']
    },
    date: Date,
    notes: String
  },
  washHistory: [washHistorySchema],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

customerSchema.index({ location: '2dsphere' });
customerSchema.index({ phone: 1 });

module.exports = mongoose.model('Customer', customerSchema);
