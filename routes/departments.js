import express from 'express';
import Department from '../models/Department.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Middleware to protect all routes
router.use(protect);

router.get('/', async (req, res) => {
    try {
        const departments = await Department.find();
        res.status(200).json({
            status: 'success',
            data: departments
        });
    } catch (error) {
        logger.error(`Error fetching departments: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: 'Internal Server Error'
        });
    }
});

router.get('/search', async (req, res) => {
    try {
        const { name } = req.query;

        if (!name) {
            res.status(400).json({
                status: 'error',
                message: 'Name parameter is required'
            });
        }

        const departments = await Department.find({
            name: { $regex: name, $options: 'i' }
        });
        
        res.status(200).json({
            status: 'success',
            data: departments
        });
    } catch (error) {
        logger.error('Search departments error', console.error);
        res.status(500).json({
            status: 'error',
            message: 'Server Error'
        });
    }
});

router.post('/', authorize('admin'), async (req, res) => {
    try {
        const department = new Department(req.body);
        await department.save();
        res.status(200).json({
            status: 'success',
            message: 'Department added successfully'
            });
    } catch (error) {
        logger.error('Add department error', error);
        res.status(400).json({
            status: 'error',
            message: message.error
        });
    }
});

export default router;