import express from 'express';
import { body, validationResult } from 'express-validator';
import Appointment from '../models/Appointment.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.use(protect);

const managementRoles = ['admin', 'receptionist', 'doctor'];
const viewAllRoles = ['admin', 'receptionist'];

// @desc    Get all appointments (or only doctor's own)
// @route   GET /api/appointments
// @access  Private (Admins/Receptionists see all, Doctors see their own)
router.get('/', async (req, res) => {
  try {
    let query = {};
    
    // Check user role and set appropriate query
    if (req.user.role === 'doctor') {
      // Doctors can only see their own appointments
      query.doctor = req.user.id;
    } else if (['admin', 'receptionist'].includes(req.user.role)) {
      // Admins and receptionists can see all appointments
      query = {};
    } else {
      // All other roles are not authorized
      return res.status(403).json({
        status: 'error',
        message: 'You are not authorized to view appointments'
      });
    }

    const appointmentsFromDb = await Appointment.find(query)
      .populate('patient', 'firstName lastName')
      .populate('doctor', 'firstName lastName')
      .lean();
      
    // Manually combine date and time for the frontend
    const appointments = appointmentsFromDb.map(appt => {
      return {
        ...appt,
        // Create a full, valid ISO date string for the frontend
        date: `${appt.appointmentDate}T${appt.appointmentTime}:00`
      };
    });
      
    res.status(200).json({
      status: 'success',
      data: appointments
    });
  } catch (error) {
    logger.error('Get appointments error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Get single appointment
// @route   GET /api/appointments/:id
// @access  Private (Admin/Receptionist/Doctor)
router.get('/:id', async (req, res) => {
  try {
    let query = { _id: req.params.id };
    
    // If user is a doctor, they can only see their own appointments
    if (req.user.role === 'doctor') {
      query.doctor = req.user.id;
    } else if (!['admin', 'receptionist'].includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        message: 'You are not authorized to view appointments'
      });
    }

    const appointment = await Appointment.findOne(query)
      .populate('patient', 'firstName lastName email phone')
      .populate('doctor', 'firstName lastName email')
      .lean();

    if (!appointment) {
      return res.status(404).json({
        status: 'error',
        message: 'Appointment not found'
      });
    }

    // Format the appointment data for frontend
    const formattedAppointment = {
      ...appointment,
      date: `${appointment.appointmentDate}T${appointment.appointmentTime}:00`
    };

    res.status(200).json({
      status: 'success',
      data: formattedAppointment
    });
  } catch (error) {
    logger.error('Get appointment error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Create a new appointment
// @route   POST /api/appointments
// @access  Private (Admin/Receptionist only)
router.post(
  '/',
  authorize('admin', 'receptionist'),
  async (req, res) => {
    try {
      const { patientId, doctorId, date, time, type, status, notes, duration } = req.body;

      // Data Transformation
      const durationInMinutes = parseInt(duration.split(' ')[0]);

      const appointmentDetails = {
        patient: patientId,
        doctor: doctorId,
        appointmentDate: date,
        appointmentTime: time,
        type: type.toLowerCase(),
        status: status.toLowerCase(),
        reason: notes, // Mapping notes from form to reason in model
        duration: durationInMinutes,
        createdBy: req.user.id
      };

      const appointment = await Appointment.create(appointmentDetails);
      
      res.status(201).json({
        status: 'success',
        data: appointment
      });
    } catch (error) {
      logger.error('Create appointment error:', error);
      // Send back the specific validation error message
      res.status(400).json({
        status: 'error',
        message: error.message
      });
    }
  }
);

// @desc    Update an appointment
// @route   PUT /api/appointments/:id
// @access  Private (Admin/Receptionist/Doctor)
router.put('/:id', authorize(...managementRoles), async (req, res) => {
  try {
    let appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        status: 'error',
        message: 'Appointment not found'
      });
    }

    // If user is a doctor, they can only update their own appointments
    if (req.user.role === 'doctor' && appointment.doctor.toString() !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'You can only update your own appointments'
      });
    }

    appointment = await Appointment.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      status: 'success',
      data: appointment
    });
  } catch (error) {
    logger.error('Update appointment error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Delete an appointment
// @route   DELETE /api/appointments/:id
// @access  Private (Admin/Receptionist only)
router.delete('/:id', authorize('admin', 'receptionist'), async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        status: 'error',
        message: 'Appointment not found'
      });
    }

    // Use deleteOne() instead of remove()
    await appointment.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'Appointment deleted successfully'
    });
  } catch (error) {
    logger.error('Delete appointment error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Update appointment status
// @route   PATCH /api/appointments/:id/status
// @access  Private (Admin/Receptionist/Doctor)
router.patch('/:id/status', authorize(...managementRoles), async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({
        status: 'error',
        message: 'Status is required'
      });
    }

    let appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        status: 'error',
        message: 'Appointment not found'
      });
    }

    // If user is a doctor, they can only update their own appointments
    if (req.user.role === 'doctor' && appointment.doctor.toString() !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'You can only update your own appointments'
      });
    }

    appointment.status = status.toLowerCase();
    await appointment.save();

    res.status(200).json({
      status: 'success',
      data: appointment,
      message: `Appointment status updated to ${status}`
    });
  } catch (error) {
    logger.error('Update appointment status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

export default router;