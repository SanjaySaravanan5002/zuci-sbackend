const mongoose = require('mongoose');
require('dotenv').config();

const Lead = require('./models/Lead');
const User = require('./models/User');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zuci-crm');
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

const createTestData = async () => {
  try {
    await connectDB();

    // Create a test washer if not exists
    let washer = await User.findOne({ role: 'washer' });
    if (!washer) {
      washer = new User({
        name: 'Test Washer',
        email: 'washer@test.com',
        phone: '9876543210',
        role: 'washer',
        password: 'hashedpassword',
        status: 'Active'
      });
      await washer.save();
    }

    // Create test leads with wash history
    const testLeads = [
      {
        customerName: 'John Doe',
        phone: '9876543211',
        email: 'john@test.com',
        area: 'Downtown',
        leadType: 'One-time',
        status: 'Converted',
        washHistory: [
          {
            date: new Date('2024-12-01'),
            washType: 'Premium',
            amount: 500,
            washStatus: 'completed',
            is_amountPaid: true,
            washer: washer._id
          },
          {
            date: new Date('2024-12-15'),
            washType: 'Deluxe',
            amount: 300,
            washStatus: 'completed',
            is_amountPaid: true,
            washer: washer._id
          }
        ]
      },
      {
        customerName: 'Jane Smith',
        phone: '9876543212',
        email: 'jane@test.com',
        area: 'Uptown',
        leadType: 'Monthly',
        status: 'Converted',
        washHistory: [
          {
            date: new Date('2024-12-05'),
            washType: 'Standard',
            amount: 200,
            washStatus: 'completed',
            is_amountPaid: false,
            washer: washer._id
          }
        ]
      }
    ];

    // Clear existing test data
    await Lead.deleteMany({ email: { $in: ['john@test.com', 'jane@test.com'] } });

    // Insert test data
    await Lead.insertMany(testLeads);

    console.log('✅ Test data created successfully');
    console.log('📊 Created 2 customers with wash history');
    console.log('💰 Total revenue: ₹1000 (₹800 paid, ₹200 unpaid)');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test data:', error);
    process.exit(1);
  }
};

createTestData();