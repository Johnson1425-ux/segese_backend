import express from 'express';
import {
  getItemPrices,
  createItemPrice,
  updateItemPrice,
  deleteItemPrice,
} from '../controllers/itemPricingController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(authorize('admin', 'pharmacist', 'receptionist'), getItemPrices)
  .post(authorize('admin', 'pharmacist'), createItemPrice);

router
  .route('/:id')
  .put(authorize('admin', 'pharmacist'), updateItemPrice)
  .delete(authorize('admin'), deleteItemPrice);

export default router;
