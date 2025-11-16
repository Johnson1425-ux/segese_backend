import express from 'express';
import Corpse from '../models/Corpse.js';
import Cabinet from '../models/Cabinet.js';
import logger from '../utils/logger.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

// @desc    Get all corpses
// @route   GET /api/corpses
// @access  Private (Admin, Mortuary Attendant)
router.get('/', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const corpses = await Corpse.find().populate('registeredBy', 'firstName lastName');
    res.status(200).json({ 
      status: 'success', 
      data: corpses 
    });
  } catch (error) {
    logger.error('Get corpses error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Register a new corpse with automatic cabinet assignment
// @route   POST /api/corpses
// @access  Private (Admin, Mortuary Attendant)
router.post('/', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const { firstName, middleName, lastName, sex, dateOfBirth, dateOfDeath, causeOfDeath, cabinetNumber, nextOfKin } = req.body;

    // If specific cabinet requested, check availability
    let assignedCabinet = null;
    if (cabinetNumber) {
      assignedCabinet = await Cabinet.findOne({ 
        number: cabinetNumber, 
        isOccupied: false, 
        status: 'Active' 
      });
      if (!assignedCabinet) {
        return res.status(400).json({ 
          status: 'error', 
          message: `Cabinet ${cabinetNumber} is not available` 
        });
      }
    } else {
      // Auto-assign to first available cabinet
      assignedCabinet = await Cabinet.findOne({ 
        isOccupied: false, 
        status: 'Active' 
      }).sort({ number: 1 });

      if (!assignedCabinet) {
        logger.warn('No available cabinets for new corpse registration');
      }
    }

    // Create corpse record
    const newCorpse = await Corpse.create({
      firstName,
      middleName,
      lastName,
      sex,
      dateOfBirth,
      dateOfDeath,
      causeOfDeath,
      cabinetNumber: assignedCabinet ? assignedCabinet.number : null,
      nextOfKin,
      registeredBy: req.user.id,
    });

    // Update cabinet if assigned
    if (assignedCabinet) {
      assignedCabinet.isOccupied = true;
      assignedCabinet.occupiedBy = newCorpse._id;
      await assignedCabinet.save();
    }

    res.status(201).json({ 
      status: 'success', 
      data: newCorpse,
      message: assignedCabinet ? `Corpse registered and assigned to cabinet ${assignedCabinet.number}` : 'Corpse registered (no cabinet available)'
    });
  } catch (error) {
    logger.error('Corpse registration error:', error);
    res.status(400).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// @desc    Get a single corpse by ID
// @route   GET /api/corpses/:id
// @access  Private (Admin, Mortuary Attendant)
router.get('/:id', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const corpse = await Corpse.findById(req.params.id).populate('registeredBy', 'firstName lastName');
    if (!corpse) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Corpse not found' 
      });
    }
    res.status(200).json({ 
      status: 'success', 
      data: corpse 
    });
  } catch (error) {
    logger.error('Get corpse by ID error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Update corpse information (with cabinet management)
// @route   PUT /api/corpses/:id
// @access  Private (Admin, Mortuary Attendant)
router.put('/:id', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const corpse = await Corpse.findById(req.params.id);
    if (!corpse) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Corpse not found' 
      });
    }

    const oldCabinetNumber = corpse.cabinetNumber;
    const newCabinetNumber = req.body.cabinetNumber;

    // Handle cabinet reassignment
    if (oldCabinetNumber !== newCabinetNumber) {
      // Release old cabinet
      if (oldCabinetNumber) {
        await Cabinet.findOneAndUpdate(
          { number: oldCabinetNumber },
          { isOccupied: false, occupiedBy: null }
        );
      }

      // Assign new cabinet
      if (newCabinetNumber) {
        const newCabinet = await Cabinet.findOne({ 
          number: newCabinetNumber, 
          isOccupied: false, 
          status: 'Active' 
        });
        if (!newCabinet) {
          return res.status(400).json({ 
            status: 'error', 
            message: `Cabinet ${newCabinetNumber} is not available` 
          });
        }
        newCabinet.isOccupied = true;
        newCabinet.occupiedBy = corpse._id;
        await newCabinet.save();
      }
    }

    // Update corpse record
    const updatedCorpse = await Corpse.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({ 
      status: 'success', 
      data: updatedCorpse 
    });
  } catch (error) {
    logger.error('Update corpse error:', error);
    res.status(400).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// @desc    Assign corpse to cabinet
// @route   POST /api/corpses/:id/assign-cabinet
// @access  Private (Admin, Mortuary Attendant)
router.post('/:id/assign-cabinet', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const { cabinetNumber } = req.body;
    const corpse = await Corpse.findById(req.params.id);
    
    if (!corpse) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Corpse not found' 
      });
    }

    if (corpse.cabinetNumber) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Corpse is already assigned to a cabinet' 
      });
    }

    // Find available cabinet
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
      // Auto-assign
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
    cabinet.occupiedBy = corpse._id;
    await cabinet.save();

    // Update corpse
    corpse.cabinetNumber = cabinet.number;
    await corpse.save();

    res.status(200).json({ 
      status: 'success', 
      data: corpse,
      message: `Corpse assigned to cabinet ${cabinet.number}` 
    });
  } catch (error) {
    logger.error('Cabinet assignment error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Release corpse from cabinet
// @route   POST /api/corpses/:id/release-cabinet
// @access  Private (Admin, Mortuary Attendant)
router.post('/:id/release-cabinet', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const corpse = await Corpse.findById(req.params.id);
    
    if (!corpse) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Corpse not found' 
      });
    }

    if (!corpse.cabinetNumber) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Corpse is not assigned to any cabinet' 
      });
    }

    // Release cabinet
    await Cabinet.findOneAndUpdate(
      { number: corpse.cabinetNumber },
      { isOccupied: false, occupiedBy: null }
    );

    // Update corpse
    corpse.cabinetNumber = null;
    await corpse.save();

    res.status(200).json({ 
      status: 'success', 
      data: corpse,
      message: 'Cabinet released successfully' 
    });
  } catch (error) {
    logger.error('Cabinet release error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

export default router;