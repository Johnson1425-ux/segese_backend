import express from 'express';
import {
  getIncomingItems,
  receiveIncomingItem,
} from '../controllers/incomingItemsController.js';

const router = express.Router();

router.route('/').get(getIncomingItems);
router.route('/:id').put(receiveIncomingItem);

export default router;