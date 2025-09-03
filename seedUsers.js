require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Counter = require('./models/Counter');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/zuci-crm');
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const seedUsers = async () => {
  try {
    await connectDB();

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'admin@zuci.com' });
    if (existingAdmin) {
      console.log('✅ Admin user already exists');
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('admin123', 10);

    // Create admin user
    const adminUser = new User({
      name: 'Admin User',
      email: 'admin@zuci.com',
      phone: '9876543210',
      password: hashedPassword,
      role: 'admin',
      status: 'Active'
    });

    await adminUser.save();
    console.log('✅ Admin user created successfully');
    console.log('📧 Email: admin@zuci.com');
    console.log('🔑 Password: admin123');

    // Create a sample washer user
    const washerPassword = await bcrypt.hash('washer123', 10);
    const washerUser = new User({
      name: 'Sample Washer',
      email: 'washer@zuci.com',
      phone: '9876543211',
      password: washerPassword,
      role: 'washer',
      area: 'Chennai',
      status: 'Active',
      salary: {
        base: 15000,
        bonus: 0
      }
    });

    await washerUser.save();
    console.log('✅ Sample washer user created successfully');
    console.log('📧 Email: washer@zuci.com');
    console.log('🔑 Password: washer123');

  } catch (error) {
    console.error('❌ Error seeding users:', error);
  } finally {
    mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
};

seedUsers();