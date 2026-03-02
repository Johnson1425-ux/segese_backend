import Dispensing from '../models/Dispensing.js';
import Visit from '../models/Visit.js';
import { StockMovement } from '../models/StockMovement.js';
import { Medicine } from '../models/Medicine.js';
import { MedicineBatch } from '../models/MedicineBatch.js';
import IPDRecord from '../models/IPDRecord.js';
import Invoice from '../models/Invoice.js';
import logger from '../utils/logger.js';

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

// @desc    Get pending prescriptions for dispensing
// @route   GET /api/dispensing/prescriptions
// @access  Private (Pharmacist, Admin)
export const getPendingPrescriptions = async (req, res) => {
  try {
    const { status, patientId } = req.query;

    const matchStage = { 
      'prescriptions.0': { $exists: true },
      isActive: true
    };
    
    const visits = await Visit.find(matchStage)
      .populate('patient', 'firstName lastName patientId')
      .populate('doctor', 'firstName lastName')
      .populate('prescriptions.prescribedBy', 'firstName lastName')
      .populate('prescriptions.dispensedBy', 'firstName lastName')
      .populate('prescriptions.markedUnavailableBy', 'firstName lastName')
      .populate('prescriptions.returnedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    const allPrescriptions = [];
    
    visits.forEach(visit => {
      if (visit.prescriptions && visit.prescriptions.length > 0) {
        visit.prescriptions.forEach(prescription => {
          if (patientId && visit.patient._id.toString() !== patientId) return;
          if (prescription.status === 'Pending Payment') return;
          if (!prescription.isActive && prescription.status !== 'Dispensed') return;

          allPrescriptions.push({
            _id: prescription._id,
            medication: prescription.medication,
            dosage: prescription.dosage,
            frequency: prescription.frequency,
            duration: prescription.duration,
            notes: prescription.notes,
            status: prescription.status,
            isActive: prescription.isActive,
            createdAt: prescription.createdAt,
            
            // Dispensing info
            dispensedBy: prescription.dispensedBy,
            dispensedAt: prescription.dispensedAt,
            dispensingNotes: prescription.dispensingNotes,
            
            // Unavailable info
            unavailableReason: prescription.unavailableReason,
            markedUnavailableBy: prescription.markedUnavailableBy,
            markedUnavailableAt: prescription.markedUnavailableAt,
            
            // Return to doctor info
            returnedToDoctor: prescription.returnedToDoctor,
            returnToDoctorReason: prescription.returnToDoctorReason,
            returnedBy: prescription.returnedBy,
            returnedAt: prescription.returnedAt,
            
            patient: visit.patient,
            visit: {
              _id: visit._id,
              visitId: visit.visitId,
              visitDate: visit.visitDate
            },
            prescribedBy: prescription.prescribedBy
          });
        });
      }
    });

    allPrescriptions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      count: allPrescriptions.length,
      data: allPrescriptions
    });
  } catch (error) {
    logger.error('Get pending prescriptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// @desc    Dispense a prescription WITH AUTOMATIC IPD BILLING
// @route   POST /api/dispensing/dispense
// @access  Private (Pharmacist, Admin)
export const dispensePrescription = async (req, res) => {
  try {
    const { prescriptionId, notes, quantity } = req.body;

    // Find the visit containing this prescription
    const visit = await Visit.findOne({ 'prescriptions._id': prescriptionId })
      .populate('patient', 'firstName lastName patientId')
      .populate('prescriptions.prescribedBy', 'firstName lastName')
      .populate('prescriptions.dispensedBy', 'firstName lastName');

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    const prescription = visit.prescriptions.id(prescriptionId);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    // Check if already dispensed
    if (prescription.status === 'Dispensed') {
      return res.status(400).json({
        success: false,
        message: 'Prescription has already been dispensed'
      });
    }

    // Check payment status
    if (prescription.status === 'Pending Payment') {
      return res.status(400).json({
        success: false,
        message: 'Payment required before dispensing'
      });
    }

    // Create dispensing record for inventory tracking
    const dispensingRecord = await Dispensing.create({
      patient: visit.patient._id,
      medicine: prescription.medication,
      quantity: quantity || 1,
      issuedBy: req.user._id,
      prescription: prescriptionId,
      dispensedDate: new Date()
    });

    // Handle stock deduction
    let stockWarning = null;
    const medicineDoc = await Medicine.findOne({ 
      name: { $regex: new RegExp(`^${prescription.medication}$`, 'i') } 
    });

    let batchesUsed = [];
    let medicinePrice = 0;

    if (medicineDoc && quantity > 0) {
      const quantityToDispense = Math.abs(quantity);
      
      // Get medicine price (from prices.Pharmacy or sellingPrice)
      medicinePrice = medicineDoc.prices?.Pharmacy || medicineDoc.sellingPrice || 0;
      
      // Get active batches for this medicine, sorted by expiry date (FIFO)
      const batches = await MedicineBatch.find({
        medicine: medicineDoc._id,
        status: 'active',
        quantityRemaining: { $gt: 0 },
        expiryDate: { $gt: new Date() }
      }).sort('expiryDate');

      if (batches.length === 0) {
        stockWarning = `No active batches found for ${medicineDoc.name}`;
      } else {
        let remainingToDispense = quantityToDispense;

        // Deduct from batches (FIFO)
        for (const batch of batches) {
          if (remainingToDispense <= 0) break;

          const deductFromThisBatch = Math.min(remainingToDispense, batch.quantityRemaining);
          
          batch.quantityRemaining -= deductFromThisBatch;
          
          if (batch.quantityRemaining <= 0) {
            batch.status = 'depleted';
            batch.quantityRemaining = 0;
          }
          
          await batch.save();

          // Create stock movement
          await StockMovement.create({
            medicine: medicineDoc._id,
            batch: batch._id,
            type: 'OUT',
            quantity: deductFromThisBatch,
            reason: `Prescription dispensing (Rx: ${prescriptionId})`,
            patient: visit.patient._id,
            performedBy: req.user._id,
          });

          batchesUsed.push({
            batchNumber: batch.batchNumber,
            quantity: deductFromThisBatch
          });
          remainingToDispense -= deductFromThisBatch;
        }

        if (remainingToDispense > 0) {
          stockWarning = `Partially dispensed: ${quantityToDispense - remainingToDispense} of ${quantityToDispense} units (insufficient stock)`;
        }
      }
    }

    // === NEW: CHECK IF PATIENT IS IN IPD AND ADD CHARGE TO INVOICE ===
    let ipdBillingInfo = null;
    
    const ipdRecord = await IPDRecord.findOne({
      patient: visit.patient._id,
      status: { $in: ['admitted', 'under_observation', 'critical', 'stable'] }
    }).populate('billing.invoice');

    if (ipdRecord && ipdRecord.billing && ipdRecord.billing.invoice) {
      // Patient is in IPD - add medication charge to their invoice
      try {
        const invoice = await Invoice.findById(ipdRecord.billing.invoice);
        
        if (invoice) {
          const totalPrice = quantity * medicinePrice;
          const batchInfo = batchesUsed.length > 0 
            ? `Batches: ${batchesUsed.map(b => `${b.batchNumber} (${b.quantity})`).join(', ')}`
            : '';

          // Add medication as line item to invoice
          invoice.items.push({
            type: 'medication',
            description: `${prescription.medication} - ${quantity} units`,
            quantity: quantity,
            unitPrice: medicinePrice,
            discount: 0,
            tax: 0,
            total: totalPrice,
            paid: false,
            notes: `Dispensed by ${req.user.firstName} ${req.user.lastName}. ${batchInfo}`
          });

          // Recalculate invoice totals
          invoice.calculateTotals();
          await invoice.save();

          // Update IPD billing summary
          ipdRecord.billing.totalAmount = invoice.totalAmount;
          ipdRecord.billing.balance = invoice.balanceDue;
          await ipdRecord.save();

          ipdBillingInfo = {
            addedToInvoice: true,
            invoiceNumber: invoice.invoiceNumber,
            chargeAmount: totalPrice,
            newBalance: invoice.balanceDue
          };

          logger.info(
            `Medication charge added to IPD invoice ${invoice.invoiceNumber}: ` +
            `${prescription.medication} x ${quantity} = ${totalPrice}. ` +
            `Admission: ${ipdRecord.admissionNumber}`
          );
        }
      } catch (ipdError) {
        logger.error('IPD billing error during dispensing:', ipdError);
        // Don't fail the dispensing if billing fails - just log it
        ipdBillingInfo = {
          addedToInvoice: false,
          error: 'Failed to add charge to IPD invoice'
        };
      }
    }

    // Update prescription status
    prescription.status = 'Dispensed';
    prescription.dispensedBy = req.user._id;
    prescription.dispensedAt = new Date();
    prescription.dispensingNotes = notes || '';
    prescription.isActive = false;

    await visit.save();

    // Populate references
    await visit.populate([
      { path: 'prescriptions.dispensedBy', select: 'firstName lastName' },
      { path: 'prescriptions.prescribedBy', select: 'firstName lastName' }
    ]);

    const updatedPrescription = visit.prescriptions.id(prescriptionId);

    const response = {
      success: true,
      message: ipdBillingInfo?.addedToInvoice 
        ? 'Prescription dispensed successfully and charged to IPD invoice'
        : 'Prescription dispensed successfully',
      data: updatedPrescription,
      dispensingRecord: {
        _id: dispensingRecord._id,
        quantity: quantity,
        batchesUsed: batchesUsed
      }
    };

    // Add IPD billing info if applicable
    if (ipdBillingInfo) {
      response.ipdBilling = ipdBillingInfo;
    }

    // Add stock warning if any
    if (stockWarning) {
      response.warning = stockWarning;
    }

    res.status(200).json(response);

  } catch (error) {
    logger.error('Dispense prescription error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Mark prescription as unavailable
// @route   POST /api/dispensing/mark-unavailable
// @access  Private (Pharmacist, Admin)
export const markPrescriptionUnavailable = async (req, res) => {
  try {
    const { prescriptionId, reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required when marking as unavailable'
      });
    }

    const visit = await Visit.findOne({ 'prescriptions._id': prescriptionId });

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    const prescription = visit.prescriptions.id(prescriptionId);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    if (prescription.status === 'Dispensed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot mark dispensed prescription as unavailable'
      });
    }

    prescription.status = 'Unavailable';
    prescription.unavailableReason = reason;
    prescription.markedUnavailableBy = req.user._id;
    prescription.markedUnavailableAt = new Date();
    prescription.isActive = false;

    await visit.save();

    await visit.populate([
      { path: 'prescriptions.markedUnavailableBy', select: 'firstName lastName' }
    ]);

    const updatedPrescription = visit.prescriptions.id(prescriptionId);

    res.status(200).json({
      success: true,
      message: 'Prescription marked as unavailable',
      data: updatedPrescription
    });
  } catch (error) {
    logger.error('Mark unavailable error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Return prescription to doctor
// @route   POST /api/dispensing/return-to-doctor
// @access  Private (Pharmacist, Admin)
export const returnPrescriptionToDoctor = async (req, res) => {
  try {
    const { prescriptionId, reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required when returning to doctor'
      });
    }

    const visit = await Visit.findOne({ 'prescriptions._id': prescriptionId });

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    const prescription = visit.prescriptions.id(prescriptionId);

    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }

    if (prescription.status === 'Dispensed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot return dispensed prescription'
      });
    }

    prescription.status = 'Returned to Doctor';
    prescription.returnedToDoctor = true;
    prescription.returnToDoctorReason = reason;
    prescription.returnedBy = req.user._id;
    prescription.returnedAt = new Date();
    // Keep isActive true so doctor can see and modify

    await visit.save();

    await visit.populate([
      { path: 'prescriptions.returnedBy', select: 'firstName lastName' }
    ]);

    const updatedPrescription = visit.prescriptions.id(prescriptionId);

    res.status(200).json({
      success: true,
      message: 'Prescription returned to doctor',
      data: updatedPrescription
    });
  } catch (error) {
    logger.error('Return to doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Create a dispensing record WITH AUTOMATIC IPD BILLING
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
      if (medicine.match(/^[0-9a-fA-F]{24}$/)) {
        medicineDoc = await Medicine.findById(medicine);
      } else {
        medicineDoc = await Medicine.findOne({ 
          name: { $regex: new RegExp(`^${medicine}$`, 'i') } 
        });
      }
    }

    let batchesUsed = [];
    let medicinePrice = 0;

    if (medicineDoc && quantity > 0) {
      const quantityToDispense = Math.abs(quantity);
      
      // Get medicine price
      medicinePrice = medicineDoc.prices?.Pharmacy || medicineDoc.sellingPrice || 0;
      
      console.log(`Processing ${medicineDoc.name}: Need to dispense ${quantityToDispense} units`);
      
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
        batchesUsed.push({
          batchNumber: batch.batchNumber,
          quantity: deductFromThisBatch
        });
        remainingToDispense -= deductFromThisBatch;
      }

      // === NEW: CHECK IF PATIENT IS IN IPD AND ADD CHARGE ===
      let ipdBillingInfo = null;
      
      if (patient) {
        const ipdRecord = await IPDRecord.findOne({
          patient: patient,
          status: { $in: ['admitted', 'under_observation', 'critical', 'stable'] }
        }).populate('billing.invoice');

        if (ipdRecord && ipdRecord.billing && ipdRecord.billing.invoice) {
          // Patient is in IPD - add medication charge
          try {
            const invoice = await Invoice.findById(ipdRecord.billing.invoice);
            
            if (invoice) {
              const actuallyDispensed = quantityToDispense - remainingToDispense;
              const totalPrice = actuallyDispensed * medicinePrice;
              const batchInfo = batchesUsed.length > 0 
                ? `Batches: ${batchesUsed.map(b => `${b.batchNumber} (${b.quantity})`).join(', ')}`
                : '';

              invoice.items.push({
                type: 'medication',
                description: `${medicineDoc.name} - ${actuallyDispensed} units`,
                quantity: actuallyDispensed,
                unitPrice: medicinePrice,
                discount: 0,
                tax: 0,
                total: totalPrice,
                paid: false,
                notes: `Direct dispensing. ${batchInfo}`
              });

              invoice.calculateTotals();
              await invoice.save();

              ipdRecord.billing.totalAmount = invoice.totalAmount;
              ipdRecord.billing.balance = invoice.balanceDue;
              await ipdRecord.save();

              ipdBillingInfo = {
                addedToInvoice: true,
                invoiceNumber: invoice.invoiceNumber,
                chargeAmount: totalPrice,
                newBalance: invoice.balanceDue
              };

              logger.info(
                `Medication charge added to IPD invoice ${invoice.invoiceNumber}: ` +
                `${medicineDoc.name} x ${actuallyDispensed} = ${totalPrice}. ` +
                `Admission: ${ipdRecord.admissionNumber}`
              );
            }
          } catch (ipdError) {
            logger.error('IPD billing error during direct dispensing:', ipdError);
            ipdBillingInfo = {
              addedToInvoice: false,
              error: 'Failed to add charge to IPD invoice'
            };
          }
        }
      }

      if (remainingToDispense > 0) {
        console.log(`Warning: Could not dispense full quantity for ${medicineDoc.name}. Short by ${remainingToDispense} units`);
        
        const response = {
          success: true, 
          data: record,
          stockMovements: stockMovements.length,
          warning: `Partially dispensed: ${quantityToDispense - remainingToDispense} of ${quantityToDispense} units (insufficient stock)`
        };

        if (ipdBillingInfo) {
          response.ipdBilling = ipdBillingInfo;
        }

        return res.status(201).json(response);
      }

      const response = {
        success: true, 
        data: record,
        stockMovements: stockMovements.length,
        message: ipdBillingInfo?.addedToInvoice
          ? `Successfully dispensed ${quantityToDispense} units and charged to IPD invoice`
          : `Successfully dispensed ${quantityToDispense} units. Created ${stockMovements.length} stock movements`
      };

      if (ipdBillingInfo) {
        response.ipdBilling = ipdBillingInfo;
      }

      res.status(201).json(response);

    } else {
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