import express from 'express';
import User from '../models/User.js';
import { protect, authorize } from '../middleware/auth.js';
import Visit from '../models/Visit.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Apply protect middleware to all routes in this file
router.use(protect);

const viewRoles = ['admin', 'doctor', 'nurse', 'receptionist'];
const manageRoles = ['admin'];

// Get all doctors & create a new doctor
router.route('/')
  .get(authorize(...viewRoles), async (req, res) => {
    const doctors = await User.find({ role: 'doctor' });
    res.status(200).json({ 
      success: true, 
      data: doctors 
    });
  })
  .post(authorize(...manageRoles), async (req, res) => {
    // Add role to the request body to ensure it's set correctly
    const doctorData = { ...req.body, role: 'doctor' };
    const doctor = await User.create(doctorData);
    res.status(201).json({ 
      success: true, 
      data: doctor 
    });
  });

// Search for doctors
router.get('/search', authorize(...viewRoles), async (req, res) => {
  // Assuming a search implementation exists
  const doctors = await User.find({ role: 'doctor' });
  res.status(200).json({ 
    success: true, 
    data: doctors 
  });
});

// @desc    Get the queue for the logged-in doctor
// @route   GET /api/doctors/my-queue
// @access  Private (Doctor only)
router.get('/my-queue', protect, authorize('doctor'), async (req, res) => {
  try {
    const queue = await Visit.find({ doctor: req.user.id, status: { $in: ['In Queue', 'In-Progress'] } })
      .populate('patient', 'firstName lastName')
      .populate('doctor', 'firstName lastName')
      .sort({ visitDate: 1 });
        
    res.status(200).json({ 
      status: 'success', 
      data: queue 
    });
  } catch (error) {
    logger.error('Get doctor queue error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Start a visit (move from "In Queue" to "In-Progress")
// @route   PATCH /api/doctors/visits/:visitId/start
// @access  Private (Doctor only)
router.patch('/visits/:visitId/start', authorize('doctor'), async (req, res) => {
    try {
        const { visitId } = req.params;
        const doctorId = req.user.id;

        // Find the visit and verify it belongs to this doctor and is in queue
        const visit = await Visit.findOne({
            _id: visitId,
            doctor: doctorId,
            status: 'In Queue'
        });

        if (!visit) {
            return res.status(404).json({
                status: 'error',
                message: 'Visit not found in your queue or already started'
            });
        }

        // Update the visit status
        const updatedVisit = await Visit.findByIdAndUpdate(
            visitId,
            {
                status: 'In-Progress',
                startTime: new Date()
            },
            { new: true }
        ).populate('patient', 'firstName lastName');

        logger.info(`Doctor ${doctorId} started visit ${visitId}`);

        res.status(200).json({
            status: 'success',
            message: 'Visit started successfully',
            data: updatedVisit
        });

    } catch (error) {
        logger.error('Start visit error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to start visit',
            error: error.message
        });
    }
});

// Get, update, or delete a specific doctor
router.route('/:id')
  .get(authorize(...viewRoles), async (req, res) => {
    const doctor = await User.findOne({ _id: req.params.id, role: 'doctor' });
    if (!doctor) {
      return res.status(404).json({ 
        success: false, 
        error: 'Doctor not found' 
      });
    }
    res.status(200).json({ 
      success: true, 
      data: doctor 
    });
  })
  .put(authorize(...manageRoles), async (req, res) => {
    const doctor = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!doctor) {
      return res.status(404).json({ 
        success: false, 
        error: 'Doctor not found' 
      });
    }
    res.status(200).json({ 
      success: true, 
      data: doctor 
    });
  })
  .delete(authorize(...manageRoles), async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({ 
      success: true, 
      data: {} 
    });
  });

// Doctor specific routes
router.get('/:id/schedule', authorize(...viewRoles), async (req, res) => {
  res.status(200).json({ 
    success: true, 
    data: { schedule: [] } 
  });
});

router.get('/:id/appointments', authorize(...viewRoles), async (req, res) => {
  res.status(200).json({ 
    success: true, 
    data: { appointments: [] } 
  });
});

export default router;