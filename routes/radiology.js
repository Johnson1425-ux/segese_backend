import express from 'express';
import {
  createRadiologyRequest,
  getRadiologyRequests,
  updateRadiologyRequest,
} from '../controllers/radiologyController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.route('/')
  .get(authorize('admin', 'doctor', 'radiologist', 'lab_technician'), getRadiologyRequests)
  .post(authorize('admin', 'doctor'), createRadiologyRequest);

router.route('/:id')
  .put(authorize('admin', 'radiologist', 'lab_technician'), updateRadiologyRequest);

export default router;