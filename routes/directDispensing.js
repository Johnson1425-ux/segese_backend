import express from 'express';
import {
  getDirectDispensingRecords,
  createDirectDispensingRecord,
} from '../controllers/directDispensingController.js';

const router = express.Router();

router.route('/').get(getDirectDispensingRecords).post(createDirectDispensingRecord);

export default router;