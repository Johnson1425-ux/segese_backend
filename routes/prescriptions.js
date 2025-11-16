import express from 'express';
import Visit from '../models/Visit.js';
import Prescription from '../models/Prescription.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.use(protect);

// Get all active prescriptions (for pharmacists)
router.get('/', authorize('admin', 'pharmacist'), async (req, res) => {
    try {
        const prescriptions = await Prescription.find({ isActive: true })
            .populate('patient', 'firstName lastName')
            .populate('prescribedBy', 'firstName lastName')
            .sort({ createdAt: -1 });
        
        res.status(200).json({
            status: 'success',
            data: prescriptions
        });
    } catch (error) {
        logger.error('Get prescriptions error', error);
        res.status(500).json({
            status: 'error',
            message: 'Server Error'
        });
    }
});

// Create a new prescription
router.post('/', authorize('admin', 'doctor'), async (req, res) => {
    try {
        const { visitId, patient, prescriptionData } = req.body;

        // Create the prescription
        const prescription = await Prescription.create({
            medication: prescriptionData.medication,
            dosage: prescriptionData.dosage,
            frequency: prescriptionData.frequency,
            duration: prescriptionData.duration,
            notes: prescriptionData.notes,
            patient,
            prescribedBy: req.user.id
        });

        // If visitId is provided, add prescription to the visit
        if (visitId) {
            await Visit.findByIdAndUpdate(
                visitId,
                { $push: { prescriptions: prescription._id } },
                { new: true }
            );
        }

        // Populate prescription details for response
        await prescription.populate('patient', 'name');
        await prescription.populate('prescribedBy', 'name');

        res.status(201).json({
            status: 'success',
            data: prescription
        });
    } catch (error) {
        logger.error('Create prescription error', error);
        res.status(400).json({
            status: 'error',
            message: error.message
        });
    }
});

// Get prescriptions for a specific patient
router.get('/patient/:patientId', authorize('admin', 'doctor', 'nurse'), async (req, res) => {
    try {
        const prescriptions = await Prescription.find({ 
            patient: req.params.patientId,
            isActive: true 
        })
            .populate('prescribedBy', 'firstName lastName')
            .sort({ createdAt: -1 });
        
        res.status(200).json({
            status: 'success',
            data: prescriptions
        });
    } catch (error) {
        logger.error('Get patient prescriptions error', error);
        res.status(500).json({
            status: 'error',
            message: 'Server Error'
        });
    }
});

// Update prescription (mark as inactive)
router.patch('/:id', authorize('admin', 'doctor'), async (req, res) => {
    try {
        const prescription = await Prescription.findByIdAndUpdate(
            req.params.id,
            { isActive: req.body.isActive },
            { new: true, runValidators: true }
        );

        if (!prescription) {
            return res.status(404).json({
                status: 'error',
                message: 'Prescription not found'
            });
        }

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