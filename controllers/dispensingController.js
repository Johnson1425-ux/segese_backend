import Dispensing from '../models/Dispensing.js';
import { StockMovement } from '../models/StockMovement.js';
import { Medicine } from '../models/Medicine.js';
import { MedicineBatch } from '../models/MedicineBatch.js';

// @desc    Get all dispensing records
// @route   GET /api/dispensing
// @access  Public
export const getDispensingRecords = async (req, res, next) => {
  try {
    const records = await Dispensing.find().populate('patient');
    res.status(200).json({ 
      success: true, 
      count: records.length, 
      data: records 
    });
  } catch (err) {
    res.status(400).json({ 
      success: false 
    });
  }
};

// @desc    Create a dispensing record
// @route   POST /api/dispensing
// @access  Private
export const createDispensingRecord = async (req, res, next) => {
  try {
    const { patient, medicine, quantity, issuedBy, prescription } = req.body;

    // Create the dispensing record
    const record = await Dispensing.create(req.body);

    // Find the medicine by name or ID
    let medicineDoc;
    if (medicine) {
      // Try to find by ID first (if it looks like an ObjectId)
      if (medicine.match(/^[0-9a-fA-F]{24}$/)) {
        medicineDoc = await Medicine.findById(medicine);
      } else {
        // Otherwise search by name
        medicineDoc = await Medicine.findOne({ 
          name: { $regex: new RegExp(`^${medicine}$`, 'i') } 
        });
      }
    }

    if (medicineDoc && quantity > 0) {
      const quantityToDispense = Math.abs(quantity);
      console.log(`Processing ${medicineDoc.name}: Need to dispense ${quantityToDispense} units`);
      
      // Get active batches for this medicine, sorted by expiry date (FIFO)
      const batches = await MedicineBatch.find({
        medicine: medicineDoc._id,
        status: 'active',
        quantityRemaining: { $gt: 0 },
        expiryDate: { $gt: new Date() }
      }).sort('expiryDate');

      if (batches.length === 0) {
        console.log(`Warning: No active batches found for ${medicineDoc.name}`);
        return res.status(201).json({ 
          success: true, 
          data: record,
          warning: `Dispensing record created but no stock was deducted (no active batches for ${medicineDoc.name})`
        });
      }

      let remainingToDispense = quantityToDispense;
      const stockMovements = [];

      // Deduct from batches (FIFO - First In, First Out)
      for (const batch of batches) {
        if (remainingToDispense <= 0) break;

        const deductFromThisBatch = Math.min(remainingToDispense, batch.quantityRemaining);
        
        batch.quantityRemaining -= deductFromThisBatch;
        
        if (batch.quantityRemaining <= 0) {
          batch.status = 'depleted';
          batch.quantityRemaining = 0;
        }
        
        await batch.save();
        
        console.log(`Updated batch ${batch.batchNumber}: Deducted ${deductFromThisBatch}, Remaining: ${batch.quantityRemaining}`);

        // Create stock movement for this batch
        const movement = await StockMovement.create({
          medicine: medicineDoc._id,
          batch: batch._id,
          type: 'OUT',
          quantity: deductFromThisBatch,
          reason: `Prescription dispensing${prescription ? ` (Rx: ${prescription})` : ''}`,
          patient: patient,
          performedBy: issuedBy || req.user?._id || req.user?.id,
        });

        stockMovements.push(movement);
        remainingToDispense -= deductFromThisBatch;
      }

      if (remainingToDispense > 0) {
        console.log(`Warning: Could not dispense full quantity for ${medicineDoc.name}. Short by ${remainingToDispense} units`);
        return res.status(201).json({ 
          success: true, 
          data: record,
          stockMovements: stockMovements.length,
          warning: `Partially dispensed: ${quantityToDispense - remainingToDispense} of ${quantityToDispense} units (insufficient stock)`
        });
      }

      res.status(201).json({ 
        success: true, 
        data: record,
        stockMovements: stockMovements.length,
        message: `Successfully dispensed ${quantityToDispense} units. Created ${stockMovements.length} stock movements`
      });
    } else {
      // Medicine not found or quantity is 0
      res.status(201).json({ 
        success: true, 
        data: record,
        warning: medicineDoc ? 'No quantity to dispense' : `Medicine not found: ${medicine}`
      });
    }
  } catch (err) {
    console.error('Error creating dispensing record:', err);
    res.status(400).json({ 
      success: false,
      error: err.message 
    });
  }
};