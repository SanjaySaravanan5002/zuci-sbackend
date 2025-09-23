const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const Lead = require('../models/Lead');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { auth, authorize } = require('../middleware/auth');

// Get list of all washers with their summary
// Query parameter: forAssignment=true to get only active washers for assignment dropdowns
router.get('/list', async (req, res) => {
  try {
    // Check if request is for assignment purposes (only active washers)
    const forAssignment = req.query.forAssignment === 'true';
    const statusFilter = forAssignment ? { status: 'Active' } : {};
    
    const washers = await User.find({ role: 'washer', ...statusFilter })
      .select()
      .sort({ name: 1 });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);


    // Get summary for each washer
    const washersWithSummary = await Promise.all(
      washers.map(async (washer) => {
        // Get all leads assigned to this washer
        const leads = await Lead.find({
          'assignedWasher': washer._id,
          
        });

        // Get all wash histories from all leads
        let totalWashes = 0;
        let completedWashes = 0;
        let pendingWashes = 0;

        leads.forEach(lead => {
          if (lead.washHistory && Array.isArray(lead.washHistory)) {
            // Count all washes
            totalWashes += lead.washHistory.length;
            
            // Count completed washes
            completedWashes += lead.washHistory.filter(
              wash => wash.washStatus === 'completed'
            ).length;
            
            // Count pending/not completed washes
            pendingWashes += lead.washHistory.filter(
              wash => wash.washStatus === 'notcompleted'
            ).length;
          }
        });

        return {
          ...washer.toObject(),
          summary: {
            total: totalWashes,
            completed: completedWashes,
            pending: pendingWashes
          }
        };
      })
    );

    res.json(washersWithSummary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create new washer (MOVED BEFORE PARAMETERIZED ROUTES)
router.post('/create', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new washer
    const washer = new User({
      name,
      email,
      phone,
      password: hashedPassword,
      role: 'washer',
    });

    await washer.save();
    res.status(201).json({
      _id: washer._id,
      id: washer.id,
      name: washer.name,
      email: washer.email,
      phone: washer.phone,
      status: washer.status,
      createdAt: washer.createdAt
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Mark attendance for a washer (MOVED BEFORE PARAMETERIZED ROUTES)
router.post('/attendance', async (req, res) => {
  try {
    const { washerId, type } = req.body; // type can be 'in' or 'out'
    
    const washer = await User.findOne({ id: parseInt(washerId) });
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Initialize attendance array if it doesn't exist
    if (!washer.attendance) {
      washer.attendance = [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find if there's an existing attendance record for today
    const existingAttendance = washer.attendance.find(a => {
      const attendanceDate = new Date(a.date);
      attendanceDate.setHours(0, 0, 0, 0);
      return attendanceDate.getTime() === today.getTime();
    });

    const now = new Date();

    if (type === 'in') {
      if (existingAttendance && existingAttendance.timeIn) {
        return res.status(400).json({ message: 'Time-in already marked for today' });
      }

      if (existingAttendance) {
        existingAttendance.timeIn = now;
        existingAttendance.status = 'incomplete';
      } else {
        washer.attendance.push({
          date: now,
          timeIn: now,
          status: 'incomplete'
        });
      }
    } else if (type === 'out') {
      if (!existingAttendance || !existingAttendance.timeIn) {
        return res.status(400).json({ message: 'Must mark time-in before marking time-out' });
      }

      if (existingAttendance.timeOut) {
        return res.status(400).json({ message: 'Time-out already marked for today' });
      }

      existingAttendance.timeOut = now;
      // Calculate duration in hours
      const duration = (now - existingAttendance.timeIn) / (1000 * 60 * 60);
      existingAttendance.duration = parseFloat(duration.toFixed(2));
      existingAttendance.status = 'present';
    }

    await washer.save();
    res.json({ message: `Time-${type} marked successfully` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get washer's wash history with detailed stats (MOVED BEFORE PARAMETERIZED ROUTES)
router.get('/wash-history/:washerId', async (req, res) => {
  try {
    const { washerId } = req.params;
    const { startDate, endDate } = req.query;

    // Validate washer exists
    const washer = await User.findById(washerId);
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Set date range
    const dateQuery = {};
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateQuery.createdAt = { $gte: start, $lte: end };
    }

    // Get all leads assigned to this washer
    const leads = await Lead.find({
      'assignedWasher._id': washerId,
      ...dateQuery
    }).sort({ createdAt: -1 });

    // Calculate statistics
    const stats = {
      total: leads.length,
      completed: leads.filter(l => l.status === 'completed').length,
      pending: leads.filter(l => l.status === 'pending').length,
      cancelled: leads.filter(l => l.status === 'cancelled').length,
      avgCompletionTime: 0,
      totalEarnings: 0,
      monthlyStats: {}
    };

    // Calculate average completion time and total earnings
    const completedLeads = leads.filter(l => l.status === 'completed');
    if (completedLeads.length > 0) {
      const totalTime = completedLeads.reduce((sum, lead) => {
        const startTime = new Date(lead.startTime);
        const endTime = new Date(lead.completedTime);
        return sum + (endTime - startTime);
      }, 0);
      stats.avgCompletionTime = Math.round(totalTime / completedLeads.length / (1000 * 60)); // in minutes
      stats.totalEarnings = completedLeads.reduce((sum, lead) => sum + (lead.price || 0), 0);
    }

    // Group by month
    leads.forEach(lead => {
      const monthYear = new Date(lead.createdAt).toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!stats.monthlyStats[monthYear]) {
        stats.monthlyStats[monthYear] = {
          total: 0,
          completed: 0,
          pending: 0,
          cancelled: 0,
          earnings: 0
        };
      }
      stats.monthlyStats[monthYear].total++;
      stats.monthlyStats[monthYear][lead.status]++;
      if (lead.status === 'completed') {
        stats.monthlyStats[monthYear].earnings += lead.price || 0;
      }
    });

    // Get recent wash history
    const recentHistory = leads.map(lead => ({
      id: lead._id,
      customerName: lead.customerName,
      vehicleType: lead.vehicleType,
      status: lead.status,
      price: lead.price,
      date: lead.createdAt,
      completedTime: lead.completedTime,
      location: lead.location,
      notes: lead.notes,
      rating: lead.rating
    }));

    res.json({
      washerInfo: {
        name: washer.name,
        email: washer.email,
        phone: washer.phone,
        status: washer.status,
        joinedDate: washer.createdAt
      },
      stats,
      recentHistory
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//get by id
router.get('/:id', async (req, res) => {
  try {
    const washer = await User.findById(req.params.id)
      .select('id name email phone status');

    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Get today's leads for the washer
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const leads = await Lead.find({
      'assignedWasher._id': washer._id,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    }).select('id customerName status');

    res.json({
      ...washer.toObject(),
      todayLeads: leads
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



// Get washer dashboard stats
router.get('/:washerId/dashboard', async (req, res) => {
  try {
    const { washerId } = req.params;
    
    // Find washer by ID (try both numeric ID and MongoDB ObjectId)
    let washer;
    if (!isNaN(washerId)) {
      washer = await User.findOne({ id: parseInt(washerId) });
    } else if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
      washer = await User.findById(washerId);
    }
    
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Set up date ranges
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    // Get all leads assigned to this washer
    const assignedLeads = await Lead.find({
      assignedWasher: washer._id
    });

    // Initialize counters and arrays for detailed info
    let todayCompleted = 0;
    let todayPending = 0;
    let tomorrowScheduled = 0;
    const todayWashes = [];
    const tomorrowWashes = [];

    assignedLeads.forEach(lead => {
      // Check wash history entries (this is where most washes are tracked)
      if (lead.washHistory && lead.washHistory.length > 0) {
        lead.washHistory.forEach(wash => {
          if (wash.washer && wash.washer.toString() === washer._id.toString()) {
            const washDate = new Date(wash.date);
            washDate.setHours(0, 0, 0, 0);
            
            // Today's washes
            if (washDate.getTime() === today.getTime()) {
              if (wash.washStatus === 'completed') {
                todayCompleted++;
              } else {
                todayPending++;
              }
              todayWashes.push({
                customerName: lead.customerName,
                area: lead.area,
                washType: wash.washType,
                status: wash.washStatus,
                amount: wash.amount
              });
            }
            
            // Tomorrow's washes
            if (washDate.getTime() === tomorrow.getTime()) {
              tomorrowScheduled++;
              tomorrowWashes.push({
                customerName: lead.customerName,
                area: lead.area,
                washType: wash.washType,
                scheduledTime: wash.date
              });
            }
          }
        });
      }
      
      // Also check if lead is assigned to washer but no specific wash entry
      if (lead.assignedWasher && lead.assignedWasher.toString() === washer._id.toString()) {
        // Check monthly subscription washes
        if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
          lead.monthlySubscription.scheduledWashes.forEach(scheduledWash => {
            const washDate = new Date(scheduledWash.scheduledDate);
            washDate.setHours(0, 0, 0, 0);
            
            // Today's washes
            if (washDate.getTime() === today.getTime()) {
              if (scheduledWash.status === 'completed') {
                todayCompleted++;
              } else {
                todayPending++;
              }
            }
            
            // Tomorrow's washes
            if (washDate.getTime() === tomorrow.getTime()) {
              tomorrowScheduled++;
            }
          });
        }
        
        // Check one-time wash assignments
        if (lead.oneTimeWash && lead.oneTimeWash.scheduledDate) {
          const washDate = new Date(lead.oneTimeWash.scheduledDate);
          washDate.setHours(0, 0, 0, 0);
          
          if (washDate.getTime() === today.getTime()) {
            if (lead.oneTimeWash.status === 'completed') {
              todayCompleted++;
            } else {
              todayPending++;
            }
          }
          
          if (washDate.getTime() === tomorrow.getTime()) {
            tomorrowScheduled++;
          }
        }
      }
    });

    res.json({
      washerInfo: {
        id: washer.id,
        name: washer.name,
        email: washer.email,
        phone: washer.phone
      },
      stats: {
        todayCompleted,
        todayPending,
        tomorrowScheduled,
        todayDate: today.toLocaleDateString('en-GB'),
        tomorrowDate: tomorrow.toLocaleDateString('en-GB'),
        todayWashes,
        tomorrowWashes
      }
    });
  } catch (error) {
    console.error('Error fetching washer dashboard:', error);
    res.status(500).json({ message: error.message });
  }
});

// Debug endpoint to check wash entries
router.get('/:washerId/debug-washes', async (req, res) => {
  try {
    const { washerId } = req.params;
    
    let washer;
    if (!isNaN(washerId)) {
      washer = await User.findOne({ id: parseInt(washerId) });
    } else if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
      washer = await User.findById(washerId);
    }
    
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Set current date as August 12, 2025
    const today = new Date(2025, 7, 12);
    const todayStr = today.toISOString().split('T')[0];
    
    // Find all leads with wash history for this washer
    const leadsWithTodayWashes = await Lead.find({
      'washHistory': {
        $elemMatch: {
          washer: washer._id
        }
      }
    }).select('id customerName washHistory assignedWasher');
    
    const debugInfo = {
      washerId: washer.id,
      washerName: washer.name,
      washerObjectId: washer._id,
      todayDate: todayStr,
      leadsFound: leadsWithTodayWashes.length,
      leads: leadsWithTodayWashes.map(lead => ({
        id: lead.id,
        customerName: lead.customerName,
        assignedWasher: lead.assignedWasher,
        washHistory: lead.washHistory.filter(w => w.washer && w.washer.toString() === washer._id.toString()).map(w => ({
          date: w.date,
          dateStr: new Date(w.date).toISOString().split('T')[0],
          washer: w.washer,
          washType: w.washType,
          isToday: new Date(w.date).toISOString().split('T')[0] === todayStr
        }))
      }))
    };
    
    res.json(debugInfo);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get washer's assigned leads (both one-time and monthly)
router.get('/:washerId/assigned-leads', async (req, res) => {
  try {
    const { washerId } = req.params;
    
    let washer;
    if (!isNaN(washerId)) {
      washer = await User.findOne({ id: parseInt(washerId) });
    } else if (washerId.match(/^[0-9a-fA-F]{24}$/)) {
      washer = await User.findById(washerId);
    }
    
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Find all leads with wash history assigned to this washer
    const assignedLeads = await Lead.find({
      $or: [
        { assignedWasher: washer._id },
        { 'washHistory.washer': washer._id },
        { 'monthlySubscription.scheduledWashes.washer': washer._id },
        { 'oneTimeWash.washer': washer._id }
      ]
    })
    .populate('assignedWasher', 'name')
    .populate('washHistory.washer', 'name')
    .populate('oneTimeWash.washer', 'name')
    .sort({ createdAt: -1 });

    const oneTimeLeads = assignedLeads.filter(lead => lead.leadType === 'One-time');
    const monthlyLeads = assignedLeads.filter(lead => lead.leadType === 'Monthly');

    res.json({
      allLeads: assignedLeads,
      oneTimeLeads,
      monthlyLeads,
      summary: {
        total: assignedLeads.length,
        oneTime: oneTimeLeads.length,
        monthly: monthlyLeads.length,
        converted: assignedLeads.filter(lead => lead.status === 'Converted').length
      }
    });
  } catch (error) {
    console.error('Error fetching assigned leads:', error);
    res.status(500).json({ message: error.message });
  }
});



// Get washer's attendance history
router.get('/:id/attendance', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const washer = await User.findOne({ id: parseInt(req.params.id) });

    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    let attendance = washer.attendance || [];

    // Filter by date range if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      attendance = attendance.filter(a => {
        const date = new Date(a.date);
        return date >= start && date <= end;
      });
    }

    // Calculate statistics
    const stats = {
      totalDays: attendance.length,
      presentDays: attendance.filter(a => a.timeIn && a.timeOut).length,
      incompleteDays: attendance.filter(a => a.timeIn && !a.timeOut).length,
      totalHours: attendance.reduce((sum, a) => sum + (a.duration || 0), 0)
    };

    res.json({
      attendance: attendance.sort((a, b) => new Date(b.date) - new Date(a.date)),
      stats
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update wash status by washer (handles both one-time and monthly leads)
router.put('/:washerId/update-wash/:leadId', async (req, res) => {
  try {
    const { washerId, leadId } = req.params;
    const { washStatus, amountPaid, feedback } = req.body;

    // Find washer
    const washer = await User.findOne({ id: parseInt(washerId) });
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Find lead
    const lead = await Lead.findOne({ id: parseInt(leadId) });
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check if washer is assigned to this lead
    if (!lead.assignedWasher || lead.assignedWasher.toString() !== washer._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this lead' });
    }

    // Washers can only update existing wash entries, not create new ones
    if (lead.washHistory.length === 0) {
      return res.status(400).json({ message: 'No wash entry found to update. Admin must create wash entry first.' });
    }

    // Update the latest wash entry (only status, payment, and feedback)
    const latestWash = lead.washHistory[lead.washHistory.length - 1];
    latestWash.washStatus = washStatus;
    latestWash.is_amountPaid = amountPaid;
    latestWash.feedback = feedback;
    
    if (washStatus === 'completed') {
      lead.status = 'Converted';
    }
    
    await lead.save();

    // Customer creation logic based on lead type
    const Customer = require('../models/Customer');
    if (lead.leadType === 'Monthly') {
      // For Monthly leads, create customer immediately after first wash
      await createOrUpdateCustomer(lead, 'Monthly');
    } else if (lead.leadType === 'One-time' && lead.washHistory.length >= 2) {
      // For One-time leads, create customer only after 2nd wash
      await createOrUpdateCustomer(lead, 'One-time');
    }

    const updatedLead = await Lead.findById(lead._id)
      .populate('assignedWasher', 'name')
      .populate('washHistory.washer', 'name');

    res.json(updatedLead);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Helper function to create or update customer
async function createOrUpdateCustomer(lead, customerType) {
  const Customer = require('../models/Customer');
  
  try {
    let customer = await Customer.findOne({ phone: lead.phone });
    
    if (!customer) {
      // Determine plan based on lead type and subscription
      let plan = 'One-time';
      let planDetails = {};
      
      if (lead.leadType === 'Monthly' && lead.monthlySubscription) {
        plan = lead.monthlySubscription.packageType;
        planDetails = {
          startDate: lead.monthlySubscription.startDate,
          washesUsed: lead.monthlySubscription.completedWashes,
          totalWashes: lead.monthlySubscription.totalWashes
        };
      }
      
      // Create new customer
      customer = new Customer({
        name: lead.customerName,
        phone: lead.phone,
        area: lead.area,
        carModel: lead.carModel,
        customerType: lead.leadType,
        plan: plan,
        planDetails: planDetails,
        location: lead.location,
        status: 'Active'
      });
      await customer.save();
      console.log(`Customer created for ${lead.leadType} lead: ${lead.customerName}`);
    } else {
      // Update existing customer
      if (lead.leadType === 'Monthly' && lead.monthlySubscription) {
        customer.planDetails.washesUsed = lead.monthlySubscription.completedWashes;
      }
      await customer.save();
      console.log(`Customer updated for ${lead.leadType} lead: ${lead.customerName}`);
    }
  } catch (error) {
    console.error('Error creating/updating customer:', error);
  }
}



// Update washer status
router.post('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    console.log("id", id);
    console.log("status", status);
    
    
    const washer = await User.findOne({id: parseInt(id)});
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }
    
    washer.status = status;
    await washer.save();
    
    res.json({ message: 'Washer status updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
//get by id
router.get('/:id/wash-details', async (req, res) => {
  try {
    const washer = await User.findOne({id: parseInt(req.params.id)});

    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Get all leads assigned to this washer with their wash history
    const leads = await Lead.find({
      assignedWasher: washer._id,
      'washHistory.washer': washer._id
    }).sort({ createdAt: -1 });

    // Calculate statistics
    let totalEarnings = 0;
    let totalCompletedWashes = 0;
    let totalWashes = 0;

    // Process wash history from all leads
    const allWashes = [];
    leads.forEach(lead => {
      if (lead.washHistory && lead.washHistory.length > 0) {
        lead.washHistory.forEach(wash => {
          if (wash.washer && wash.washer.toString() === washer._id.toString()) {
            totalWashes++;
            if (wash.washStatus === 'completed') {
              totalCompletedWashes++;
              // Only count earnings from completed AND paid washes
              if (wash.is_amountPaid === true) {
                totalEarnings += wash.amount || 0;
              }
            }

            // Add to all washes array
            allWashes.push({
              id: wash._id,
              customerName: lead.customerName,
              customerPhone: lead.phone,
              area: lead.area,
              carModel: lead.carModel,
              washType: wash.washType,
              amount: wash.amount,
              date: wash.date,
              status: wash.washStatus,
              feedback: wash.feedback,
              isPaid: wash.is_amountPaid,
              leadType: lead.leadType,
              leadSource: lead.leadSource,
              createdAt: wash.createdAt,
              updatedAt: wash.updatedAt
            });
          }
        });
      }
    });

    // Sort washes by date descending
    allWashes.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Get recent washes (last 10)
    const recentWashes = allWashes.slice(0, 10);

    res.json({
      ...washer.toObject(),
      stats: {
        totalEarnings,
        totalWashes,
        completedWashes: totalCompletedWashes,
        completionRate: totalWashes > 0 ? (totalCompletedWashes / totalWashes) * 100 : 0
      },
      recentWashes,
      allWashes
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update washer details (Edit functionality)
router.put('/:id', async (req, res) => {
  try {
    const { name, email, phone, address, salary } = req.body;
    const washer = await User.findOne({ id: parseInt(req.params.id) });

    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Update basic details
    if (name) washer.name = name;
    if (email) washer.email = email;
    if (phone) washer.phone = phone;
    if (address) washer.address = address;
    if (salary) {
      washer.salary = {
        base: salary.base || 0,
        bonus: salary.bonus || 0
      };
    }

    await washer.save();
    res.json({ message: 'Washer updated successfully', washer });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete washer
router.delete('/:id', async (req, res) => {
  try {
    const washer = await User.findOneAndDelete({ id: parseInt(req.params.id) });
    
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }
    
    res.json({ message: 'Washer deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload photos for washer
router.post('/:id/upload-photos', upload.fields([
  { name: 'aadharImage', maxCount: 1 },
  { name: 'drivingLicenseImage', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 }
]), async (req, res) => {
  try {
    const washer = await User.findOne({ id: parseInt(req.params.id) });

    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Update images if provided
    if (req.files) {
      if (req.files.aadharImage) {
        const aadharFile = req.files.aadharImage[0];
        washer.aadharImage = {
          data: aadharFile.buffer.toString('base64'),
          contentType: aadharFile.mimetype
        };
      }
      
      if (req.files.drivingLicenseImage) {
        const licenseFile = req.files.drivingLicenseImage[0];
        washer.drivingLicenseImage = {
          data: licenseFile.buffer.toString('base64'),
          contentType: licenseFile.mimetype
        };
      }

      if (req.files.profilePhoto) {
        const profileFile = req.files.profilePhoto[0];
        washer.profilePhoto = {
          data: profileFile.buffer.toString('base64'),
          contentType: profileFile.mimetype
        };
      }
    }

    await washer.save();
    res.json({ message: 'Photos uploaded successfully', washer });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update attendance (Edit Present/Absent)
router.put('/:id/attendance/:attendanceId', async (req, res) => {
  try {
    const { status } = req.body;
    const washer = await User.findOne({ id: parseInt(req.params.id) });

    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Initialize attendance array if it doesn't exist
    if (!washer.attendance) {
      washer.attendance = [];
    }

    // Find or create attendance record for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let attendance = washer.attendance.find(att => {
      const attDate = new Date(att.date);
      attDate.setHours(0, 0, 0, 0);
      return attDate.getTime() === today.getTime();
    });

    if (!attendance) {
      // Create new attendance record
      attendance = {
        date: today,
        status: status,
        timeIn: status === 'present' ? new Date() : null,
        timeOut: null,
        duration: 0
      };
      washer.attendance.push(attendance);
    } else {
      // Update existing record
      attendance.status = status;
      if (status === 'present' && !attendance.timeIn) {
        attendance.timeIn = new Date();
      } else if (status === 'absent') {
        attendance.timeIn = null;
        attendance.timeOut = null;
        attendance.duration = 0;
      }
    }

    await washer.save();
    res.json({ message: 'Attendance updated successfully', attendance });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update attendance by specific date
router.put('/:id/attendance/date/:date', async (req, res) => {
  try {
    const { status } = req.body;
    const { date } = req.params;
    
    const washer = await User.findOne({ id: parseInt(req.params.id) });
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    if (!washer.attendance) {
      washer.attendance = [];
    }

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    
    const attendanceIndex = washer.attendance.findIndex(att => {
      const attDate = new Date(att.date);
      attDate.setHours(0, 0, 0, 0);
      return attDate.getTime() === targetDate.getTime();
    });

    const timeIn = new Date(targetDate);
    timeIn.setHours(9, 0, 0, 0); // 9 AM
    
    const timeOut = new Date(targetDate);
    timeOut.setHours(18, 0, 0, 0); // 6 PM

    if (attendanceIndex === -1) {
      // Create new record
      const newAttendance = {
        date: targetDate,
        status: status,
        timeIn: timeIn,
        timeOut: status === 'present' ? timeOut : undefined,
        duration: status === 'present' ? 9 : 0
      };
      washer.attendance.push(newAttendance);
    } else {
      // Update existing record
      washer.attendance[attendanceIndex].status = status;
      washer.attendance[attendanceIndex].timeIn = timeIn;
      
      if (status === 'present') {
        washer.attendance[attendanceIndex].timeOut = timeOut;
        washer.attendance[attendanceIndex].duration = 9;
      } else {
        washer.attendance[attendanceIndex].timeOut = undefined;
        washer.attendance[attendanceIndex].duration = 0;
      }
    }

    await washer.save();
    res.json({ 
      message: `Attendance ${status} for ${targetDate.toLocaleDateString()}`,
      success: true
    });
  } catch (error) {
    console.error('Attendance update error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update washer personal details
router.put('/:id/personal-details', upload.fields([
  { name: 'aadharImage', maxCount: 1 },
  { name: 'drivingLicenseImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { address, dateOfBirth, email, phone, password, keepExistingPassword } = req.body;
    console.log("Request body:", req.body);
    console.log("Password received:", password);
    console.log("keepExistingPassword:", keepExistingPassword);
    const washer = await User.findOne({ id: parseInt(req.params.id) });

    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    washer.address = address;
    washer.dateOfBirth = new Date(dateOfBirth);
    washer.email = email;
    washer.phone = phone;
    
    // Only update password if a new one is provided
    if (!keepExistingPassword && password) {
      // Hash the password before saving
      console.log("Hashing password:", password);
      const hashedPassword = await bcrypt.hash(password, 10);
      console.log("Hashed password:", hashedPassword);
      washer.password = hashedPassword;
      console.log("Password updated successfully");
    } else {
      console.log("Password not updated because:", !password ? "no password provided" : "keepExistingPassword is true");
    }

    // Update images if provided
    if (req.files) {
      if (req.files.aadharImage) {
        const aadharFile = req.files.aadharImage[0];
        washer.aadharImage = {
          data: aadharFile.buffer.toString('base64'),
          contentType: aadharFile.mimetype
        };
      }
      
      if (req.files.drivingLicenseImage) {
        const licenseFile = req.files.drivingLicenseImage[0];
        washer.drivingLicenseImage = {
          data: licenseFile.buffer.toString('base64'),
          contentType: licenseFile.mimetype
        };
      }
    }

    await washer.save();
    res.json(washer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



// Get washer salary information
router.get('/:id/salary', async (req, res) => {
  try {
    const washer = await User.findOne({ id: parseInt(req.params.id) });
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    res.json({
      success: true,
      data: washer.salary || null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Set/Update washer salary
router.post('/:id/salary', async (req, res) => {
  try {
    const { baseSalary, effectiveDate } = req.body;
    const washer = await User.findOne({ id: parseInt(req.params.id) });
    
    if (!washer) {
      return res.status(404).json({ success: false, error: 'Washer not found' });
    }

    washer.salary = {
      baseSalary: parseFloat(baseSalary),
      effectiveDate: new Date(effectiveDate),
      updatedAt: new Date()
    };

    await washer.save();
    
    res.json({
      success: true,
      message: 'Salary updated successfully',
      data: washer.salary
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get washer performance details for dashboard
router.get('/:id/performance', async (req, res) => {
  try {
    const washer = await User.findOne({ id: parseInt(req.params.id) });
    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    // Get performance data from leads
    const leads = await Lead.find({
      $or: [
        { 'washHistory.washer': washer._id },
        { 'monthlySubscription.scheduledWashes.washer': washer._id }
      ]
    });

    let totalWashes = 0;
    let completedWashes = 0;
    let totalRevenue = 0;
    let customerCount = new Set();

    leads.forEach(lead => {
      customerCount.add(lead._id.toString());
      
      // Count wash history
      if (lead.washHistory) {
        lead.washHistory.forEach(wash => {
          if (wash.washer && wash.washer.toString() === washer._id.toString()) {
            totalWashes++;
            if (wash.washStatus === 'completed') {
              completedWashes++;
              if (wash.is_amountPaid) {
                totalRevenue += wash.amount || 0;
              }
            }
          }
        });
      }

      // Count monthly subscription washes
      if (lead.monthlySubscription && lead.monthlySubscription.scheduledWashes) {
        lead.monthlySubscription.scheduledWashes.forEach(wash => {
          if (wash.washer && wash.washer.toString() === washer._id.toString()) {
            totalWashes++;
            if (wash.status === 'completed') {
              completedWashes++;
              if (wash.is_amountPaid) {
                totalRevenue += wash.amount || 0;
              }
            }
          }
        });
      }
    });

    // Get attendance data for current month
    const currentDate = new Date();
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    
    const monthlyAttendance = washer.attendance?.filter(att => {
      const attDate = new Date(att.date);
      return attDate >= startOfMonth && attDate <= endOfMonth;
    }) || [];

    const presentDays = monthlyAttendance.filter(att => att.status === 'present').length;
    const totalWorkingDays = endOfMonth.getDate();

    res.json({
      washerInfo: {
        id: washer.id,
        name: washer.name,
        phone: washer.phone,
        email: washer.email
      },
      performance: {
        totalWashes,
        completedWashes,
        completionRate: totalWashes > 0 ? ((completedWashes / totalWashes) * 100).toFixed(1) : '0',
        totalRevenue,
        avgRevenuePerWash: completedWashes > 0 ? (totalRevenue / completedWashes).toFixed(0) : '0',
        customerCount: customerCount.size,
        presentDays,
        totalWorkingDays,
        attendancePercentage: totalWorkingDays > 0 ? ((presentDays / totalWorkingDays) * 100).toFixed(1) : '0'
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
