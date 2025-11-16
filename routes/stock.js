import express from 'express';
import {
  getStockItems,
  getStockBalance,
  getStockTaking,
  updateStockAudit,
  createMedicine,
  updateMedicine,
  deleteMedicine,
  getStockMovements,
} from '../controllers/stockController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(authorize('admin', 'pharmacist', 'doctor'), getStockItems)
  .post(authorize('admin', 'pharmacist'), createMedicine);

router.route('/balance')
  .get(authorize('admin', 'pharmacist', 'doctor'), getStockBalance);

router.route('/taking')
  .get(authorize('admin', 'pharmacist'), getStockTaking);

router.route('/audit/:medicineId')
  .put(authorize('admin', 'pharmacist'), updateStockAudit);

router.route('/movements')
  .get(authorize('admin', 'pharmacist'), getStockMovements);

router.route('/:id')
  .put(authorize('admin', 'pharmacist'), updateMedicine)
  .delete(authorize('admin', 'pharmacist'), deleteMedicine);

export default router;