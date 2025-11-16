import express from 'express';
import {
  createLabTest,
  getLabTest,
  getLabTests,
  updateLabTest
} from '../controllers/labTestController.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Define roles for viewing and managing lab tests
const viewRoles = ['admin', 'doctor', 'lab_technician'];
const manageRoles = ['admin', 'doctor', 'lab_technician'];

router.route('/')
  .get(authorize(...viewRoles), getLabTests)
  .post(authorize('admin', 'doctor'), createLabTest);

router.route('/:id')
  .get(authorize(...viewRoles), getLabTest)
  .put(authorize('admin', 'lab_technician'), updateLabTest)
  .delete(authorize('admin'), async (req, res) => {
    await LabTest.findByIdAndDelete(req.params.id);
    res.status(200).json({ 
      success: true, 
      data: {} 
    });
  });

export default router;