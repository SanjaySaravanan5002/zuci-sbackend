const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  washCount: {
    type: Number,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  description: String,
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Default packages
const defaultPackages = [
  { name: 'Basic', washCount: 3, price: 300, description: '3 washes per month' },
  { name: 'Premium', washCount: 4, price: 400, description: '4 washes per month' },
  { name: 'Deluxe', washCount: 5, price: 500, description: '5 washes per month' }
];

packageSchema.statics.initializeDefaults = async function() {
  const count = await this.countDocuments();
  if (count === 0) {
    await this.insertMany(defaultPackages);
  }
};

module.exports = mongoose.model('WashPackage', packageSchema);