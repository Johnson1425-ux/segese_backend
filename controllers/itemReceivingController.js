import PurchaseOrder from '../models/PurchaseOrder.js';
import { Medicine } from '../models/Medicine.js';
import { MedicineBatch } from '../models/MedicineBatch.js';
import { StockMovement } from  '../models/StockMovement.js';
import logger from '../utils/logger.js';

// @desc    Get all purchase orders
// @route   GET /api/item-receiving/purchase-orders
// @access  Private
export const getPurchaseOrders = async (req, res) => {
  try {
    const purchaseOrders = await PurchaseOrder.find()
      .populate('receivedBy', 'firstName lastName')
      .sort('-createdAt');
    
    res.status(200).json({ 
      success: true, 
      count: purchaseOrders.length, 
      data: { purchaseOrders } 
    });
  } catch (error) {
    logger.error('Get purchase orders error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Create new purchase order
// @route   POST /api/item-receiving/purchase-orders
// @access  Private
export const addPurchaseOrder = async (req, res) => {
  try {
    const { number, date, supplier, supplierContact, supplierEmail, supplierPhone } = req.body;
    
    const purchaseOrder = await PurchaseOrder.create({
      poNumber: number,
      supplier: {
        name: supplier,
        contact: supplierContact,
        email: supplierEmail,
        phone: supplierPhone,
      },
      receivedBy: req.user.id,
      createdAt: date || new Date(),
    });

    res.status(201).json({ 
      success: true, 
      data: purchaseOrder 
    });
  } catch (error) {
    logger.error('Add purchase order error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Receive item into inventory
// @route   POST /api/item-receiving
// @access  Private
export const receiveItem = async (req, res) => {
  try {
    const {
      purchaseOrder: poNumber,
      medicine: medicineName,
      genericName,
      type,
      strength,
      expiry,
      qty,
      price,
      sellingPrice,
      batchNumber,
      manufacturer,
      category,
      receiveTo,
      description,
    } = req.body;

    // 1. Find purchase order
    const purchaseOrder = await PurchaseOrder.findOne({ poNumber });
    if (!purchaseOrder) {
      return res.status(404).json({ 
        success: false, 
        message: 'Purchase order not found' 
      });
    }

    // 2. Find or create medicine in master catalog
    let medicine = await Medicine.findOne({ 
      name: medicineName, 
      type, 
      strength: strength || '' 
    });

    if (!medicine) {
      const calculatedSellingPrice = sellingPrice || parseFloat(price) * 1.3;
      
      medicine = await Medicine.create({
        name: medicineName,
        genericName,
        type,
        strength,
        manufacturer,
        category: category || 'Other',
        sellingPrice: calculatedSellingPrice,
        reorderLevel: 10,
        description,
      });
    } else if (sellingPrice && sellingPrice !== medicine.sellingPrice) {
      // Update selling price if provided
      medicine.sellingPrice = sellingPrice;
      await medicine.save();
    }

    // 3. Create batch entry
    const batch = await MedicineBatch.create({
      medicine: medicine._id,
      purchaseOrder: purchaseOrder._id,
      batchNumber: batchNumber || `BATCH-${Date.now()}`,
      expiryDate: new Date(expiry),
      quantityReceived: parseInt(qty),
      quantityRemaining: parseInt(qty),
      buyingPrice: parseFloat(price),
      sellingPrice: sellingPrice || medicine.sellingPrice,
      location: receiveTo || 'MAIN STORE',
      receivedBy: req.user.id,
    });

    // 4. Create stock movement record
    await StockMovement.create({
      medicine: medicine._id,
      batch: batch._id,
      type: 'IN',
      quantity: parseInt(qty),
      reason: `Received from PO ${poNumber}`,
      purchaseOrder: purchaseOrder._id,
      performedBy: req.user.id,
    });

    // 5. Update purchase order total and status
    purchaseOrder.totalAmount += parseFloat(price) * parseInt(qty);
    
    // Check if we should mark as partial or completed
    const totalBatches = await MedicineBatch.countDocuments({ 
      purchaseOrder: purchaseOrder._id 
    });
    if (totalBatches > 0) {
      purchaseOrder.status = 'partial';
    }
    
    await purchaseOrder.save();

    // 6. Populate response
    const populatedBatch = await MedicineBatch.findById(batch._id)
      .populate('medicine')
      .populate('receivedBy', 'firstName lastName');

    res.status(201).json({ 
      success: true, 
      data: populatedBatch,
      message: `Successfully received ${qty} units of ${medicineName}` 
    });

  } catch (error) {
    logger.error('Receive item error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get current stock levels
// @route   GET /api/item-receiving/stock
// @access  Private
export const getStockLevels = async (req, res) => {
  try {
    const stockLevels = await MedicineBatch.aggregate([
      {
        $match: {
          status: 'active',
          expiryDate: { $gt: new Date() },
        }
      },
      {
        $group: {
          _id: '$medicine',
          totalQuantity: { $sum: '$quantityRemaining' },
          batches: { $push: '$$ROOT' },
          nearestExpiry: { $min: '$expiryDate' },
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
          medicine: '$medicineInfo',
          totalQuantity: 1,
          nearestExpiry: 1,
          isLowStock: { 
            $lt: ['$totalQuantity', '$medicineInfo.reorderLevel'] 
          },
          batchCount: { $size: '$batches' }
        }
      },
      {
        $sort: { 'medicine.name': 1 }
      }
    ]);

    res.status(200).json({ 
      success: true, 
      count: stockLevels.length,
      data: stockLevels 
    });

  } catch (error) {
    logger.error('Get stock levels error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get expiring medicines (within 3 months)
// @route   GET /api/item-receiving/expiring
// @access  Private
export const getExpiringMedicines = async (req, res) => {
  try {
    const threeMonthsFromNow = new Date();
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

    const expiringBatches = await MedicineBatch.find({
      status: 'active',
      quantityRemaining: { $gt: 0 },
      expiryDate: { 
        $gt: new Date(), 
        $lte: threeMonthsFromNow 
      }
    })
    .populate('medicine')
    .sort('expiryDate');

    res.status(200).json({ 
      success: true, 
      count: expiringBatches.length,
      data: expiringBatches 
    });

  } catch (error) {
    logger.error('Get expiring medicines error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Complete a purchase order
// @route   PUT /api/item-receiving/purchase-orders/:id/complete
// @access  Private
export const completePurchaseOrder = async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);
    
    if (!purchaseOrder) {
      return res.status(404).json({ 
        success: false, 
        message: 'Purchase order not found' 
      });
    }

    purchaseOrder.status = 'completed';
    purchaseOrder.completedAt = new Date();
    await purchaseOrder.save();

    res.status(200).json({ 
      success: true, 
      data: purchaseOrder 
    });

  } catch (error) {
    logger.error('Complete purchase order error:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};