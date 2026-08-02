import express from 'express';
import {
  getDirectDispensingRecords,
  createDirectDispensingRecord,
} from '../controllers/directDispensingController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(authorize('admin', 'pharmacist', 'doctor'), getDirectDispensingRecords)
  .post(authorize('admin', 'pharmacist'), createDirectDispensingRecord);

export default router;
