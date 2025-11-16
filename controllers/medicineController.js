import { Medicine } from '../models/Medicine.js';
import logger from '../utils/logger.js';

// @desc    Get all medicines
// @route   GET /api/medicines
// @access  Private
export const getMedicines = async (req, res) => {
  try {
    const { search, category, type } = req.query;
    
    let query = {};
    
    // Search by name or generic name
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { genericName: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Filter by category
    if (category) {
      query.category = category;
    }
    
    // Filter by type
    if (type) {
      query.type = type;
    }
    
    const medicines = await Medicine.find(query).sort({ name: 1 });
    
    res.status(200).json({
      status: 'success',
      count: medicines.length,
      data: medicines
    });
  } catch (error) {
    logger.error('Get medicines error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get single medicine
// @route   GET /api/medicines/:id
// @access  Private
export const getMedicine = async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id);
    
    if (!medicine) {
      return res.status(404).json({
        status: 'error',
        message: 'Medicine not found'
      });
    }
    
    res.status(200).json({
      status: 'success',
      data: medicine
    });
  } catch (error) {
    logger.error('Get medicine error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Create new medicine
// @route   POST /api/medicines
// @access  Private (Admin, Pharmacist)
export const createMedicine = async (req, res) => {
  try {
    const {
      name,
      genericName,
      type,
      strength,
      manufacturer,
      category,
      sellingPrice,
      reorderLevel,
      prices
    } = req.body;
    
    // Validate required fields
    if (!name || !type || !sellingPrice) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide name, type, and selling price'
      });
    }
    
    // Check if medicine already exists
    const existingMedicine = await Medicine.findOne({ 
      name: name.trim(), 
      type, 
      strength: strength || null 
    });
    
    if (existingMedicine) {
      return res.status(400).json({
        status: 'error',
        message: 'Medicine with this name, type, and strength already exists'
      });
    }
    
    const medicine = await Medicine.create({
      name: name.trim(),
      genericName: genericName?.trim(),
      type,
      strength: strength?.trim(),
      manufacturer: manufacturer?.trim(),
      category: category || 'Other',
      sellingPrice: parseFloat(sellingPrice),
      reorderLevel: parseInt(reorderLevel) || 10,
      prices: prices || {
        BRITAM: 0,
        NSSF: 0,
        NHIF: 0,
        ASSEMBLE: 0,
        Pharmacy: parseFloat(sellingPrice),
        HospitalShop: 0
      }
    });
    
    res.status(201).json({
      status: 'success',
      message: 'Medicine created successfully',
      data: medicine
    });
  } catch (error) {
    logger.error('Create medicine error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        status: 'error',
        message: 'Medicine with this combination already exists'
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Update medicine
// @route   PUT /api/medicines/:id
// @access  Private (Admin, Pharmacist)
export const updateMedicine = async (req, res) => {
  try {
    let medicine = await Medicine.findById(req.params.id);
    
    if (!medicine) {
      return res.status(404).json({
        status: 'error',
        message: 'Medicine not found'
      });
    }
    
    // Check if updating to existing medicine
    if (req.body.name || req.body.type || req.body.strength !== undefined) {
      const checkName = req.body.name || medicine.name;
      const checkType = req.body.type || medicine.type;
      const checkStrength = req.body.strength !== undefined ? req.body.strength : medicine.strength;
      
      const existingMedicine = await Medicine.findOne({
        name: checkName,
        type: checkType,
        strength: checkStrength,
        _id: { $ne: req.params.id }
      });
      
      if (existingMedicine) {
        return res.status(400).json({
          status: 'error',
          message: 'Another medicine with this name, type, and strength already exists'
        });
      }
    }
    
    medicine = await Medicine.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Medicine updated successfully',
      data: medicine
    });
  } catch (error) {
    logger.error('Update medicine error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        status: 'error',
        message: 'Medicine with this combination already exists'
      });
    }
    
    res.status(500).json({
      status: 'error',
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Delete medicine
// @route   DELETE /api/medicines/:id
// @access  Private (Admin, Pharmacist)
export const deleteMedicine = async (req, res) => {
  try {
    const medicine = await Medicine.findById(req.params.id);
    
    if (!medicine) {
      return res.status(404).json({
        status: 'error',
        message: 'Medicine not found'
      });
    }
    
    await medicine.deleteOne();
    
    res.status(200).json({
      status: 'success',
      message: 'Medicine deleted successfully',
      data: {}
    });
  } catch (error) {
    logger.error('Delete medicine error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error',
      error: error.message
    });
  }
};