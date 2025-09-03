const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

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

const createLimitedAdmin = async () => {
  try {
    await connectDB();

    // Check if limited admin already exists
    const existingUser = await User.findOne({ email: 'limited@admin.com' });
    if (existingUser) {
      console.log('❌ Limited admin user already exists');
      process.exit(0);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('password123', 10);

    // Create limited admin user
    const limitedAdmin = new User({
      name: 'Limited Admin',
      email: 'limited@admin.com',
      phone: '9876543210',
      role: 'limited_admin',
      password: hashedPassword,
      status: 'Active'
    });

    await limitedAdmin.save();
    console.log('✅ Limited admin user created successfully');
    console.log('📧 Email: limited@admin.com');
    console.log('🔑 Password: password123');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating limited admin:', error);
    process.exit(1);
  }
};

createLimitedAdmin();