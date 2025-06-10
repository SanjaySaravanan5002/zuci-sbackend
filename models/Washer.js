const mongoose = require('mongoose');

const washerSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  todayLeads: [{
    id: Number,
    customerName: String,
    status: String,
    area: String
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Washer', washerSchema);
