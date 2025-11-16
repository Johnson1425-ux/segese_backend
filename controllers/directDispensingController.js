import DirectDispensing from '../models/DirectDispensing.js';
import { StockMovement } from '../models/StockMovement.js';
import { Medicine } from '../models/Medicine.js';
import { MedicineBatch } from '../models/MedicineBatch.js';

// @desc    Get all direct dispensing records
// @route   GET /api/direct-dispensing
// @access  Public
export const getDirectDispensingRecords = async (req, res, next) => {
  try {
    const records = await DirectDispensing.find();
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

// @desc    Create a direct dispensing record
// @route   POST /api/direct-dispensing
// @access  Private
export const createDirectDispensingRecord = async (req, res, next) => {
  try {
    const { medicines, clientName, patient, totalCost, issuedBy } = req.body;

    // Create the direct dispensing record
    const record = await DirectDispensing.create(req.body);

    // Create stock movements and update batch quantities for each medicine dispensed
    if (medicines && Array.isArray(medicines)) {
      const stockMovements = [];

      for (const item of medicines) {
        // Find the medicine by ID or name
        let medicine;
        if (item.medicine) {
          medicine = await Medicine.findById(item.medicine);
        } else if (item.name) {
          medicine = await Medicine.findOne({ name: item.name });
        }

        if (medicine) {
          const quantityToDispense = Math.abs(item.quantity || item.qty || 1);
          console.log(`Processing ${medicine.name}: Need to dispense ${quantityToDispense} units`);
          
          // Get active batches for this medicine, sorted by expiry date (FIFO)
          const batches = await MedicineBatch.find({
            medicine: medicine._id,
            status: 'active',
            quantityRemaining: { $gt: 0 },
            expiryDate: { $gt: new Date() }
          }).sort('expiryDate');

          if (batches.length === 0) {
            console.log(`No active batches found for ${medicine.name}`);
            continue;
          }

          let remainingToDispense = quantityToDispense;
          const batchesUpdated = [];

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
            
            batchesUpdated.push({
              batchId: batch._id,
              deducted: deductFromThisBatch
            });

            remainingToDispense -= deductFromThisBatch;

            // Create stock movement for this batch
            const movement = await StockMovement.create({
              medicine: medicine._id,
              batch: batch._id,
              type: 'OUT',
              quantity: deductFromThisBatch,
              reason: `Direct dispensing to ${clientName || 'client'}`,
              patient: patient,
              performedBy: issuedBy || req.user?._id || req.user?.id,
            });

            stockMovements.push(movement);
          }

          if (remainingToDispense > 0) {
            console.log(`Warning: Could not dispense full quantity for ${medicine.name}. Short by ${remainingToDispense} units`);
          }
        } else {
          console.log(`Medicine not found for item: ${item.name || item.medicine}`);
        }
      }

      res.status(201).json({ 
        success: true, 
        data: record,
        stockMovements: stockMovements.length,
        message: `Successfully dispensed. Created ${stockMovements.length} stock movements`
      });
    } else {
      res.status(201).json({ 
        success: true, 
        data: record 
      });
    }
  } catch (err) {
    console.error('Error creating direct dispensing record:', err);
    res.status(400).json({ 
      success: false,
      error: err.message 
    });
  }
};