import express from 'express';
import Visit from '../models/Visit.js';
import Prescription from '../models/Prescription.js';
import { protect, authorize } from '../middleware/auth.js';
import { checkPaymentEligibility } from '../middleware/paymentEligibility.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.use(protect);

// @desc    Get all prescriptions (aggregated from all visits)
// @route   GET /api/prescriptions
// @access  Private (Admin, Pharmacist)
router.get('/', authorize('admin', 'pharmacist'), async (req, res) => {
  try {
    const { status, patientId } = req.query;

    // Aggregate prescriptions from all active visits only
    const matchStage = { 
      'prescriptions.0': { $exists: true }, // Only visits with prescriptions
      isActive: true // Only active visits
    };
    
    const visits = await Visit.find(matchStage)
      .populate('patient', 'firstName lastName patientId')
      .populate('doctor', 'firstName lastName')
      .populate('prescriptions.prescribedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    // Flatten prescriptions with visit context
    const allPrescriptions = [];
    
    visits.forEach(visit => {
      if (visit.prescriptions && visit.prescriptions.length > 0) {
        visit.prescriptions.forEach(prescription => {
          // Apply filters
          if (patientId && visit.patient._id.toString() !== patientId) return;
          
          // Skip prescriptions that are pending payment
          if (prescription.status === 'Pending Payment') return;
          
          // Only show active prescriptions (not dispensed)
          if (!prescription.isActive) return;

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

    // Sort by most recent
    allPrescriptions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      status: 'success',
      data: allPrescriptions,
      count: allPrescriptions.length
    });
  } catch (error) {
    logger.error('Get prescriptions error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// Get prescriptions for a specific patient
router.get('/patient/:patientId', authorize('admin', 'doctor', 'nurse', 'pharmacist'), async (req, res) => {
  try {
    const visits = await Visit.find({ 
      patient: req.params.patientId,
      'prescriptions.0': { $exists: true }
    })
      .populate('prescriptions.prescribedBy', 'firstName lastName')
      .sort({ createdAt: -1 });
    
    // Flatten all prescriptions from all visits
    const allPrescriptions = [];
    visits.forEach(visit => {
      if (visit.prescriptions && visit.prescriptions.length > 0) {
        visit.prescriptions.forEach(prescription => {
          if (prescription.isActive) {
            allPrescriptions.push({
              ...prescription.toObject(),
              visitId: visit.visitId,
              visitDate: visit.visitDate
            });
          }
        });
      }
    });
    
    res.status(200).json({
      status: 'success',
      data: allPrescriptions
    });
  } catch (error) {
    logger.error('Get patient prescriptions error', error);
    res.status(500).json({
      status: 'error',
      message: 'Server Error'
    });
  }
});

// Update prescription (mark as inactive/dispensed)
router.patch('/:id', authorize('admin', 'doctor', 'pharmacist'), async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    // Find the visit containing this prescription
    const visit = await Visit.findOne({ 'prescriptions._id': id });

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Prescription not found'
      });
    }

    const prescription = visit.prescriptions.id(id);

    if (!prescription) {
      return res.status(404).json({
        status: 'error',
        message: 'Prescription not found'
      });
    }

    // Update the prescription
    prescription.isActive = isActive;
    await visit.save();

    res.status(200).json({
      status: 'success',
      data: prescription
    });
  } catch (error) {
    logger.error('Update prescription error', error);
    res.status(400).json({
      status: 'error',
      message: error.message
    });
  }
});

export default router;