import express from 'express';
import {
  getIncomingItems,
  receiveIncomingItem,
} from '../controllers/incomingItemsController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.route('/').get(authorize('admin', 'pharmacist'), getIncomingItems);
router.route('/:id').put(authorize('admin', 'pharmacist'), receiveIncomingItem);

export default router;
