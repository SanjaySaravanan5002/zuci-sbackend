const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';

// Test authentication and role-based access
async function testAuth() {
  try {
    console.log('🔍 Testing Authentication and Role-based Access...\n');

    // Test 1: Test basic connectivity
    console.log('1. Testing basic connectivity...');
    try {
      const response = await axios.get(`${API_BASE}/dashboard/test`);
      console.log('✅ Dashboard service is running:', response.data.message);
    } catch (error) {
      console.log('❌ Dashboard service is not running');
      return;
    }

    // Test 2: Try accessing protected route without token
    console.log('\n2. Testing access without authentication...');
    try {
      await axios.get(`${API_BASE}/dashboard/stats`);
      console.log('❌ Should have been denied access');
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('✅ Correctly denied access without token');
      } else {
        console.log('❌ Unexpected error:', error.response?.status);
      }
    }

    // Test 3: Login with admin credentials (you'll need to create these)
    console.log('\n3. Testing login...');
    let adminToken = null;
    try {
      // Try to login with default admin credentials
      const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
        email: 'admin@carwash.com',
        password: 'admin123'
      });
      
      adminToken = loginResponse.data.token;
      console.log('✅ Login successful');
      console.log('   User:', loginResponse.data.user.name);
      console.log('   Role:', loginResponse.data.user.role);
    } catch (error) {
      console.log('❌ Login failed:', error.response?.data?.message || error.message);
      console.log('   Make sure you have created admin user with email: admin@carwash.com, password: admin123');
      return;
    }

    // Test 4: Access protected route with token
    console.log('\n4. Testing authenticated access...');
    try {
      const response = await axios.get(`${API_BASE}/dashboard/stats`, {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      });
      console.log('✅ Successfully accessed dashboard stats');
      console.log('   Active Customers:', response.data.activeCustomers?.value || 0);
      console.log('   Income:', response.data.income?.value || 0);
    } catch (error) {
      console.log('❌ Failed to access dashboard:', error.response?.data?.message || error.message);
      console.log('   Status:', error.response?.status);
    }

    // Test 5: Test other dashboard endpoints
    console.log('\n5. Testing other dashboard endpoints...');
    const endpoints = [
      '/dashboard/washer-attendance',
      '/dashboard/revenue-by-service',
      '/dashboard/lead-sources',
      '/dashboard/area-distribution',
      '/dashboard/feedback-analytics',
      '/dashboard/today-tomorrow-wash-count'
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${API_BASE}${endpoint}`, {
          headers: {
            'Authorization': `Bearer ${adminToken}`
          }
        });
        console.log(`✅ ${endpoint}: Success`);
      } catch (error) {
        console.log(`❌ ${endpoint}: Failed (${error.response?.status})`);
      }
    }

    console.log('\n🎉 Authentication test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testAuth();