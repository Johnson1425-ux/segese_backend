import express from 'express';
import { body, validationResult } from 'express-validator';
import Ward from '../models/Ward.js';
import Bed from '../models/Bed.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// @desc    Get all wards
// @route   GET /api/wards
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const startIndex = (page - 1) * limit;

    const query = { isActive: true };
    
    // Filter by type if provided
    if (req.query.type) {
      query.type = req.query.type;
    }
    
    // Filter by status if provided
    if (req.query.status) {
      query.status = req.query.status;
    }

    const total = await Ward.countDocuments(query);
    const wards = await Ward.find(query)
      .populate('headNurse', 'firstName lastName email')
      .skip(startIndex)
      .limit(limit)
      .sort({ floor: 1, wardNumber: 1 });

    res.status(200).json({
      status: 'success',
      count: wards.length,
      total,
      pagination: {
        page,
        limit,
        pages: Math.ceil(total / limit)
      },
      data: wards
    });
  } catch (error) {
    logger.error('Get wards error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get ward statistics
// @route   GET /api/wards/statistics
// @access  Private
router.get('/statistics', protect, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    const stats = await Ward.getStatistics();
    res.status(200).json({
      status: 'success',
      data: stats
    });
  } catch (error) {
    logger.error('Get ward statistics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get single ward
// @route   GET /api/wards/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const ward = await Ward.findById(req.params.id)
      .populate('headNurse', 'firstName lastName email phone');

    if (!ward) {
      return res.status(404).json({
        status: 'error',
        message: 'Ward not found'
      });
    }

    // Get beds in this ward
    const beds = await Bed.find({ ward: req.params.id, isActive: true })
      .populate('currentPatient', 'firstName lastName patientId')
      .populate('assignedNurse', 'firstName lastName');

    res.status(200).json({
      status: 'success',
      data: {
        ward,
        beds
      }
    });
  } catch (error) {
    logger.error('Get ward error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Create new ward
// @route   POST /api/wards
// @access  Private (Admin only)
router.post('/', protect, authorize('admin'), [
  body('name').trim().notEmpty().withMessage('Ward name is required'),
  body('wardNumber').trim().notEmpty().withMessage('Ward number is required'),
  body('type').isIn(['general', 'icu', 'ccu', 'nicu', 'pediatric', 'maternity', 'surgical', 'medical', 'orthopedic', 'emergency', 'isolation', 'private']).withMessage('Invalid ward type'),
  body('floor').isInt({ min: 0 }).withMessage('Floor must be a positive number'),
  body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
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

    // Check if ward number already exists
    const existingWard = await Ward.findOne({ wardNumber: req.body.wardNumber });
    if (existingWard) {
      return res.status(400).json({
        status: 'error',
        message: 'Ward number already exists'
      });
    }

    const ward = await Ward.create(req.body);

    res.status(201).json({
      status: 'success',
      message: 'Ward created successfully',
      data: ward
    });
  } catch (error) {
    logger.error('Create ward error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Update ward
// @route   PUT /api/wards/:id
// @access  Private (Admin only)
router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    let ward = await Ward.findById(req.params.id);

    if (!ward) {
      return res.status(404).json({
        status: 'error',
        message: 'Ward not found'
      });
    }

    // Check if ward number is being changed and if it's already taken
    if (req.body.wardNumber && req.body.wardNumber !== ward.wardNumber) {
      const existingWard = await Ward.findOne({ 
        wardNumber: req.body.wardNumber,
        _id: { $ne: req.params.id }
      });
      
      if (existingWard) {
        return res.status(400).json({
          status: 'error',
          message: 'Ward number is already taken'
        });
      }
    }

    ward = await Ward.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      status: 'success',
      data: ward
    });
  } catch (error) {
    logger.error('Update ward error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Delete ward
// @route   DELETE /api/wards/:id
// @access  Private (Admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const ward = await Ward.findById(req.params.id);

    if (!ward) {
      return res.status(404).json({
        status: 'error',
        message: 'Ward not found'
      });
    }

    // Check if ward has active beds
    const activeBeds = await Bed.countDocuments({ ward: req.params.id, isActive: true });
    if (activeBeds > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete ward with active beds. Please deactivate all beds first.'
      });
    }

    await ward.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'Ward deleted successfully'
    });
  } catch (error) {
    logger.error('Delete ward error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

export default router;