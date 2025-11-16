import express from 'express';
import {
  getRequisitions,
  getRequisition,
  createRequisition,
  updateRequisitionItem,
  completeRequisition,
  cancelRequisition,
} from '../controllers/requisitionController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(authorize('admin', 'pharmacist', 'doctor', 'nurse'), getRequisitions)
  .post(authorize('admin', 'pharmacist', 'doctor', 'nurse'), createRequisition);

router.route('/:id')
  .get(authorize('admin', 'pharmacist', 'doctor', 'nurse'), getRequisition);

router.route('/:id/items/:itemId')
  .put(authorize('admin', 'pharmacist'), updateRequisitionItem);

router.route('/:id/complete')
  .put(authorize('admin', 'pharmacist'), completeRequisition);

router.route('/:id/cancel')
  .put(authorize('admin', 'pharmacist', 'doctor', 'nurse'), cancelRequisition);

export default router;