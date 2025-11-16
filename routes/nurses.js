import express from 'express';
import User from '../models/User.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.use(protect);

router.get('/', protect, authorize('admin', 'receptionist'), async (req, res) => {
    const nurses = await User.find({ role: 'nurse' });
    res.status(200).json({
        status: 'success',
        data: nurses
    });
});

export default router;