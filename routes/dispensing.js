import express from 'express';
import {
  getDispensingRecords,
  createDispensingRecord,
  getPendingPrescriptions,
  dispensePrescription,
  markPrescriptionUnavailable,
  returnPrescriptionToDoctor
} from '../controllers/dispensingController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Original routes (for backward compatibility)
router.route('/')
  .get(getDispensingRecords)
  .post(createDispensingRecord);

// New prescription-based dispensing routes
router.get('/prescriptions', authorize('admin', 'pharmacist'), getPendingPrescriptions);
router.post('/dispense', authorize('admin', 'pharmacist'), dispensePrescription);
router.post('/mark-unavailable', authorize('admin', 'pharmacist'), markPrescriptionUnavailable);
router.post('/return-to-doctor', authorize('admin', 'pharmacist'), returnPrescriptionToDoctor);

export default router;