import express from 'express';
import {
  getItemPrices,
  createItemPrice,
  updateItemPrice,
  deleteItemPrice,
} from '../controllers/itemPricingController.js';

const router = express.Router();

router.route('/').get(getItemPrices).post(createItemPrice);

router.route('/:id').put(updateItemPrice).delete(deleteItemPrice);

export default router;