const mongoose = require('mongoose');
const Counter = require('./Counter');

const attendanceSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  timeIn: {
    type: Date,
    required: true
  },
  timeOut: {
    type: Date
  },
  duration: {
    type: Number
  },
  status: {
    type: String,
    enum: ['present', 'incomplete', 'absent'],
    default: 'incomplete'
  }
});

const userSchema = new mongoose.Schema({
  // Personal Details
  address: String,
  dateOfBirth: Date,
  aadharNumber: {
    type: String,
    minlength: 12,
    maxlength: 12
  },
  aadharImage: {
    data: String, // base64
    contentType: String
  },
  drivingLicenseImage: {
    data: String, // base64
    contentType: String
  },
  id: {
    type: Number,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'limited_admin', 'washer'],
    required: true
  },
  password: {
    type: String,
    required: true
  },
  area: String,
  salary: {
    base: Number,
    bonus: Number
  },
  attendance: [attendanceSchema],
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Auto-increment ID middleware
userSchema.pre('save', async function(next) {
  try {
    if (!this.id) {
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'userId' },
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

// Indexes are already defined in the schema fields above
// userSchema.index({ phone: 1 }); // Removed duplicate - already defined with unique: true in schema
// userSchema.index({ id: 1 }, { unique: true }); // Removed duplicate - already defined with unique: true in schema

module.exports = mongoose.model('User', userSchema);
