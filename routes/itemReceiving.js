import express from 'express';
import {
  getPurchaseOrders,
  addPurchaseOrder,
  receiveItem,
  getStockLevels,
  getExpiringMedicines,
  completePurchaseOrder,
} from '../controllers/itemReceivingController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.route('/purchase-orders')
  .get(authorize('admin', 'pharmacist', 'doctor'), getPurchaseOrders)
  .post(authorize('admin', 'pharmacist'), addPurchaseOrder);

router.route('/purchase-orders/:id/complete')
  .put(authorize('admin', 'pharmacist'), completePurchaseOrder);

router.route('/')
  .post(authorize('admin', 'pharmacist'), receiveItem);

router.route('/stock')
  .get(authorize('admin', 'pharmacist', 'doctor'), getStockLevels);

router.route('/expiring')
  .get(authorize('admin', 'pharmacist'), getExpiringMedicines);

export default router;