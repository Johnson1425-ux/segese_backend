import express from 'express';
import { body, validationResult } from 'express-validator';
import Bed from '../models/Bed.js';
import Ward from '../models/Ward.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// @desc    Get all beds
// @route   GET /api/beds
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const startIndex = (page - 1) * limit;

    const query = { isActive: true };
    
    // Filter by ward if provided
    if (req.query.ward) {
      query.ward = req.query.ward;
    }
    
    // Filter by status if provided
    if (req.query.status) {
      query.status = req.query.status;
    }

    const total = await Bed.countDocuments(query);
    const beds = await Bed.find(query)
      .populate('ward', 'name wardNumber type floor')
      .populate('currentPatient', 'firstName lastName patientId')
      .populate('assignedNurse', 'firstName lastName email')
      .skip(startIndex)
      .limit(limit)
      .sort({ ward: 1, bedNumber: 1 });

    res.status(200).json({
      status: 'success',
      count: beds.length,
      total,
      pagination: {
        page,
        limit,
        pages: Math.ceil(total / limit)
      },
      data: beds
    });
  } catch (error) {
    logger.error('Get beds error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get bed statistics
// @route   GET /api/beds/statistics
// @access  Private
router.get('/statistics', protect, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    const stats = await Bed.getStatistics();
    res.status(200).json({
      status: 'success',
      data: stats
    });
  } catch (error) {
    logger.error('Get bed statistics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get available beds in a ward
// @route   GET /api/beds/available/:wardId
// @access  Private
router.get('/available/:wardId', protect, async (req, res) => {
  try {
    const beds = await Bed.getAvailableBedsInWard(req.params.wardId);
    
    res.status(200).json({
      status: 'success',
      count: beds.length,
      data: beds
    });
  } catch (error) {
    logger.error('Get available beds error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get single bed
// @route   GET /api/beds/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const bed = await Bed.findById(req.params.id)
      .populate('ward', 'name wardNumber type floor')
      .populate('currentPatient', 'firstName lastName patientId email phone')
      .populate('assignedNurse', 'firstName lastName email phone');

    if (!bed) {
      return res.status(404).json({
        status: 'error',
        message: 'Bed not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: bed
    });
  } catch (error) {
    logger.error('Get bed error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Create new bed
// @route   POST /api/beds
// @access  Private (Admin, Nurse)
router.post('/', protect, authorize('admin', 'nurse'), [
  body('bedNumber').trim().notEmpty().withMessage('Bed number is required'),
  body('ward').notEmpty().withMessage('Ward is required'),
  body('type').optional().isIn(['standard', 'icu', 'isolation', 'private', 'semi-private', 'pediatric', 'maternity']).withMessage('Invalid bed type'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Check if ward exists
    const ward = await Ward.findById(req.body.ward);
    if (!ward) {
      return res.status(404).json({
        status: 'error',
        message: 'Ward not found'
      });
    }

    // Check if bed number already exists in this ward
    const existingBed = await Bed.findOne({ 
      bedNumber: req.body.bedNumber,
      ward: req.body.ward
    });
    
    if (existingBed) {
      return res.status(400).json({
        status: 'error',
        message: 'Bed number already exists in this ward'
      });
    }

    // Check if ward has reached capacity
    const bedsInWard = await Bed.countDocuments({ ward: req.body.ward, isActive: true });
    if (bedsInWard >= ward.capacity) {
      return res.status(400).json({
        status: 'error',
        message: 'Ward has reached maximum capacity'
      });
    }

    const bed = await Bed.create(req.body);

    res.status(201).json({
      status: 'success',
      message: 'Bed created successfully',
      data: bed
    });
  } catch (error) {
    logger.error('Create bed error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Update bed
// @route   PUT /api/beds/:id
// @access  Private (Admin, Nurse)
router.put('/:id', protect, authorize('admin', 'nurse'), async (req, res) => {
  try {
    let bed = await Bed.findById(req.params.id);

    if (!bed) {
      return res.status(404).json({
        status: 'error',
        message: 'Bed not found'
      });
    }

    // Check if bed number is being changed and if it's already taken
    if (req.body.bedNumber && req.body.bedNumber !== bed.bedNumber) {
      const existingBed = await Bed.findOne({ 
        bedNumber: req.body.bedNumber,
        ward: bed.ward,
        _id: { $ne: req.params.id }
      });
      
      if (existingBed) {
        return res.status(400).json({
          status: 'error',
          message: 'Bed number is already taken in this ward'
        });
      }
    }

    // If changing status to occupied, ensure currentPatient is set
    if (req.body.status === 'occupied' && !req.body.currentPatient && !bed.currentPatient) {
      return res.status(400).json({
        status: 'error',
        message: 'Patient must be assigned when marking bed as occupied'
      });
    }

    // Update ward occupancy if status changes
    const oldStatus = bed.status;
    bed = await Bed.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    // Update ward occupied beds count
    if (oldStatus !== bed.status) {
      const ward = await Ward.findById(bed.ward);
      if (ward) {
        if (bed.status === 'occupied' && oldStatus !== 'occupied') {
          ward.occupiedBeds += 1;
        } else if (bed.status !== 'occupied' && oldStatus === 'occupied') {
          ward.occupiedBeds = Math.max(0, ward.occupiedBeds - 1);
        }
        await ward.save();
      }
    }

    res.status(200).json({
      status: 'success',
      data: bed
    });
  } catch (error) {
    logger.error('Update bed error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Assign patient to bed
// @route   PUT /api/beds/:id/assign
// @access  Private (Admin, Nurse)
router.put('/:id/assign', protect, authorize('admin', 'nurse'), [
  body('patientId').notEmpty().withMessage('Patient ID is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const bed = await Bed.findById(req.params.id);

    if (!bed) {
      return res.status(404).json({
        status: 'error',
        message: 'Bed not found'
      });
    }

    if (bed.status === 'occupied') {
      return res.status(400).json({
        status: 'error',
        message: 'Bed is already occupied'
      });
    }

    // Update bed
    const oldStatus = bed.status;
    bed.currentPatient = req.body.patientId;
    bed.status = 'occupied';
    if (req.body.assignedNurse) {
      bed.assignedNurse = req.body.assignedNurse;
    }
    await bed.save();

    // Update ward occupancy
    if (oldStatus !== 'occupied') {
      const ward = await Ward.findById(bed.ward);
      if (ward) {
        ward.occupiedBeds += 1;
        await ward.save();
      }
    }

    const updatedBed = await Bed.findById(req.params.id)
      .populate('currentPatient', 'firstName lastName patientId')
      .populate('assignedNurse', 'firstName lastName');

    res.status(200).json({
      status: 'success',
      message: 'Patient assigned to bed successfully',
      data: updatedBed
    });
  } catch (error) {
    logger.error('Assign patient to bed error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Release bed (remove patient)
// @route   PUT /api/beds/:id/release
// @access  Private (Admin, Nurse)
router.put('/:id/release', protect, authorize('admin', 'nurse'), async (req, res) => {
  try {
    const bed = await Bed.findById(req.params.id);

    if (!bed) {
      return res.status(404).json({
        status: 'error',
        message: 'Bed not found'
      });
    }

    if (bed.status !== 'occupied') {
      return res.status(400).json({
        status: 'error',
        message: 'Bed is not occupied'
      });
    }

    // Update bed
    bed.currentPatient = null;
    bed.status = 'cleaning';
    bed.lastCleaned = new Date();
    await bed.save();

    // Update ward occupancy
    const ward = await Ward.findById(bed.ward);
    if (ward) {
      ward.occupiedBeds = Math.max(0, ward.occupiedBeds - 1);
      await ward.save();
    }

    res.status(200).json({
      status: 'success',
      message: 'Bed released successfully',
      data: bed
    });
  } catch (error) {
    logger.error('Release bed error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Mark bed as cleaned
// @route   PUT /api/beds/:id/cleaned
// @access  Private (Admin, Nurse)
router.put('/:id/cleaned', protect, authorize('admin', 'nurse'), async (req, res) => {
  try {
    const bed = await Bed.findById(req.params.id);

    if (!bed) {
      return res.status(404).json({
        status: 'error',
        message: 'Bed not found'
      });
    }

    bed.status = 'available';
    bed.lastCleaned = new Date();
    await bed.save();

    res.status(200).json({
      status: 'success',
      message: 'Bed marked as cleaned and available',
      data: bed
    });
  } catch (error) {
    logger.error('Mark bed as cleaned error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Delete bed
// @route   DELETE /api/beds/:id
// @access  Private (Admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const bed = await Bed.findById(req.params.id);

    if (!bed) {
      return res.status(404).json({
        status: 'error',
        message: 'Bed not found'
      });
    }

    if (bed.status === 'occupied') {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete an occupied bed'
      });
    }

    await bed.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'Bed deleted successfully'
    });
  } catch (error) {
    logger.error('Delete bed error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

export default router