import express from 'express';
import { body, validationResult } from 'express-validator';
import IPDRecord from '../models/IPDRecord.js';
import Patient from '../models/Patient.js';
import Ward from '../models/Ward.js';
import Bed from '../models/Bed.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

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

// @desc    Create new IPD record (admit patient)
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

    // Create IPD record
    const ipdRecord = await IPDRecord.create(req.body);

    // Update bed status
    bed.status = 'occupied';
    bed.currentPatient = req.body.patient;
    if (req.body.assignedNurse) {
      bed.assignedNurse = req.body.assignedNurse;
    }
    await bed.save();

    // Update ward occupancy
    ward.occupiedBeds += 1;
    await ward.save();

    // Update patient status
    patient.status = 'active';
    await patient.save();

    const populatedRecord = await IPDRecord.findById(ipdRecord._id)
      .populate('patient', 'firstName lastName patientId')
      .populate('ward', 'name wardNumber')
      .populate('bed', 'bedNumber')
      .populate('admittingDoctor', 'firstName lastName');

    res.status(201).json({
      status: 'success',
      message: 'Patient admitted successfully',
      data: populatedRecord
    });
  } catch (error) {
    logger.error('Create IPD record error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
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

    const record = await IPDRecord.findById(req.params.id);

    if (!record) {
      return res.status(404).json({
        status: 'error',
        message: 'IPD record not found'
      });
    }

    const medication = {
      medication: req.body.medication,
      dosage: req.body.dosage,
      frequency: req.body.frequency,
      startDate: req.body.startDate || new Date(),
      endDate: req.body.endDate,
      prescribedBy: req.user._id,
      notes: req.body.notes
    };

    record.medications.push(medication);
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

export default router;