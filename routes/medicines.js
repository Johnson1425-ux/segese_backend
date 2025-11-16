import express from 'express';
import {
  getMedicines,
  getMedicine,
  createMedicine,
  updateMedicine,
  deleteMedicine,
} from '../controllers/medicineController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(authorize('admin', 'pharmacist', 'doctor', 'nurse', 'receptionist'), getMedicines)
  .post(authorize('admin', 'pharmacist'), createMedicine);

router.route('/:id')
  .get(authorize('admin', 'pharmacist', 'doctor', 'nurse', 'receptionist'), getMedicine)
  .put(authorize('admin', 'pharmacist'), updateMedicine)
  .delete(authorize('admin', 'pharmacist'), deleteMedicine);

export default router;