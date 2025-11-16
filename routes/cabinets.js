import express from 'express';
import Cabinet from '../models/Cabinet.js';
import Corpse from '../models/Corpse.js';
import logger from '../utils/logger.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

// @desc    Get all cabinets with occupancy status
// @route   GET /api/cabinets
// @access  Private (Admin, Mortuary Attendant)
router.get('/', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const cabinets = await Cabinet.find()
      .populate('occupiedBy', 'firstName lastName dateOfDeath')
      .sort({ number: 1 });
    
    res.status(200).json({ status: 'success', data: cabinets });
  } catch (error) {
    logger.error('Get cabinets error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Get available cabinets
// @route   GET /api/cabinets/available
// @access  Private (Admin, Mortuary Attendant)
router.get('/available', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const availableCabinets = await Cabinet.find({
      isOccupied: false,
      status: 'Active'
    }).sort({ number: 1 });
    
    res.status(200).json({ 
      status: 'success', 
      data: availableCabinets 
    });
  } catch (error) {
    logger.error('Get available cabinets error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Get cabinet statistics
// @route   GET /api/cabinets/stats
// @access  Private (Admin, Mortuary Attendant)
router.get('/stats', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const totalCabinets = await Cabinet.countDocuments();
    const occupiedCabinets = await Cabinet.countDocuments({ isOccupied: true });
    const availableCabinets = await Cabinet.countDocuments({ 
      isOccupied: false, 
      status: 'Active' 
    });
    const maintenanceCabinets = await Cabinet.countDocuments({ 
      status: 'Maintenance' 
    });
    const outOfServiceCabinets = await Cabinet.countDocuments({
      status: 'Out of Service'
    });
    
    const stats = {
      total: totalCabinets,
      occupied: occupiedCabinets,
      available: availableCabinets,
      maintenance: maintenanceCabinets,
      outOfService: outOfServiceCabinets,
      occupancyRate: totalCabinets > 0 ? ((occupiedCabinets / totalCabinets) * 100).toFixed(1) : 0
    };
    
    res.status(200).json({ 
      status: 'success', 
      data: stats 
    });
  } catch (error) {
    logger.error('Get cabinet stats error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Create a new cabinet
// @route   POST /api/cabinets
// @access  Private (Admin)
router.post('/', authorize('admin'), async (req, res) => {
  try {
    const cabinet = await Cabinet.create(req.body);
    res.status(201).json({ 
      status: 'success', 
      data: cabinet 
    });
  } catch (error) {
    logger.error('Create cabinet error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Cabinet number already exists' 
      });
    }
    res.status(400).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// @desc    Assign corpse to cabinet (automated)
// @route   POST /api/cabinets/assign
// @access  Private (Admin, Mortuary Attendant)
router.post('/assign', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const { corpseId, cabinetNumber } = req.body;
    
    // Find available cabinet (auto-assign if no specific cabinet requested)
    let cabinet;
    if (cabinetNumber) {
      cabinet = await Cabinet.findOne({ 
        number: cabinetNumber, 
        isOccupied: false, 
        status: 'Active' 
      });
      if (!cabinet) {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Specified cabinet is not available' 
        });
      }
    } else {
      // Auto-assign to first available cabinet
      cabinet = await Cabinet.findOne({ 
        isOccupied: false, 
        status: 'Active' 
      }).sort({ number: 1 });
      
      if (!cabinet) {
        return res.status(400).json({ 
          status: 'error', 
          message: 'No available cabinets' 
        });
      }
    }
    
    // Update cabinet
    cabinet.isOccupied = true;
    cabinet.occupiedBy = corpseId;
    await cabinet.save();
    
    // Update corpse record
    await Corpse.findByIdAndUpdate(corpseId, { 
      cabinetNumber: cabinet.number 
    });
    
    await cabinet.populate('occupiedBy', 'firstName lastName');
    
    res.status(200).json({ 
      status: 'success', 
      data: cabinet,
      message: `Corpse assigned to cabinet ${cabinet.number}` 
    });
  } catch (error) {
    logger.error('Cabinet assignment error:', error);
    res.status(400).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// @desc    Release cabinet (when corpse is released)
// @route   POST /api/cabinets/:id/release
// @access  Private (Admin, Mortuary Attendant)
router.post('/:id/release', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const cabinet = await Cabinet.findById(req.params.id);
    
    if (!cabinet) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Cabinet not found' 
      });
    }
    
    if (!cabinet.isOccupied) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Cabinet is not occupied' 
      });
    }
    
    // Release cabinet
    cabinet.isOccupied = false;
    cabinet.occupiedBy = null;
    await cabinet.save();
    
    res.status(200).json({ 
      status: 'success', 
      data: cabinet,
      message: `Cabinet ${cabinet.number} has been released` 
    });
  } catch (error) {
    logger.error('Cabinet release error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Update cabinet (maintenance, status, etc.)
// @route   PUT /api/cabinets/:id
// @access  Private (Admin)
router.put('/:id', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const cabinet = await Cabinet.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      { new: true, runValidators: true }
    );
    
    if (!cabinet) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Cabinet not found' 
      });
    }
    
    res.status(200).json({ 
      status: 'success', 
      data: cabinet 
    });
  } catch (error) {
    logger.error('Update cabinet error:', error);
    res.status(400).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// @desc    Delete cabinet
// @route   DELETE /api/cabinets/:id
// @access  Private (Admin)
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const cabinet = await Cabinet.findById(req.params.id);
    
    if (!cabinet) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Cabinet not found' 
      });
    }
    
    if (cabinet.isOccupied) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Cannot delete occupied cabinet' 
      });
    }
    
    await cabinet.deleteOne();
    
    res.status(200).json({ 
      status: 'success', 
      message: 'Cabinet deleted successfully' 
    });
  } catch (error) {
    logger.error('Delete cabinet error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

export default router;