import express from 'express';
import { body, validationResult } from 'express-validator';
import Visit from '../models/Visit.js';
import Patient from '../models/Patient.js';
import LabTest from '../models/LabTest.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Protect all routes in this file
router.use(protect);

// @desc    Get all active visits (or doctor's own queue) and allow search by patient name
// @route   GET /api/visits
router.get('/', authorize('admin', 'doctor', 'receptionist'), async (req, res) => {
    try {
        const { search } = req.query;
        
        const query = { isActive: true };

        if (req.user.role === 'doctor') {
            query.doctor = req.user.id;
        }

        let visits;

        if (search) {
            const Patient = mongoose.model('Patient');
            const patientSearchRegex = new RegExp(search, 'i');

            const matchingPatients = await Patient.find({
                $or: [
                    { firstName: { $regex: patientSearchRegex } },
                    { lastName: { $regex: patientSearchRegex } }
                ]
            }).select('_id');

            const patientIds = matchingPatients.map(p => p._id);

            query.patient = { $in: patientIds };
        }

        visits = await Visit.find(query)
            .populate('patient', 'firstName lastName fullName') 
            .populate('doctor', 'firstName lastName fullName')
            .sort({ visitDate: -1 });

        res.status(200).json({ status: 'success', data: visits });
    } catch (error) {
        logger.error('Get visits error:', error);
        res.status(500).json({ status: 'error', message: 'Server Error' });
    }
});

// @desc    Get a single visit by ID
// @route   GET /api/visits/:id
router.get('/:id', authorize('admin', 'doctor'), async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id)
            .populate('patient')
            .populate('doctor');
        if (!visit) {
            return res.status(404).json({ status: 'error', message: 'Visit not found' });
        }
        res.status(200).json({ status: 'success', data: visit });
    } catch (error) {
        logger.error('Get single visit error:', error);
        res.status(500).json({ status: 'error', message: 'Server Error' });
    }
});

// @desc    Create a new visit
// @route   POST /api/visits
// @access  Private (Admin, Receptionist)
router.post('/', authorize('admin', 'receptionist'), async (req, res) => {
  try {
    const { patientId, doctorId, visitDate, reason, status, type } = req.body;

    const activeVisit = await Visit.findOne({ 
        patient: patientId, 
        isActive: true
    });

    if (activeVisit) {
      return res.status(400).json({
        status: 'error',
        message: `Patient already has an active visit (Visit ID: ${activeVisit.visitId || activeVisit._id}). Please end the current visit before starting a new one.`
      });
    }

    // Fetch patient to check insurance status
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({
        status: 'error',
        message: 'Patient not found'
      });
    }

    // Check if patient has insurance
    const hasInsurance = !!(patient.insurance?.provider);

    // Determine initial status based on insurance
    let visitStatus = status || 'Pending Payment';
    if (hasInsurance) {
      visitStatus = 'In Queue';
    }
    
    const newVisit = new Visit({
      patient: patientId,
      doctor: doctorId,
      visitDate,
      reason,
      status: visitStatus,
      type,
      startedBy: req.user.id,
    });

    const visit = await newVisit.save();

    logger.info(`Visit created for patient ${patientId}. Insurance status: ${hasInsurance}, Visit status: ${visitStatus}`);

    res.status(201).json({
      status: 'success',
      data: visit,
      message: `Visit created successfully${hasInsurance ? ' and moved to In Queue (insurance coverage)' : ''}`
    });
  } catch (error) {
    logger.error('Create visit error:', error);
    res.status(400).json({ status: 'error', message: error.message });
  }
});

