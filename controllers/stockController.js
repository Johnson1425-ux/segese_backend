import StockItem from '../models/StockItem.js';
import { Medicine } from '../models/Medicine.js';
import { StockMovement } from '../models/StockMovement.js';
import { MedicineBatch }  from '../models/MedicineBatch.js';
import logger from '../utils/logger.js';

// @desc    Get all medicines (master catalog)
// @route   GET /api/stock
// @access  Private
export const getStockItems = async (req, res) => {
  try {
    const medicines = await Medicine.find().sort('name');
    res.status(200).json({ 
      success: true, 
      count: medicines.length, 
      data: medicines 
    });
  } catch (error) {
    logger.error('Get stock items error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get current stock balance with aggregated quantities
// @route   GET /api/stock/balance
// @access  Private
export const getStockBalance = async (req, res) => {
  try {
    const stockBalance = await MedicineBatch.aggregate([
      {
        $match: {
          status: 'active',
          expiryDate: { $gt: new Date() }
        }
      },
      {
        $group: {
          _id: '$medicine',
          totalQuantity: { $sum: '$quantityRemaining' },
          batches: { $push: '$$ROOT' },
          nearestExpiry: { $min: '$expiryDate' },
          oldestBatch: { $first: '$$ROOT' }
        }
      },
      {
        $lookup: {
          from: 'medicines',
          localField: '_id',
          foreignField: '_id',
          as: 'medicineInfo'
        }
      },
      {
        $unwind: '$medicineInfo'
      },
      {
        $project: {
          _id: '$_id',
          medicine: '$medicineInfo',
          quantity: '$totalQuantity',
          totalQuantity: 1,
          nearestExpiry: 1,
          isLowStock: { 
            $lt: ['$totalQuantity', '$medicineInfo.reorderLevel'] 
          },
          batchCount: { $size: '$batches' },
          reorderLevel: '$medicineInfo.reorderLevel'
        }
      },
      {
        $sort: { 'medicine.name': 1 }
      }
    ]);

    res.status(200).json({ 
      success: true, 
      count: stockBalance.length, 
      data: stockBalance 
    });
  } catch (error) {
    logger.error('Get stock balance error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get stock for taking/audit
// @route   GET /api/stock/taking
// @access  Private
export const getStockTaking = async (req, res) => {
  try {
    const stockBalance = await MedicineBatch.aggregate([
      {
        $match: {
          status: 'active',
          expiryDate: { $gt: new Date() }
        }
      },
      {
        $group: {
          _id: '$medicine',
          quantity: { $sum: '$quantityRemaining' },
          batches: { 
            $push: {
              batchId: '$_id',
              batchNumber: '$batchNumber',
              quantity: '$quantityRemaining',
              expiry: '$expiryDate'
            }
          }
        }
      },
      {
        $lookup: {
          from: 'medicines',
          localField: '_id',
          foreignField: '_id',
          as: 'medicine'
        }
      },
      {
        $unwind: '$medicine'
      },
      {
        $project: {
          medicine: 1,
          quantity: 1,
          batches: 1
        }
      },
      {
        $sort: { 'medicine.name': 1 }
      }
    ]);

    res.status(200).json({ 
      success: true, 
      count: stockBalance.length, 
      data: stockBalance 
    });
  } catch (error) {
    logger.error('Get stock taking error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Update stock after audit (stock taking)
// @route   PUT /api/stock/audit/:medicineId
// @access  Private
export const updateStockAudit = async (req, res) => {
  try {
    const { medicineId } = req.params;
    const { actualCount } = req.body;

    // Get current total
    const batches = await MedicineBatch.find({
      medicine: medicineId,
      status: 'active',
      expiryDate: { $gt: new Date() }
    }).sort('expiryDate');

    const currentTotal = batches.reduce((sum, b) => sum + b.quantityRemaining, 0);
    const difference = actualCount - currentTotal;

    if (difference !== 0) {
      // Adjust the oldest batch
      if (batches.length > 0) {
        const oldestBatch = batches[0];
        oldestBatch.quantityRemaining += difference;
        
        if (oldestBatch.quantityRemaining <= 0) {
          oldestBatch.status = 'depleted';
          oldestBatch.quantityRemaining = 0;
        }
        
        await oldestBatch.save();

        // Record adjustment
        await StockMovement.create({
          medicine: medicineId,
          batch: oldestBatch._id,
          type: 'ADJUSTMENT',
          quantity: Math.abs(difference),
          reason: `Stock audit adjustment: ${difference > 0 ? 'Added' : 'Removed'} ${Math.abs(difference)} units`,
          performedBy: req.user.id
        });
      }
    }

    res.status(200).json({ 
      success: true, 
      message: 'Stock audit completed',
      data: { difference, actualCount }
    });
  } catch (error) {
    logger.error('Update stock audit error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Create a medicine
// @route   POST /api/stock
// @access  Private
export const createMedicine = async (req, res) => {
  try {
    const medicine = await Medicine.create(req.body);
    res.status(201).json({ 
      success: true, 
      data: medicine 
    });
  } catch (error) {
    logger.error('Create medicine error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Update a medicine
// @route   PUT /api/stock/:id
// @access  Private
export const updateMedicine = async (req, res) => {
  try {
    const medicine = await Medicine.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      {
        new: true,
        runValidators: true,
      }
    );
    
    if (!medicine) {
      return res.status(404).json({ 
        success: false, 
        message: 'Medicine not found' 
      });
    }
    
    res.status(200).json({ 
      success: true, 
      data: medicine 
    });
  } catch (error) {
    logger.error('Update medicine error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Delete a medicine
// @route   DELETE /api/stock/:id
// @access  Private
export const deleteMedicine = async (req, res) => {
  try {
    // Check if there are any batches
    const batchCount = await MedicineBatch.countDocuments({ 
      medicine: req.params.id 
    });
    
    if (batchCount > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot delete medicine with existing batches' 
      });
    }

    const medicine = await Medicine.findByIdAndDelete(req.params.id);
    
    if (!medicine) {
      return res.status(404).json({ 
        success: false, 
        message: 'Medicine not found' 
      });
    }
    
    res.status(200).json({ 
      success: true, 
      data: {} 
    });
  } catch (error) {
    logger.error('Delete medicine error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get stock movements (audit trail)
// @route   GET /api/stock/movements
// @access  Private
export const getStockMovements = async (req, res) => {
  try {
    const { medicineId, type, startDate, endDate } = req.query;
    
    let filter = {};
    
    if (medicineId) filter.medicine = medicineId;
    if (type) filter.type = type;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const movements = await StockMovement.find(filter)
      .populate('medicine', 'name type strength')
      .populate('batch', 'batchNumber')
      .populate('performedBy', 'firstName lastName')
      .populate('patient', 'firstName lastName')
      .sort('-createdAt')
      .limit(100);

    res.status(200).json({ 
      success: true, 
      count: movements.length, 
      data: movements 
    });
  } catch (error) {
    logger.error('Get stock movements error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};