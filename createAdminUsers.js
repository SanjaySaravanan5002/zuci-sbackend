const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Import models
const User = require('./models/User');

async function createAdminUsers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/carwash');
    console.log('✅ Connected to MongoDB');

    // Check if superadmin exists
    const existingSuperAdmin = await User.findOne({ role: 'superadmin' });
    if (!existingSuperAdmin) {
      const superAdminPassword = await bcrypt.hash('superadmin123', 10);
      const superAdmin = new User({
        name: 'Super Admin',
        email: 'superadmin@carwash.com',
        phone: '9999999999',
        role: 'superadmin',
        password: superAdminPassword,
        status: 'Active'
      });
      await superAdmin.save();
      console.log('✅ Created Super Admin user');
      console.log('   Email: superadmin@carwash.com');
      console.log('   Password: superadmin123');
    } else {
      console.log('✅ Super Admin already exists');
    }

    // Check if admin exists
    const existingAdmin = await User.findOne({ role: 'admin', email: 'admin@carwash.com' });
    if (!existingAdmin) {
      const adminPassword = await bcrypt.hash('admin123', 10);
      const admin = new User({
        name: 'Admin User',
        email: 'admin@carwash.com',
        phone: '9999999998',
        role: 'admin',
        password: adminPassword,
        status: 'Active'
      });
      await admin.save();
      console.log('✅ Created Admin user');
      console.log('   Email: admin@carwash.com');
      console.log('   Password: admin123');
    } else {
      console.log('✅ Admin already exists');
    }

    // Check if limited_admin exists
    const existingLimitedAdmin = await User.findOne({ role: 'limited_admin', email: 'limited@carwash.com' });
    if (!existingLimitedAdmin) {
      const limitedAdminPassword = await bcrypt.hash('limited123', 10);
      const limitedAdmin = new User({
        name: 'Limited Admin',
        email: 'limited@carwash.com',
        phone: '9999999997',
        role: 'limited_admin',
        password: limitedAdminPassword,
        status: 'Active'
      });
      await limitedAdmin.save();
      console.log('✅ Created Limited Admin user');
      console.log('   Email: limited@carwash.com');
      console.log('   Password: limited123');
    } else {
      console.log('✅ Limited Admin already exists');
    }

    // List all admin users
    console.log('\n📋 Current Admin Users:');
    const adminUsers = await User.find({ 
      role: { $in: ['superadmin', 'admin', 'limited_admin'] } 
    }).select('name email role status');
    
    adminUsers.forEach(user => {
      console.log(`   ${user.name} (${user.email}) - ${user.role} - ${user.status}`);
    });

    console.log('\n🎉 Admin users setup completed!');
    
  } catch (error) {
    console.error('❌ Error creating admin users:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run the script
createAdminUsers();