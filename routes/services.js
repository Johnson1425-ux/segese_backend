import express from 'express';
import Service from '../models/Service.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Middleware to protect all routes in this file
router.use(protect);

// @desc    Get all active services
// @route   GET /api/services
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;

    const filter = { isActive: true };

    if (category) {
      filter.category = category;
    }

    const services = await Service
      .find(filter)
      .sort({ name: 1 });

    res.status(200).json({
      status: 'success',
      data: services
    });
  } catch (error) {
    logger.error('Get services error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Search for services by category and name
// @route   GET /api/services/search
// @access  Private
router.get('/search', async (req, res) => {
  try {
    const { category, name } = req.query;

    if (!category || !name) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Category and name query parameters are required.' 
      });
    }

    // Using regex for a case-insensitive search to find matches
    const services = await Service.find({
      category: category,
      name: { $regex: name, $options: 'i' },
      isActive: true
    }).limit(10); // Limit to 10 results for performance

    res.status(200).json({
      status: 'success', 
      data: services 
    });
  } catch (error) {
    logger.error('Search services error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Create a new service
// @route   POST /api/services
// @access  Private (Admin only)
router.post('/', authorize('admin'), async (req, res) => {
  try {
    const service = new Service(req.body);
    await service.save();
    res.status(201).json({
      status: 'success',
      data: service,
    });
  } catch (error) {
    logger.error('Create service error:', error);
    res.status(400).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// @desc    Get a single service by ID
// @route   GET /api/services/:id
// @access  Private (Admin only)
router.get('/:id', authorize('admin'), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Service not found' 
      });
    }
    res.status(200).json({ 
      status: 'success', 
      data: service 
    });
  } catch (error) {
    logger.error('Get service by ID error:', error);
    res.status(500).json({ status: 'error', message: 'Server Error' });
  }
});

// @desc    Update a service
// @route   PUT /api/services/:id
// @access  Private (Admin only)
router.put('/:id', authorize('admin'), async (req, res) => {
  try {
    const service = await Service.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!service) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Service not found' 
      });
    }
    res.status(200).json({ 
      status: 'success', 
      data: service 
    });
  } catch (error) {
    logger.error('Update service error:', error);
    res.status(400).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// @desc    Delete a service (soft delete by setting isActive to false)
// @route   DELETE /api/services/:id
// @access  Private (Admin only)
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const service = await Service.findByIdAndUpdate(req.params.id, 
      { isActive: false }, 
      { new: true }
    );
    if (!service) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Service not found'
     });
    }
    res.status(200).json({ 
      status: 'success', 
      message: 'Service deactivated successfully'
    });
  } catch (error) {
    logger.error('Delete service error:', error);
    res.status(500).json({ status: 'error', message: 'Server Error' });
  }
});

export default router;