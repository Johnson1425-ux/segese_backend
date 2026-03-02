import express from 'express';
import { body, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import IPDRecord from '../models/IPDRecord.js';
import Patient from '../models/Patient.js';
import Ward from '../models/Ward.js';
import Bed from '../models/Bed.js';
import Invoice from '../models/Invoice.js';
import Service from '../models/Service.js';
import billingService from '../services/billingService.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { getIPDMedications, getIPDRecordMedications } from '../controllers/ipdRecordsController.js';

const router = express.Router();

// @desc    Get all IPD records
// @route   GET /api/ipd-records
// @access  Private
router.get('/', protect, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const startIndex = (page - 1) * limit;

    const query = { isActive: true };
    
    // Filter by patient if provided
    if (req.query.patient) {
      query.patient = req.query.patient;
    }
    
    // Filter by ward if provided
    if (req.query.ward) {
      query.ward = req.query.ward;
    }
    
    // Filter by status if provided
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Filter by admission type if provided
    if (req.query.admissionType) {
      query.admissionType = req.query.admissionType;
    }

    // Filter by date range
    if (req.query.startDate && req.query.endDate) {
      query.admissionDate = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    const total = await IPDRecord.countDocuments(query);
    const records = await IPDRecord.find(query)
      .populate('patient', 'firstName lastName patientId email phone dateOfBirth gender')
      .populate('ward', 'name wardNumber type floor')
      .populate('bed', 'bedNumber type status')
      .populate('admittingDoctor', 'firstName lastName email')
      .populate('assignedNurse', 'firstName lastName email')
      .skip(startIndex)
      .limit(limit)
      .sort({ admissionDate: -1 });

    res.status(200).json({
      status: 'success',
      count: records.length,
      total,
      pagination: {
        page,
        limit,
        pages: Math.ceil(total / limit)
      },
      data: records
    });
  } catch (error) {
    logger.error('Get IPD records error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get IPD statistics
// @route   GET /api/ipd-records/statistics
// @access  Private
router.get('/statistics', protect, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    const stats = await IPDRecord.getStatistics();
    
    // Get current admissions count
    const currentAdmissions = await IPDRecord.countDocuments({ 
      status: { $in: ['admitted', 'under_observation', 'critical', 'stable'] }
    });

    res.status(200).json({
      status: 'success',
      data: {
        ...stats,
        currentAdmissions
      }
    });
  } catch (error) {
    logger.error('Get IPD statistics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get medications from IPD records with optional filters
// @route   GET /api/ipd-records/medications
// @access  Private
// Query params: ipdRecordId, patientId, medicationStatus, medicationName
router.get('/medications', protect, authorize('admin', 'doctor', 'nurse', 'pharmacist'), getIPDMedications);

// @desc    Get single IPD record
// @route   GET /api/ipd-records/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const record = await IPDRecord.findById(req.params.id)
      .populate('patient', 'firstName lastName patientId email phone dateOfBirth gender bloodType')
      .populate('ward', 'name wardNumber type floor capacity')
      .populate('bed', 'bedNumber type status features')
      .populate('admittingDoctor', 'firstName lastName email')
      .populate('assignedNurse', 'firstName lastName email')
      .populate('dischargedBy', 'firstName lastName email')
      .populate('diagnosis.diagnosedBy', 'firstName lastName')
      .populate('treatments.performedBy', 'firstName lastName')
      .populate('medications.prescribedBy', 'firstName lastName')
      .populate('procedures.performedBy', 'firstName lastName')
      .populate('vitalSigns.recordedBy', 'firstName lastName')
      .populate('nursingNotes.recordedBy', 'firstName lastName');

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: record
    });
  } catch (error) {
    logger.error('Get IPD record error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Create new IPD record (admit patient) WITH AUTOMATIC INVOICE CREATION
// @route   POST /api/ipd-records
// @access  Private (Admin, Doctor, Nurse)
router.post('/', protect, authorize('admin', 'doctor', 'nurse'), [
  body('patient').notEmpty().withMessage('Patient is required'),
  body('ward').notEmpty().withMessage('Ward is required'),
  body('bed').notEmpty().withMessage('Bed is required'),
  body('admissionReason').trim().notEmpty().withMessage('Admission reason is required'),
  body('admittingDoctor').notEmpty().withMessage('Admitting doctor is required'),
  body('admissionType').isIn(['emergency', 'elective', 'transfer', 'observation']).withMessage('Invalid admission type'),
  body('emergencyContact.name').trim().notEmpty().withMessage('Emergency contact name is required'),
  body('emergencyContact.phone').trim().notEmpty().withMessage('Emergency contact phone is required'),
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

    // Check if patient exists
    const patient = await Patient.findById(req.body.patient);
    if (!patient) {
      return res.status(404).json({
        status: 'error',
        message: 'Patient not found'
      });
    }

    // Check if ward exists
    const ward = await Ward.findById(req.body.ward);
    if (!ward) {
      return res.status(404).json({
        status: 'error',
        message: 'Ward not found'
      });
    }

    // Check if bed exists and is available
    const bed = await Bed.findById(req.body.bed);
    if (!bed) {
      return res.status(404).json({
        status: 'error',
        message: 'Bed not found'
      });
    }

    if (bed.status !== 'available') {
      return res.status(400).json({
        status: 'error',
        message: `Bed is not available. Current status: ${bed.status}`
      });
    }

    // Check if patient already has an active admission
    const existingAdmission = await IPDRecord.findOne({
      patient: req.body.patient,
      status: { $in: ['admitted', 'under_observation', 'critical', 'stable'] }
    });

    if (existingAdmission) {
      return res.status(400).json({
        status: 'error',
        message: 'Patient already has an active admission'
      });
    }

    // === CREATE IPD RECORD ===
    const ipdRecord = await IPDRecord.create(req.body);

    // === UPDATE BED STATUS ===
    bed.status = 'occupied';
    bed.currentPatient = req.body.patient;
    if (req.body.assignedNurse) {
      bed.assignedNurse = req.body.assignedNurse;
    }
    await bed.save();

    // === UPDATE WARD OCCUPANCY ===
    ward.occupiedBeds += 1;
    await ward.save();

    // === UPDATE PATIENT STATUS ===
    patient.status = 'active';
    await patient.save();

    // === CREATE INVOICE FOR IPD BILLING ===
    const invoiceNumber = await Invoice.generateInvoiceNumber();
    
    // Get room rate from bed or ward
    const roomRate = await Service.findOne({ 
      $or: [
        { category: 'Other'},
        { name: 'Room Charge' }
      ],
      isActive: true
    });
    
    // Create initial invoice with first day's room charge
    const invoice = await Invoice.create({
      invoiceNumber,
      patient: req.body.patient,
      generatedBy: req.user.id,
      status: 'pending',
      items: [{
        type: 'room_charge',
        description: `Admission - ${ward.name} (Bed ${bed.bedNumber}) - Day 1`,
        quantity: 1,
        unitPrice: roomRate.price,
        discount: 0,
        tax: 0,
        total: roomRate.price,
        paid: false,
        notes: `Initial room charge for ${ipdRecord.admissionNumber}`
      }],
      subtotal: roomRate.price,
      totalDiscount: 0,
      totalTax: 0,
      totalAmount: roomRate.price,
      patientResponsibility: roomRate.price,
      amountPaid: 0,
      balanceDue: roomRate.price,
      payments: [],
      paymentTerms: 'immediate',
      dueDate: new Date(),
      issueDate: new Date(),
      notes: `IPD Invoice for Admission ${ipdRecord.admissionNumber}`
    });

    // Link invoice to IPD record
    ipdRecord.billing = {
      invoice: invoice._id,
      dailyRoomCharge: roomRate.price,
      totalAmount: roomRate.price,
      paidAmount: 0,
      balance: roomRate.price,
      lastRoomChargeDate: new Date()
    };
    await ipdRecord.save();

    // Populate and return
    const populatedRecord = await IPDRecord.findById(ipdRecord._id)
      .populate('patient', 'firstName lastName patientId email phone')
      .populate('ward', 'name wardNumber type floor dailyRate')
      .populate('bed', 'bedNumber type dailyRate')
      .populate('admittingDoctor', 'firstName lastName email')
      .populate('billing.invoice');

    logger.info(
      `IPD admission created: ${ipdRecord.admissionNumber}. ` +
      `Invoice ${invoice.invoiceNumber} created with initial room charge: ${roomRate.price}`
    );

    res.status(201).json({
      status: 'success',
      message: 'Patient admitted successfully. Invoice created.',
      data: {
        record: populatedRecord,
        invoice: invoice,
        billing: {
          invoiceNumber: invoice.invoiceNumber,
          totalAmount: roomRate.price,
          balance: roomRate.price,
          dailyRate: roomRate.price
        }
      }
    });
  } catch (error) {
    logger.error('Create IPD record error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Update IPD record
// @route   PUT /api/ipd-records/:id
// @access  Private (Admin, Doctor, Nurse)
router.put('/:id', protect, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    let record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    // Prevent updating discharged records
    if (record.status === 'discharged' && req.body.status !== 'discharged') {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot update discharged patient record'
      });
    }

    record = await IPDRecord.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    }).populate('patient ward bed admittingDoctor assignedNurse');

    res.status(200).json({
      status: 'success',
      data: record
    });
  } catch (error) {
    logger.error('Update IPD record error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Discharge patient
// @route   PUT /api/ipd-records/:id/discharge
// @access  Private (Admin, Doctor)
router.put('/:id/discharge', protect, authorize('admin', 'doctor'), [
  body('dischargeReason').isIn(['recovered', 'referred', 'against_medical_advice', 'deceased', 'absconded', 'transferred']).withMessage('Invalid discharge reason'),
  body('dischargeSummary').optional().trim(),
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

    const record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    if (record.status === 'discharged') {
      return res.status(400).json({
        status: 'error',
        message: 'Patient is already discharged'
      });
    }

    // Update IPD record
    record.status = 'discharged';
    record.dischargeDate = new Date();
    record.actualDischargeDate = new Date();
    record.dischargeReason = req.body.dischargeReason;
    record.dischargeSummary = req.body.dischargeSummary;
    record.dischargedBy = req.user._id;
    record.isActive = false; // Mark record as inactive upon discharge
    await record.save();

    // Release bed
    const bed = await Bed.findById(record.bed);
    if (bed) {
      bed.status = 'cleaning';
      bed.currentPatient = null;
      await bed.save();
    }

    // Update ward occupancy
    const ward = await Ward.findById(record.ward);
    if (ward) {
      ward.occupiedBeds = Math.max(0, ward.occupiedBeds - 1);
      await ward.save();
    }

    // Update patient status
    const patient = await Patient.findById(record.patient);
    if (patient) {
      patient.status = 'discharged';
      await patient.save();
    }

    const populatedRecord = await IPDRecord.findById(record._id)
      .populate('patient ward bed dischargedBy');

    res.status(200).json({
      status: 'success',
      message: 'Patient discharged successfully',
      data: populatedRecord
    });
  } catch (error) {
    logger.error('Discharge patient error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Add diagnosis to IPD record
// @route   POST /api/ipd-records/:id/diagnosis
// @access  Private (Doctor)
router.post('/:id/diagnosis', protect, authorize('admin', 'doctor'), [
  body('condition').trim().notEmpty().withMessage('Condition is required'),
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

    const record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    const diagnosis = {
      condition: req.body.condition,
      diagnosedBy: req.user._id,
      diagnosedDate: new Date(),
      notes: req.body.notes
    };

    record.diagnosis.push(diagnosis);
    await record.save();

    res.status(200).json({
      status: 'success',
      message: 'Diagnosis added successfully',
      data: record
    });
  } catch (error) {
    logger.error('Add diagnosis error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Add vital signs to IPD record
// @route   POST /api/ipd-records/:id/vitals
// @access  Private (Nurse, Doctor)
router.post('/:id/vitals', protect, authorize('admin', 'nurse', 'doctor'), async (req, res) => {
  try {
    const record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    const vitalSigns = {
      ...req.body,
      recordedBy: req.user._id,
      recordedDate: new Date()
    };

    record.vitalSigns.push(vitalSigns);
    await record.save();

    res.status(200).json({
      status: 'success',
      message: 'Vital signs recorded successfully',
      data: record
    });
  } catch (error) {
    logger.error('Add vital signs error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Add nursing note to IPD record
// @route   POST /api/ipd-records/:id/nursing-notes
// @access  Private (Nurse)
router.post('/:id/nursing-notes', protect, authorize('admin', 'nurse'), [
  body('note').trim().notEmpty().withMessage('Note is required'),
  body('category').optional().isIn(['general', 'medication', 'vital_signs', 'treatment', 'observation', 'incident']),
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

    const record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    const nursingNote = {
      note: req.body.note,
      recordedBy: req.user._id,
      recordedDate: new Date(),
      category: req.body.category || 'general'
    };

    record.nursingNotes.push(nursingNote);
    await record.save();

    res.status(200).json({
      status: 'success',
      message: 'Nursing note added successfully',
      data: record
    });
  } catch (error) {
    logger.error('Add nursing note error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Add medication to IPD record
// @route   POST /api/ipd-records/:id/medications
// @access  Private (Doctor)
router.post('/:id/medications', protect, authorize('admin', 'doctor'), [
  body('medication').trim().notEmpty().withMessage('Medication is required'),
  body('dosage').trim().notEmpty().withMessage('Dosage is required'),
  body('frequency').trim().notEmpty().withMessage('Frequency is required'),
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

    const { medication, dosage, frequency, startDate, endDate, notes } = req.body;

    const record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    // Step 1: Check if medication exists in Medicine model (your batch-based system)
      const Medicine = mongoose.model('Medicine');
      
      // Try to find medicine by exact name or partial match
      let medicineItem = await Medicine.findOne({ 
        name: { $regex: new RegExp(`^${medication}$`, 'i') }
      });

      // If not found by exact match, try partial match on first word
      if (!medicineItem) {
        const medicationName = medication.split(' ')[0];
        medicineItem = await Medicine.findOne({ 
          name: { $regex: new RegExp(`^${medicationName}`, 'i') }
        });
      }

      if (!medicineItem) {
        return res.status(404).json({
          status: 'error',
          message: `Medication "${medication}" not found in inventory. Please check medicine catalog.`
        });
      }

    const medicationRecord = {
      medication: req.body.medication,
      medicineId: medicineItem._id,
      dosage: req.body.dosage,
      frequency: req.body.frequency,
      patient: record.patient._id,
      startDate: req.body.startDate || new Date(),
      status: 'Pending Quantification',
      quantifiedQuantity: null,
      quantifiedPrice: null,
      endDate: req.body.endDate,
      prescribedBy: req.user._id,
      notes: req.body.notes
    };

    record.medications.push(medicationRecord);
    await record.save();

    res.status(200).json({
      status: 'success',
      message: 'Medication added successfully',
      data: record
    });
  } catch (error) {
    logger.error('Add medication error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Update medication status in IPD record
// @route   PATCH /api/ipd-records/:id/medications/:medicationId
// @access  Private (Pharmacist, Admin)
router.patch('/:id/medications/:medicationId', protect, authorize('admin', 'pharmacist'), async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        status: 'error',
        message: 'Status is required'
      });
    }

    const record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    // Find and update the medication
    const medication = record.medications.id(req.params.medicationId);

    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found in this record'
      });
    }

    medication.status = status;
    await record.save();

    res.status(200).json({
      status: 'success',
      message: 'Medication status updated successfully',
      data: medication
    });
  } catch (error) {
    logger.error('Update medication status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Transfer patient to different ward/bed
// @route   POST /api/ipd-records/:id/transfer
// @access  Private (Admin, Doctor, Nurse)
router.post('/:id/transfer', protect, authorize('admin', 'doctor', 'nurse'), [
  body('newWard').notEmpty().withMessage('New ward is required'),
  body('newBed').notEmpty().withMessage('New bed is required'),
  body('transferReason').trim().notEmpty().withMessage('Transfer reason is required'),
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

    const record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    // Check if patient is already discharged
    if (record.status === 'discharged') {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot transfer discharged patient'
      });
    }

    const { newWard, newBed, transferReason, notes } = req.body;

    // Check if new ward exists
    const targetWard = await Ward.findById(newWard);
    if (!targetWard) {
      return res.status(404).json({
        status: 'error',
        message: 'Target ward not found'
      });
    }

    // Check if new bed exists and is available
    const targetBed = await Bed.findById(newBed);
    if (!targetBed) {
      return res.status(404).json({
        status: 'error',
        message: 'Target bed not found'
      });
    }

    // Verify bed belongs to target ward
    if (targetBed.ward.toString() !== newWard.toString()) {
      return res.status(400).json({
        status: 'error',
        message: 'Selected bed does not belong to the target ward'
      });
    }

    if (targetBed.status !== 'available') {
      return res.status(400).json({
        status: 'error',
        message: `Target bed is not available. Current status: ${targetBed.status}`
      });
    }

    // Check if transferring to same ward/bed
    if (record.ward.toString() === newWard.toString() && 
        record.bed.toString() === newBed.toString()) {
      return res.status(400).json({
        status: 'error',
        message: 'Patient is already in this ward and bed'
      });
    }

    // Get current ward and bed
    const currentWard = await Ward.findById(record.ward);
    const currentBed = await Bed.findById(record.bed);

    // === PERFORM TRANSFER ===

    // 1. Release current bed
    if (currentBed) {
      currentBed.status = 'cleaning';
      currentBed.currentPatient = null;
      currentBed.assignedNurse = null;
      await currentBed.save();
    }

    // 2. Update current ward occupancy (decrease)
    if (currentWard) {
      currentWard.occupiedBeds = Math.max(0, currentWard.occupiedBeds - 1);
      await currentWard.save();
    }

    // 3. Occupy new bed
    targetBed.status = 'occupied';
    targetBed.currentPatient = record.patient;
    if (req.body.assignedNurse) {
      targetBed.assignedNurse = req.body.assignedNurse;
    }
    await targetBed.save();

    // 4. Update new ward occupancy (increase)
    targetWard.occupiedBeds += 1;
    await targetWard.save();

    // 5. Store transfer history in nursing notes
    const transferNote = {
      note: `Patient transferred from ${currentWard?.name || 'Unknown'} (Bed ${currentBed?.bedNumber || 'Unknown'}) to ${targetWard.name} (Bed ${targetBed.bedNumber}). Reason: ${transferReason}. ${notes ? 'Notes: ' + notes : ''}`,
      recordedBy: req.user._id,
      recordedDate: new Date(),
      category: 'general'
    };
    record.nursingNotes.push(transferNote);

    // 6. Update IPD record with new ward and bed
    record.ward = newWard;
    record.bed = newBed;
    if (req.body.assignedNurse) {
      record.assignedNurse = req.body.assignedNurse;
    }
    
    // Update status if transferring to ICU/CCU
    if (targetWard.type === 'icu' || targetWard.type === 'ccu') {
      record.status = 'critical';
    } else if (record.status === 'critical' && 
               targetWard.type !== 'icu' && 
               targetWard.type !== 'ccu') {
      record.status = 'stable';
    }

    await record.save();

    const populatedRecord = await IPDRecord.findById(record._id)
      .populate('patient', 'firstName lastName patientId')
      .populate('ward', 'name wardNumber type floor')
      .populate('bed', 'bedNumber type')
      .populate('assignedNurse', 'firstName lastName');

    logger.info(
      `Patient ${record.patient} transferred from ward ${currentWard?._id} to ${newWard} ` +
      `by user ${req.user._id}. Reason: ${transferReason}`
    );

    res.status(200).json({
      status: 'success',
      message: 'Patient transferred successfully',
      data: {
        record: populatedRecord,
        transfer: {
          from: {
            ward: currentWard ? {
              _id: currentWard._id,
              name: currentWard.name,
              wardNumber: currentWard.wardNumber
            } : null,
            bed: currentBed ? {
              _id: currentBed._id,
              bedNumber: currentBed.bedNumber
            } : null
          },
          to: {
            ward: {
              _id: targetWard._id,
              name: targetWard.name,
              wardNumber: targetWard.wardNumber
            },
            bed: {
              _id: targetBed._id,
              bedNumber: targetBed.bedNumber
            }
          },
          reason: transferReason,
          notes: notes,
          transferredBy: req.user._id,
          transferredAt: new Date()
        }
      }
    });
  } catch (error) {
    logger.error('Transfer patient error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error',
      error: error.message
    });
  }
});

// @desc    Delete IPD record
// @route   DELETE /api/ipd-records/:id
// @access  Private (Admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    await record.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'IPD record deleted successfully'
    });
  } catch (error) {
    logger.error('Delete IPD record error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get medications for a specific IPD record
// @route   GET /api/ipd-records/:id/medications
// @access  Private
router.get('/:id/medications', protect, authorize('admin', 'doctor', 'nurse', 'pharmacist'), getIPDRecordMedications);

export default router;