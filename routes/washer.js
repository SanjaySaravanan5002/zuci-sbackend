const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer();
const Lead = require('../models/Lead');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Get list of all washers with their summary
router.get('/list', async (req, res) => {
  try {
    const washers = await User.find({ role: 'washer', status: 'Active' })
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

// Create new washer
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

// Get washer's assigned leads for a specific date
router.get('/assigned-washes', async (req, res) => {
  try {
    const { date, washerId } = req.query;
    
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const assignedLeads = await Lead.find({
      'assignedWasher._id': washerId,
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    }).sort({ scheduledTime: 1 });

    res.json(assignedLeads);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Mark attendance for a washer
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

// Update wash status
router.put('/wash/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { status, remarks,password } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    lead.status = status;
    if (remarks) {
      lead.notes = remarks;
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      lead.password = hashedPassword;
    }
    await lead.save();
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get washer's wash history with detailed stats
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
          if (wash.washer.equals(washer._id)) {
            totalWashes++;
            if (wash.washStatus === 'completed') {
              totalCompletedWashes++;
              totalEarnings += wash.amount || 0;
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

// Update washer personal details
router.put('/:id/personal-details', upload.fields([
  { name: 'aadharImage', maxCount: 1 },
  { name: 'drivingLicenseImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { address, dateOfBirth, aadharNumber, email, phone, password, keepExistingPassword } = req.body;
    console.log("Request body:", req.body);
    console.log("Password received:", password);
    console.log("keepExistingPassword:", keepExistingPassword);
    const washer = await User.findOne({ id: parseInt(req.params.id) });

    if (!washer) {
      return res.status(404).json({ message: 'Washer not found' });
    }

    washer.address = address;
    washer.dateOfBirth = new Date(dateOfBirth);
    washer.aadharNumber = aadharNumber;
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



module.exports = router;
