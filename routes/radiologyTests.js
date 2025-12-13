import express from 'express';
import Visit from '../models/Visit.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// @desc    Get all radiology orders (aggregated from all visits)
// @route   GET /api/radiology
// @access  Private (Admin, Radiologist, Doctor)
router.get('/', authorize('admin', 'radiologist', 'doctor', 'lab_technician'), async (req, res) => {
  try {
    const { status, patientId } = req.query;

    // Aggregate radiology orders from all active visits only
    const matchStage = { 
      'radiologyOrders.0': { $exists: true }, // Only visits with radiology orders
      isActive: true // Only active visits
    };
    
    const visits = await Visit.find(matchStage)
      .populate('patient', 'firstName lastName patientId')
      .populate('doctor', 'firstName lastName')
      .populate('radiologyOrders.orderedBy', 'firstName lastName')
      .populate('radiologyOrders.completedBy', 'firstName lastName')
      .sort({ createdAt: -1 }); // Sort visits by creation date

    // Flatten radiology orders with visit context
    const allRadiologyOrders = [];
    
    visits.forEach(visit => {
      if (visit.radiologyOrders && visit.radiologyOrders.length > 0) {
        visit.radiologyOrders.forEach(order => {
          // Apply filters
          if (status && order.status !== status) return;
          if (patientId && visit.patient._id.toString() !== patientId) return;
          
          // Skip orders that are pending payment
          if (order.status === 'Pending Payment') return;

          allRadiologyOrders.push({
            _id: order._id,
            scanType: order.scanType,
            bodyPart: order.bodyPart,
            reason: order.reason,
            status: order.status,
            findings: order.findings,
            imageUrl: order.imageUrl,
            createdAt: order.createdAt || order.orderedAt,
            completedAt: order.completedAt,
            patient: visit.patient,
            visit: {
              _id: visit._id,
              visitId: visit.visitId,
              visitDate: visit.visitDate
            },
            orderedBy: order.orderedBy,
            completedBy: order.completedBy,
            price: order.price
          });
        });
      }
    });

    // Sort by most recent
    allRadiologyOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      status: 'success',
      data: allRadiologyOrders,
      count: allRadiologyOrders.length
    });
  } catch (error) {
    logger.error('Get radiology orders error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Get single radiology order by ID
// @route   GET /api/radiology/:id
// @access  Private (Admin, Radiologist, Doctor)
router.get('/:id', authorize('admin', 'radiologist', 'doctor', 'lab_technician'), async (req, res) => {
  try {
    const { id } = req.params;

    // Find the visit containing this radiology order
    const visit = await Visit.findOne({ 'radiologyOrders._id': id })
      .populate('patient')
      .populate('doctor', 'firstName lastName')
      .populate('radiologyOrders.orderedBy', 'firstName lastName')
      .populate('radiologyOrders.completedBy', 'firstName lastName');

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Radiology order not found'
      });
    }

    const radiologyOrder = visit.radiologyOrders.id(id);

    if (!radiologyOrder) {
      return res.status(404).json({
        status: 'error',
        message: 'Radiology order not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        ...radiologyOrder.toObject(),
        patient: visit.patient,
        visit: {
          _id: visit._id,
          visitId: visit.visitId,
          visitDate: visit.visitDate
        }
      }
    });
  } catch (error) {
    logger.error('Get radiology order error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Update radiology order (add findings, complete)
// @route   PUT /api/radiology/:id
// @access  Private (Admin, Radiologist)
router.put('/:id', authorize('admin', 'radiologist', 'lab_technician'), async (req, res) => {
  try {
    const { id } = req.params;
    const { findings, imageUrl, status } = req.body;

    // Find the visit containing this radiology order
    const visit = await Visit.findOne({ 'radiologyOrders._id': id });

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Radiology order not found'
      });
    }

    const radiologyOrder = visit.radiologyOrders.id(id);

    if (!radiologyOrder) {
      return res.status(404).json({
        status: 'error',
        message: 'Radiology order not found'
      });
    }

    // Update the radiology order
    if (findings) radiologyOrder.findings = findings;
    if (imageUrl) radiologyOrder.imageUrl = imageUrl;
    if (status) radiologyOrder.status = status;
    
    if (status === 'Completed') {
      radiologyOrder.completedAt = new Date();
      radiologyOrder.completedBy = req.user.id;
    }

    await visit.save();

    logger.info(`Radiology order ${id} updated by ${req.user.firstName} ${req.user.lastName}`);

    res.status(200).json({
      status: 'success',
      message: 'Radiology order updated successfully',
      data: radiologyOrder
    });
  } catch (error) {
    logger.error('Update radiology order error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Update radiology order status
// @route   PATCH /api/radiology/:id/status
// @access  Private (Admin, Radiologist)
router.patch('/:id/status', authorize('admin', 'radiologist', 'lab_technician'), async (req, res) => {
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

    const visit = await Visit.findOne({ 'radiologyOrders._id': id });

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Radiology order not found'
      });
    }

    const radiologyOrder = visit.radiologyOrders.id(id);

    if (!radiologyOrder) {
      return res.status(404).json({
        status: 'error',
        message: 'Radiology order not found'
      });
    }

    radiologyOrder.status = status;
    
    if (status === 'Completed') {
      radiologyOrder.completedAt = new Date();
      radiologyOrder.completedBy = req.user.id;
    }
    
    await visit.save();

    res.status(200).json({
      status: 'success',
      message: 'Radiology order status updated',
      data: radiologyOrder
    });
  } catch (error) {
    logger.error('Update radiology order status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// @desc    Delete/Cancel radiology order
// @route   DELETE /api/radiology/:id
// @access  Private (Admin)
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const visit = await Visit.findOne({ 'radiologyOrders._id': id });

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Radiology order not found'
      });
    }

    // Remove the radiology order from the array
    visit.radiologyOrders.pull(id);
    await visit.save();

    logger.info(`Radiology order ${id} deleted by ${req.user.firstName} ${req.user.lastName}`);

    res.status(200).json({
      status: 'success',
      message: 'Radiology order deleted successfully'
    });
  } catch (error) {
    logger.error('Delete radiology order error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

export default router;