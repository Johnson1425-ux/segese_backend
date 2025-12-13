import express from 'express';
import { Medicine } from '../models/Medicine.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.use(protect);

// @desc    Search medications (for doctors writing prescriptions)
// @route   GET /api/medications/search
// @access  Private (Doctor, Admin)
router.get('/search', authorize('admin', 'doctor'), async (req, res) => {
  try {
    const { name } = req.query;

    if (!name || name.length < 2) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide at least 2 characters to search'
      });
    }

    // Search medicines from pharmacy module
    const medicines = await Medicine.find({
      name: { $regex: name, $options: 'i' }
    })
      .select('name genericName type strength manufacturer category sellingPrice')
      .limit(20)
      .sort('name');

    // Transform to match the expected format
    const medications = medicines.map(medicine => ({
      _id: medicine._id,
      name: `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''}`,
      genericName: medicine.genericName,
      type: medicine.type,
      strength: medicine.strength,
      manufacturer: medicine.manufacturer,
      category: medicine.category,
      price: medicine.sellingPrice // Use selling price as the prescription price
    }));

    res.status(200).json({
      status: 'success',
      data: medications,
      count: medications.length
    });
  } catch (error) {
    logger.error('Search medications error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error while searching medications'
    });
  }
});

// @desc    Get all medications (for dropdown lists)
// @route   GET /api/medications
// @access  Private (Doctor, Admin, Pharmacist)
router.get('/', authorize('admin', 'doctor', 'pharmacist'), async (req, res) => {
  try {
    const { category, type } = req.query;

    const query = {};
    if (category) query.category = category;
    if (type) query.type = type;

    const medicines = await Medicine.find(query)
      .select('name genericName type strength manufacturer category sellingPrice')
      .sort('name');

    // Transform to consistent format
    const medications = medicines.map(medicine => ({
      _id: medicine._id,
      name: `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''}`,
      genericName: medicine.genericName,
      type: medicine.type,
      strength: medicine.strength,
      manufacturer: medicine.manufacturer,
      category: medicine.category,
      price: medicine.sellingPrice
    }));

    res.status(200).json({
      status: 'success',
      data: medications,
      count: medications.length
    });
  } catch (error) {
    logger.error('Get medications error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error while fetching medications'
    });
  }
});

// @desc    Get medication by ID
// @route   GET /api/medications/:id
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id)
      .select('name genericName type strength manufacturer category sellingPrice description');

    if (!medicine) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        _id: medicine._id,
        name: `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''}`,
        genericName: medicine.genericName,
        type: medicine.type,
        strength: medicine.strength,
        manufacturer: medicine.manufacturer,
        category: medicine.category,
        price: medicine.sellingPrice,
        description: medicine.description
      }
    });
  } catch (error) {
    logger.error('Get medication error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

export default router;