// @desc    Add a lab order to a visit
// @route   POST /api/visits/:id/lab-orders
// @access  Private (Doctor only)
router.post('/:id/lab-orders', authorize('admin', 'doctor'), async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id);

        if (!visit) {
            return res.status(404).json({ status: 'error', message: 'Visit not found' });
        }

        const { testName, notes } = req.body;

        const newLabOrder = {
            testName,
            notes,
            patient: visit.patient._id,
            orderedBy: req.user.id,
            status: 'Pending',
        };

        visit.labOrders.push(newLabOrder);
        await visit.save();

        const addedOrder = visit.labOrders[visit.labOrders.length - 1];
        res.status(201).json({ status: 'success', data: addedOrder });

    } catch (error) {
        logger.error('Add lab order error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// @desc    Add a diagnosis to a visit
// @route   POST /api/visits/:id/diagnosis
// @access  Private (Doctor only)
router.post('/:id/diagnosis', authorize('admin', 'doctor'), async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id);

        if (!visit) {
            return res.status(404).json({ status: 'error', message: 'Visit not found' });
        }

        const { condition, icd10Code, notes } = req.body;

        const newDiagnosis = {
            condition,
            icd10Code,
            notes,
            patient: visit.patient._id,
            diagnosedBy: req.user.id,
        };

        visit.diagnosis.push(newDiagnosis);
        await visit.save();

        const addedDiagnosis = visit.diagnosis[visit.diagnosis.length - 1];
        res.status(201).json({ status: 'success', data: addedDiagnosis });

    } catch (error) {
        logger.error('Add diagnosis error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// @desc    Add a prescription to a visit
// @route   POST /api/visits/:id/prescriptions
// @access  Private (Doctor only)
router.post('/:id/prescriptions', authorize('admin', 'doctor'), async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id);

        if (!visit) {
            return res.status(404).json({ status: 'error', message: 'Visit not found' });
        }

        const { medication, dosage, frequency, duration } = req.body;

        const newPrescription = {
            medication,
            dosage,
            frequency,
            duration,
            patient: visit.patient._id,
            prescribedBy: req.user.id,
        };

        visit.prescriptions.push(newPrescription);
        await visit.save();

        const addedPrescription = visit.prescriptions[visit.prescriptions.length - 1];
        res.status(201).json({ status: 'success', data: addedPrescription });

    } catch (error) {
        logger.error('Add prescription error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// @desc    Update a visit with clinical data
// @route   PUT /api/visits/:id/clinical
router.put('/:id/clinical', authorize('doctor'), async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id);
        if (!visit) {
            return res.status(404).json({ message: 'Visit not found' });
        }

        const { diagnosis, labOrders, prescriptions } = req.body;

        if (diagnosis) visit.diagnosis = diagnosis;
        if (labOrders) visit.labOrders.push(...labOrders);
        if (prescriptions) visit.prescriptions.push(...prescriptions);
        
        if(req.body.status) visit.status = req.body.status;

        await visit.save();
        res.status(200).json({ status: 'success', data: visit });

    } catch (error) {
        logger.error('Update clinical data error:', error);
        res.status(400).json({ message: 'Failed to update clinical data', error: error.message });
    }
});

// @desc    Get prescriptions for a visit
// @route   GET /api/visits/:id/prescriptions
router.get('/:id/prescriptions', async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id);
        if (!visit) {
            return res.status(404).json({ 
                status: 'error',
                message: 'Visit not found'
            });
        }

        const prescription = visit.prescriptions;
        res.status(200).json({
            status: 'success',
            data: prescription
        });
    } catch (error) {
        logger.error('Get prescription error', error);
        res.status(500).json({
            status: 'error',
            message: 'Server Error' 
        });
    }
});

// @desc    End a visit
// @route   PATCH /api/visits/:id/end-visit
router.patch('/:id/end-visit', authorize('admin', 'receptionist'), async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id);

        if (!visit) {
            res.status(404).json({
                status: 'error',
                message: 'Visit not found'
            });
        }

        visit.isActive = !visit.isActive;
        await visit.save();

        res.status(200).json({
            status: 'success',
            message: `Visit ${visit.isActive} ended successfully`
        });
    } catch (error) {
        logger.error('Ending visit error', error);
        res.status(500).json({
            status: 'error',
            message: 'Server Error'
        });
    }
});

export default router;