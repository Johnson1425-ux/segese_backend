import Requisition from '../models/Requisition.js';
import { Medicine } from '../models/Medicine.js';
import { MedicineBatch } from '../models/MedicineBatch.js';
import { StockMovement } from '../models/StockMovement.js';
import logger from '../utils/logger.js';

// @desc    Get all requisitions
// @route   GET /api/requisitions
// @access  Private
export const getRequisitions = async (req, res) => {
  try {
    const { status, department } = req.query;
    
    let filter = {};
    if (status) filter.status = status;
    if (department) filter['requestedFor.department'] = department;

    const requisitions = await Requisition.find(filter)
      .populate('requestedBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .populate('issuedBy', 'firstName lastName')
      .populate('items.medicine', 'name type strength')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      count: requisitions.length,
      data: requisitions
    });
  } catch (error) {
    logger.error('Get requisitions error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single requisition
// @route   GET /api/requisitions/:id
// @access  Private
export const getRequisition = async (req, res) => {
  try {
    const requisition = await Requisition.findById(req.params.id)
      .populate('requestedBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName')
      .populate('issuedBy', 'firstName lastName')
      .populate('items.medicine');

    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    res.status(200).json({
      success: true,
      data: requisition
    });
  } catch (error) {
    logger.error('Get requisition error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Create new requisition
// @route   POST /api/requisitions
// @access  Private
export const createRequisition = async (req, res) => {
  try {
    const { department, items, priority, notes } = req.body;

    const requisitionNumber = await Requisition.generateRequisitionNumber();

    const requisition = await Requisition.create({
      requisitionNumber,
      requestedBy: req.user.id,
      requestedFor: {
        department,
        location: department
      },
      items: items.map(item => ({
        medicine: item.medicineId || item.medicine,
        requestedQty: item.qty || item.requestedQty,
        status: 'Pending'
      })),
      priority: priority || 'Normal',
      notes
    });

    const populatedRequisition = await Requisition.findById(requisition._id)
      .populate('requestedBy', 'firstName lastName')
      .populate('items.medicine', 'name type strength');

    res.status(201).json({
      success: true,
      data: populatedRequisition
    });
  } catch (error) {
    logger.error('Create requisition error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update requisition item status
// @route   PUT /api/requisitions/:id/items/:itemId
// @access  Private
export const updateRequisitionItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { status, issuedQty, remarks } = req.body;

    const requisition = await Requisition.findById(id);
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    const item = requisition.items.id(itemId);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Update item
    if (status) item.status = status;
    if (issuedQty !== undefined) item.issuedQty = issuedQty;
    if (remarks) item.remarks = remarks;

    // If issuing, deduct from stock
    if (status === 'Issued' && issuedQty > 0) {
      const batches = await MedicineBatch.find({
        medicine: item.medicine,
        status: 'active',
        quantityRemaining: { $gt: 0 },
        expiryDate: { $gt: new Date() }
      }).sort('expiryDate');

      let remainingQty = issuedQty;
      
      for (const batch of batches) {
        if (remainingQty <= 0) break;

        const qtyToIssue = Math.min(remainingQty, batch.quantityRemaining);
        
        batch.quantityRemaining -= qtyToIssue;
        if (batch.quantityRemaining === 0) {
          batch.status = 'depleted';
        }
        await batch.save();

        // Record movement
        await StockMovement.create({
          medicine: item.medicine,
          batch: batch._id,
          type: 'OUT',
          quantity: qtyToIssue,
          reason: `Issued via requisition ${requisition.requisitionNumber}`,
          performedBy: req.user.id
        });

        remainingQty -= qtyToIssue;
      }

      if (remainingQty > 0) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Only ${issuedQty - remainingQty} units available`
        });
      }

      requisition.issuedBy = req.user.id;
      requisition.issuedAt = new Date();
    }

    // Update overall status
    requisition.updateStatus();
    await requisition.save();

    const updatedRequisition = await Requisition.findById(id)
      .populate('items.medicine', 'name type strength');

    res.status(200).json({
      success: true,
      data: updatedRequisition
    });
  } catch (error) {
    logger.error('Update requisition item error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Complete/close requisition
// @route   PUT /api/requisitions/:id/complete
// @access  Private
export const completeRequisition = async (req, res) => {
  try {
    const requisition = await Requisition.findById(req.params.id);
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    requisition.status = 'Completed';
    requisition.issuedBy = req.user.id;
    requisition.issuedAt = new Date();
    
    await requisition.save();

    res.status(200).json({
      success: true,
      data: requisition
    });
  } catch (error) {
    logger.error('Complete requisition error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Cancel requisition
// @route   PUT /api/requisitions/:id/cancel
// @access  Private
export const cancelRequisition = async (req, res) => {
  try {
    const requisition = await Requisition.findById(req.params.id);
    
    if (!requisition) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    if (requisition.status === 'Completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed requisition'
      });
    }

    requisition.status = 'Cancelled';
    await requisition.save();

    res.status(200).json({
      success: true,
      data: requisition
    });
  } catch (error) {
    logger.error('Cancel requisition error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};