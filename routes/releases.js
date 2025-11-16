import express from 'express';
import Release from '../models/Release.js';
import Corpse from '../models/Corpse.js';
import Cabinet from '../models/Cabinet.js';
import logger from '../utils/logger.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

// @desc    Get all releases
// @route   GET /api/releases
// @access  Private (Admin, Mortuary Attendant)
router.get('/', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const releases = await Release.find()
      .populate('corpseId', 'firstName lastName dateOfDeath')
      .populate('authorizedBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .sort({ createdAt: -1 });
    
    res.status(200).json({ 
      status: 'success', 
      data: releases 
    });
  } catch (error) {
    logger.error('Get releases error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Get pending releases
// @route   GET /api/releases/pending
// @access  Private (Admin, Mortuary Attendant)
router.get('/pending', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const pendingReleases = await Release.find({ status: 'Pending' })
      .populate('corpseId', 'firstName lastName dateOfDeath')
      .populate('authorizedBy', 'firstName lastName')
      .sort({ createdAt: -1 });
    
    res.status(200).json({ 
      status: 'success', 
      data: pendingReleases 
    });
  } catch (error) {
    logger.error('Get pending releases error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Create release request
// @route   POST /api/releases
// @access  Private (Admin, Mortuary Attendant)
router.post('/', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const { corpseId } = req.body;
    
    // Check if corpse exists and is available for release
    const corpse = await Corpse.findById(corpseId);
    if (!corpse) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Corpse not found' 
      });
    }
    
    if (corpse.status === 'Released') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Corpse has already been released' 
      });
    }
    
    // Check if there's already a pending release
    const existingRelease = await Release.findOne({ 
      corpseId, 
      status: { $in: ['Pending', 'Approved'] } 
    });
    
    if (existingRelease) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Release request already exists for this corpse' 
      });
    }
    
    const release = await Release.create({
      ...req.body,
      authorizedBy: req.user.id
    });
    
    await release.populate([
      { path: 'corpseId', select: 'firstName lastName dateOfDeath' },
      { path: 'authorizedBy', select: 'firstName lastName' }
    ]);
    
    res.status(201).json({ 
      status: 'success', 
      data: release 
    });
  } catch (error) {
    logger.error('Create release error:', error);
    res.status(400).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// @desc    Get single release
// @route   GET /api/releases/:id
// @access  Private (Admin, Mortuary Attendant)
router.get('/:id', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const release = await Release.findById(req.params.id)
      .populate('corpseId', 'firstName lastName dateOfDeath cabinetNumber')
      .populate('authorizedBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName');
    
    if (!release) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Release not found' 
      });
    }
    
    res.status(200).json({ 
      status: 'success', 
      data: release 
    });
  } catch (error) {
    logger.error('Get release error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Update release
// @route   PUT /api/releases/:id
// @access  Private (Admin, Mortuary Attendant)
router.put('/:id', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const release = await Release.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate([
      { path: 'corpseId', select: 'firstName lastName dateOfDeath' },
      { path: 'authorizedBy', select: 'firstName lastName' },
      { path: 'approvedBy', select: 'firstName lastName' }
    ]);
    
    if (!release) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Release not found' 
      });
    }

    const corpse = await Corpse.findById(release.corpseId);
    if (corpse && corpse.cabinetNumber) {
      const cabinet = await Cabinet.findOne({ number: corpse.cabinetNumber });

      if (cabinet) {
        cabinet.isOccupied = false;
        cabinet.occupiedBy = null;
        await cabinet.save();
      } else {
        logger.warn(`Cabinet ${corpse.cabinetNumber} not found for release.`);
      }
    }
    
    res.status(200).json({ 
      status: 'success', 
      data: release 
    });
  } catch (error) {
    logger.error('Update release error:', error);
    res.status(400).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// @desc    Approve release
// @route   POST /api/releases/:id/approve
// @access  Private (Admin)
router.post('/:id/approve', authorize('admin'), async (req, res) => {
  try {
    const release = await Release.findById(req.params.id);
    
    if (!release) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Release not found' 
      });
    }
    
    if (release.status !== 'Pending') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Release is not pending approval' 
      });
    }
    
    release.status = 'Approved';
    release.approvedBy = req.user.id;
    release.approvalDate = new Date();
    await release.save();
    
    await release.populate([
      { path: 'corpseId', select: 'firstName lastName dateOfDeath' },
      { path: 'authorizedBy', select: 'firstName lastName' },
      { path: 'approvedBy', select: 'firstName lastName' }
    ]);
    
    res.status(200).json({ 
      status: 'success', 
      data: release,
      message: 'Release approved successfully' 
    });
  } catch (error) {
    logger.error('Approve release error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Complete release (mark as released)
// @route   POST /api/releases/:id/complete
// @access  Private (Admin, Mortuary Attendant)
router.post('/:id/complete', authorize('admin', 'mortuary_attendant'), async (req, res) => {
  try {
    const release = await Release.findById(req.params.id);
    
    if (!release) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Release not found' 
      });
    }
    
    if (release.status !== 'Approved') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Release must be approved before completion' 
      });
    }
    
    // Update release status
    release.status = 'Released';
    await release.save();
    
    // Update corpse status
    const corpse = await Corpse.findByIdAndUpdate(
      release.corpseId,
      { status: 'Released' },
      { new: true }
    );
    
    // Release cabinet if assigned
    if (corpse && corpse.cabinetNumber) {
      await Cabinet.findOneAndUpdate(
        { number: corpse.cabinetNumber },
        { 
          isOccupied: false, 
          occupiedBy: null 
        }
      );
    }
    
    await release.populate([
      { path: 'corpseId', select: 'firstName lastName dateOfDeath' },
      { path: 'authorizedBy', select: 'firstName lastName' },
      { path: 'approvedBy', select: 'firstName lastName' }
    ]);
    
    res.status(200).json({ 
      status: 'success', 
      data: release,
      message: 'Release completed successfully' 
    });
  } catch (error) {
    logger.error('Complete release error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

// @desc    Cancel release
// @route   POST /api/releases/:id/cancel
// @access  Private (Admin)
router.post('/:id/cancel', authorize('admin'), async (req, res) => {
  try {
    const { reason } = req.body;
    
    const release = await Release.findById(req.params.id);
    
    if (!release) {
      return res.status(404).json({ 
        status: 'error', 
        message: 'Release not found' 
      });
    }
    
    if (release.status === 'Released') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Cannot cancel completed release' 
      });
    }
    
    release.status = 'Cancelled';
    release.releaseNotes = reason || 'Release cancelled';
    await release.save();
    
    await release.populate([
      { path: 'corpseId', select: 'firstName lastName dateOfDeath' },
      { path: 'authorizedBy', select: 'firstName lastName' },
      { path: 'approvedBy', select: 'firstName lastName' }
    ]);
    
    res.status(200).json({ 
      status: 'success', 
      data: release,
      message: 'Release cancelled successfully' 
    });
  } catch (error) {
    logger.error('Cancel release error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Server Error' 
    });
  }
});

export default router;