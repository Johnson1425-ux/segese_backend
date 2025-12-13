import express from 'express';
import Visit from '../models/Visit.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// @desc    Get all lab test orders (aggregated from all visits)
// @route   GET /api/lab-tests
// @access  Private (Admin, Lab Technician, Doctor)
router.get('/', authorize('admin', 'lab_technician', 'doctor'), async (req, res) => {
  try {
    const { status, patientId } = req.query;

    // Aggregate lab orders from all active visits only
    const matchStage = { 
      'labOrders.0': { $exists: true }, // Only visits with lab orders
      isActive: true // Only active visits
    };
    
    const visits = await Visit.find(matchStage)
      .populate('patient', 'firstName lastName patientId')
      .populate('doctor', 'firstName lastName')
      .populate('labOrders.orderedBy', 'firstName lastName')
      .sort({ createdAt: -1 }); // Sort visits by creation date

    // Flatten lab orders with visit context
    const allLabTests = [];
    
    visits.forEach(visit => {
      if (visit.labOrders && visit.labOrders.length > 0) {
        visit.labOrders.forEach(order => {
          // Apply filters
          if (status && order.status !== status) return;
          if (patientId && visit.patient._id.toString() !== patientId) return;
          
          // Skip orders that are pending payment
          if (order.status === 'Pending Payment') return;

          allLabTests.push({
            _id: order._id,
            testName: order.testName,
            notes: order.notes,
            status: order.status,
            results: order.results,
            createdAt: order.createdAt || order.orderedAt, // Use createdAt from timestamps
            completedAt: order.completedAt,
            patient: visit.patient,
            visit: {
              _id: visit._id,
              visitId: visit.visitId,
              visitDate: visit.visitDate
            },
            orderedBy: order.orderedBy,
            price: order.price
          });
        });
      }
    });

    // Sort by most recent
    allLabTests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      status: 'success',
      data: allLabTests,
      count: allLabTests.length
    });
  } catch (error) {
    logger.error('Get lab tests error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Get single lab test by ID
// @route   GET /api/lab-tests/:id
// @access  Private (Admin, Lab Technician, Doctor)
router.get('/:id', authorize('admin', 'lab_technician', 'doctor'), async (req, res) => {
  try {
    const { id } = req.params;

    // Find the visit containing this lab order
    const visit = await Visit.findOne({ 'labOrders._id': id })
      .populate('patient')
      .populate('doctor', 'firstName lastName')
      .populate('labOrders.orderedBy', 'firstName lastName');

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Lab test not found'
      });
    }

    const labOrder = visit.labOrders.id(id);

    if (!labOrder) {
      return res.status(404).json({
        status: 'error',
        message: 'Lab test not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        ...labOrder.toObject(),
        patient: visit.patient,
        visit: {
          _id: visit._id,
          visitId: visit.visitId,
          visitDate: visit.visitDate
        }
      }
    });
  } catch (error) {
    logger.error('Get lab test error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Update lab test results
// @route   PATCH /api/lab-tests/:id/results
// @access  Private (Admin, Lab Technician)
router.patch('/:id/results', authorize('admin', 'lab_technician'), async (req, res) => {
  try {
    const { id } = req.params;
    const { results, notes } = req.body;

    if (!results) {
      return res.status(400).json({
        status: 'error',
        message: 'Results are required'
      });
    }

    // Find the visit containing this lab order
    const visit = await Visit.findOne({ 'labOrders._id': id });

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Lab test not found'
      });
    }

    const labOrder = visit.labOrders.id(id);

    if (!labOrder) {
      return res.status(404).json({
        status: 'error',
        message: 'Lab test not found'
      });
    }

    // Update the lab order
    labOrder.results = results;
    if (notes) labOrder.notes = notes;
    labOrder.status = 'Completed';
    labOrder.completedAt = new Date();
    labOrder.completedBy = req.user.id;

    await visit.save();

    logger.info(`Lab test ${id} completed by ${req.user.firstName} ${req.user.lastName}`);

    res.status(200).json({
      status: 'success',
      message: 'Lab test results saved successfully',
      data: labOrder
    });
  } catch (error) {
    logger.error('Update lab test results error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Update lab test status
// @route   PATCH /api/lab-tests/:id/status
// @access  Private (Admin, Lab Technician)
router.patch('/:id/status', authorize('admin', 'lab_technician'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const visit = await Visit.findOne({ 'labOrders._id': id });

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Lab test not found'
      });
    }

    const labOrder = visit.labOrders.id(id);

    if (!labOrder) {
      return res.status(404).json({
        status: 'error',
        message: 'Lab test not found'
      });
    }

    labOrder.status = status;
    await visit.save();

    res.status(200).json({
      status: 'success',
      message: 'Lab test status updated',
      data: labOrder
    });
  } catch (error) {
    logger.error('Update lab test status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Delete/Cancel lab test
// @route   DELETE /api/lab-tests/:id
// @access  Private (Admin)
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const visit = await Visit.findOne({ 'labOrders._id': id });

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Lab test not found'
      });
    }

    // Remove the lab order from the array
    visit.labOrders.pull(id);
    await visit.save();

    logger.info(`Lab test ${id} deleted by ${req.user.firstName} ${req.user.lastName}`);

    res.status(200).json({
      status: 'success',
      message: 'Lab test deleted successfully'
    });
  } catch (error) {
    logger.error('Delete lab test error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

export default router;