import express from 'express';
import User from '../models/User.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.use(protect);

router.get('/', protect, authorize('admin', 'doctor'), async (req, res) => {
    const surgeons = await User.find({ role: 'surgeon' });
    res.status(200).json({
        status: 'success',
        data: surgeons
    });
});

export default router;