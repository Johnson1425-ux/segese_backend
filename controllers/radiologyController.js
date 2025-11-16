import RadiologyRequest from '../models/RadiologyRequest.js';
import logger from '../utils/logger.js';

// @desc    Create a new radiology request
// @route   POST /api/radiology
// @access  Private (Doctor)
export const createRadiologyRequest = async (req, res) => {
  try {
    const { orderData, patient } = req.body;
    if (!orderData || !patient) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order data and patient information are required' 
    });
    }
    const request = await RadiologyRequest.create({
        bodyPart: orderData.bodyPart,
        scanType: orderData.scanType,
        reason: orderData.reason,
        patient,
        orderedBy: req.user.id
    });
    res.status(201).json({ 
        success: true, 
        data: request 
    });
  } catch (error) {
    logger.error('Create radiology request error:', error);
    res.status(400).json({ 
        success: false, 
        message: error.message 
    });
  }
};

// @desc    Get all radiology requests
// @route   GET /api/radiology
// @access  Private (Doctor, Radiologist)
export const getRadiologyRequests = async (req, res) => {
    try {
        const requests = await RadiologyRequest.find()
            .populate('patient', 'firstName lastName')
            .populate('orderedBy', 'firstName lastName');
        res.status(200).json({ 
            success: true, 
            data: requests 
        });
    } catch (error) {
        logger.error('Get radiology requests error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server Error' 
        });
    }
};

// @desc    Update a radiology request with findings
// @route   PUT /api/radiology/:id
// @access  Private (Radiologist)
export const updateRadiologyRequest = async (req, res) => {
    try {
        const { findings, imageUrl, status } = req.body;
        const request = await RadiologyRequest.findByIdAndUpdate(req.params.id, {
            findings,
            imageUrl,
            status,
            completedBy: req.user.id,
            completedAt: Date.now(),
        }, { new: true });

        if (!request) {
            return res.status(404).json({ 
                success: false, 
                message: 'Request not found' 
            });
        }
        res.status(200).json({ 
            success: true, 
            data: request 
        });
    } catch (error) {
        logger.error('Update radiology request error:', error);
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
};