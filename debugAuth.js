const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
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

const debugAuth = async () => {
  try {
    await connectDB();

    // Find superadmin user
    const superadmin = await User.findOne({ email: 'superadmin@zuci.com' });
    
    if (!superadmin) {
      console.log('❌ Superadmin user not found');
      process.exit(1);
    }

    console.log('✅ Superadmin user found:');
    console.log('- ID:', superadmin._id);
    console.log('- Name:', superadmin.name);
    console.log('- Email:', superadmin.email);
    console.log('- Role:', superadmin.role);

    // Test JWT token generation
    const payload = {
      userId: superadmin._id,
      role: superadmin.role
    };
    
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
    console.log('✅ Generated JWT token:', token.substring(0, 50) + '...');

    // Test JWT token verification
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('✅ Token verification successful:');
      console.log('- User ID:', decoded.userId);
      console.log('- Role:', decoded.role);
    } catch (error) {
      console.log('❌ Token verification failed:', error.message);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Debug error:', error);
    process.exit(1);
  }
};

debugAuth();