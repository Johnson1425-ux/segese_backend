import express from 'express';
import {
  getDispensingRecords,
  createDispensingRecord,
} from '../controllers/dispensingController.js';

const router = express.Router();

router.route('/').get(getDispensingRecords).post(createDispensingRecord);

export default router;