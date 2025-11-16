import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import Patient from '../models/Patient.js';
import User from '../models/User.js';
import Appointment from '../models/Appointment.js';
import Visit from '../models/Visit.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// ===== ADMIN DASHBOARD =====
router.get('/admin/stats', authorize('admin'), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get total patients
    const totalPatients = await Patient.countDocuments();

    // Get active visits (status not completed or cancelled)
    const activeVisits = await Visit.countDocuments({
      status: { $in: ['In Queue', 'In-Progress', 'active'] }
    });

    // Get available doctors (all doctors marked as available)
    const totalDoctors = await User.countDocuments({
      role: 'doctor'
    });

    // Get today's appointments
    const appointmentsToday = await Appointment.countDocuments({
      appointmentDate: {
        $gte: today,
        $lt: tomorrow
      }
    });

    // Get total revenue from paid invoices
    const revenueData = await Invoice.aggregate([
      {
        $match: { status: 'paid' }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' }
        }
      }
    ]);

    const totalRevenue = revenueData[0]?.totalRevenue || 0;

    // Get pending bills
    const pendingBills = await Invoice.countDocuments({
      status: { $in: ['pending', 'overdue'] }
    });

    const stats = {
      totalPatients,
      activeVisits,
      totalDoctors,
      appointmentsToday,
      totalRevenue,
      pendingBills
    };

    res.status(200).json({ 
      success: true, 
      data: stats 
    });
  } catch (error) {
    logger.error('Get admin stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

router.get('/admin/recent-activity', authorize('admin'), async (req, res) => {
  try {
    // Get recent visits (last 5)
    const recentVisits = await Visit.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('patient', 'firstName lastName')
      .lean();

    // Get recent appointments (last 5)
    const recentAppointments = await Appointment.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('patient', 'firstName lastName')
      .lean();

    // Format activities with consistent structure
    const activities = [];

    recentVisits.forEach(visit => {
      activities.push({
        id: visit._id,
        type: visit.status === 'Completed' ? 'discharge' : 'admission',
        description: `${visit.patient?.firstName} ${visit.patient?.lastName} - ${visit.reason || 'Visit'}`,
        timestamp: visit.createdAt
      });
    });

    recentAppointments.forEach(apt => {
      activities.push({
        id: apt._id,
        type: 'appointment',
        description: `Appointment scheduled for ${apt.patient?.firstName} ${apt.patient?.lastName}`,
        timestamp: apt.createdAt
      });
    });

    // Sort by timestamp and take top 10
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);

    res.status(200).json({ 
      success: true, 
      data: activities 
    });
  } catch (error) {
    logger.error('Get admin activity error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== DOCTOR DASHBOARD =====
router.get('/doctor/queue', authorize('doctor'), async (req, res) => {
  try {
    const doctorId = req.user.id;

    const queue = await Visit.find({
      doctor: doctorId,
      status: { $in: ['In Queue', 'In-Progress'] }
    })
      .populate('patient', 'firstName lastName')
      .populate('doctor', 'firstName lastName')
      .sort({ visitDate: 1 })
      .lean();

    // Transform for frontend
    const formattedQueue = queue.map(visit => ({
      id: visit._id,
      name: `${visit.patient?.firstName} ${visit.patient?.lastName}`,
      checkInTime: new Date(visit.createdAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      type: visit.type || 'Follow-up'
    }));

    res.status(200).json({ 
      success: true, 
      data: formattedQueue 
    });
  } catch (error) {
    logger.error('Get doctor queue error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

router.get('/doctor/stats', authorize('doctor'), async (req, res) => {
  try {
    const doctorId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Patients today
    const patientsToday = await Visit.countDocuments({
      doctor: doctorId,
      visitDate: {
        $gte: today,
        $lt: tomorrow
      }
    });

    // Appointments completed today
    const appointmentsCompleted = await Appointment.countDocuments({
      doctor: doctorId,
      status: 'completed',
      appointmentDate: {
        $gte: today,
        $lt: tomorrow
      }
    });

    // Pending appointments for this doctor
    const pendingAppointments = await Appointment.countDocuments({
      doctor: doctorId,
      status: { $in: ['pending', 'scheduled'] }
    });

    // Calculate average wait time from visits
    const waitTimeData = await Visit.aggregate([
      {
        $match: {
          doctor: doctorId,
          startTime: { $exists: true },
          createdAt: {
            $gte: today,
            $lt: tomorrow
          }
        }
      },
      {
        $project: {
          waitTime: {
            $subtract: ['$startTime', '$createdAt']
          }
        }
      },
      {
        $group: {
          _id: null,
          avgWaitTime: { $avg: '$waitTime' }
        }
      }
    ]);

    // Convert milliseconds to minutes
    const avgWaitMs = waitTimeData[0]?.avgWaitTime || 0;
    const avgWaitMins = Math.round(avgWaitMs / 60000);
    const averageWaitTime = avgWaitMins > 0 ? `${avgWaitMins} mins` : '-';

    const stats = {
      patientsToday,
      appointmentsCompleted,
      pendingAppointments,
      averageWaitTime
    };

    res.status(200).json({ 
      success: true, 
      data: stats 
    });
  } catch (error) {
    logger.error('Get doctor stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ===== RECEPTIONIST DASHBOARD =====
router.get('/receptionist/stats', authorize('receptionist'), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Today's appointments
    const todayAppointments = await Appointment.countDocuments({
      appointmentDate: {
        $gte: today,
        $lt: tomorrow
      }
    });

    // Check-ins today (appointments with status completed or in-progress)
    const checkInsToday = await Visit.countDocuments({
      visitDate: {
        $gte: today,
        $lt: tomorrow
      },
      status: { $ne: 'Pending' }
    });

    // Pending registrations (patients created but not fully processed)
    const pendingRegistrations = await Patient.countDocuments({
      status: 'pending'
    });

    // Cancelled appointments today
    const cancelledAppointments = await Appointment.countDocuments({
      status: 'cancelled',
      appointmentDate: {
        $gte: today,
        $lt: tomorrow
      }
    });

    const stats = {
      todayAppointments,
      checkInsToday,
      pendingRegistrations,
      cancelledAppointments
    };

    res.status(200).json({ 
      success: true, 
      data: stats 
    });
  } catch (error) {
    logger.error('Get receptionist stats error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

router.get('/receptionist/appointments', authorize('receptionist'), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const appointments = await Appointment.find({
      appointmentDate: {
        $gte: today,
        $lt: tomorrow
      }
    })
      .populate('patient', 'firstName lastName')
      .populate('doctor', 'firstName lastName')
      .sort({ appointmentTime: 1 })
      .lean();

    // Transform for frontend
    const formattedAppointments = appointments.map(apt => ({
      id: apt._id,
      patient: `${apt.patient?.firstName} ${apt.patient?.lastName}`,
      doctor: `Dr. ${apt.doctor?.firstName} ${apt.doctor?.lastName}`,
      time: apt.appointmentTime,
      status: apt.status.charAt(0).toUpperCase() + apt.status.slice(1)
    }));

    res.status(200).json({ 
      success: true, 
      data: formattedAppointments 
    });
  } catch (error) {
    logger.error('Get receptionist appointments error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

export default router;