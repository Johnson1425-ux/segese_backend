import express from 'express';
import { body, validationResult } from 'express-validator';
import Theatre from '../models/Theatre.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// @desc    Get all theatres
// @route   GET /api/theatres
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

    const total = await Theatre.countDocuments(query);
    const theatres = await Theatre.find(query)
      .populate('name', 'floor')
      .skip(startIndex)
      .limit(limit)
      .sort({ floor: 1 });

    res.status(200).json({
      status: 'success',
      count: theatres.length,
      total,
      pagination: {
        page,
        limit,
        pages: Math.ceil(total / limit)
      },
      data: theatres
    });
  } catch (error) {
    logger.error('Get theatres error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get ward statistics
// @route   GET /api/wards/statistics
// @access  Private
router.get('/statistics', protect, authorize('admin'), async (req, res) => {
  try {
    const stats = await Theatre.getStatistics();
    res.status(200).json({
      status: 'success',
      data: stats
    });
  } catch (error) {
    logger.error('Get theatre statistics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get single theatre
// @route   GET /api/theatres/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const theatre = await Theatre.findById(req.params.id)
      .populate('name', 'floor');

    if (!theatre) {
      return res.status(404).json({
        status: 'error',
        message: 'Theatre not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: theatre
    });
  } catch (error) {
    logger.error('Get theatre error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Create new theatre
// @route   POST /api/theatres
// @access  Private (Admin only)
router.post('/', protect, authorize('admin'), [
  body('name').trim().notEmpty().withMessage('Ward name is required'),
//   body('wardNumber').trim().notEmpty().withMessage('Ward number is required'),
  body('type').isIn(['general', 'icu', 'ccu', 'nicu', 'pediatric', 'maternity', 'surgical', 'medical', 'orthopedic', 'emergency', 'isolation', 'private']).withMessage('Invalid ward type'),
  body('floor').isInt({ min: 0 }).withMessage('Floor must be a positive number'),
//   body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
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
    const existingTheatre = await Theatre.findOne({ theatreNumber: req.body.theatreNumber });
    if (existingTheatre) {
      return res.status(400).json({
        status: 'error',
        message: 'Theatre number already exists'
      });
    }

    const theatre = await Theatre.create(req.body);

    res.status(201).json({
      status: 'success',
      message: 'Theatre created successfully',
      data: theatre
    });
  } catch (error) {
    logger.error('Create theatre error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Update theatre
// @route   PUT /api/theatres/:id
// @access  Private (Admin only)
router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    let theatre = await Theatre.findById(req.params.id);

    if (!theatre) {
      return res.status(404).json({
        status: 'error',
        message: 'Theatre not found'
      });
    }

    // Check if ward number is being changed and if it's already taken
    if (req.body.theatreNumber && req.body.theatreNumber !== theatre.theatreNumber) {
      const existingTheatre = await Theatre.findOne({ 
        theatreNumber: req.body.theatreNumber,
        _id: { $ne: req.params.id }
      });
      
      if (existingTheatre) {
        return res.status(400).json({
          status: 'error',
          message: 'Theatre number is already taken'
        });
      }
    }

    theatre = await Theatre.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      status: 'success',
      data: theatre
    });
  } catch (error) {
    logger.error('Update theatre error:', error);
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
    const theatre = await Theatre.findById(req.params.id);

    if (!theatre) {
      return res.status(404).json({
        status: 'error',
        message: 'Theatre not found'
      });
    }

    await theatre.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'Theatre deleted successfully'
    });
  } catch (error) {
    logger.error('Delete theatre error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

export default router;