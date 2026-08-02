import express from 'express';
import { body, validationResult } from 'express-validator';
import Patient from '../models/Patient.js';
import TheatreProcedure from '../models/TheatreProcedure.js';
import Theatre from '../models/Theatre.js';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.get('/', protect, authorize('admin', 'surgeon', 'doctor'), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const startIndex = (page - 1) * limit;

        const query = { isActive: true };

        // Filter by patient if provided
        if (req.query.patient) {
            query.patient = req.query.patient;
        }
        
        // Filter by ward if provided
        if (req.query.theatre) {
            query.theatre = req.query.theatre;
        }
        
        // Filter by status if provided
        if (req.query.status) {
            query.status = req.query.status;
        }
    
        // Filter by admission type if provided
        if (req.query.procedure_type) {
            query.procedure_type = req.query.procedure_type;
        }
    
        // Filter by date range
        if (req.query.startDate && req.query.endDate) {
            query.admissionDate = {
            $gte: new Date(req.query.startDate),
            $lte: new Date(req.query.endDate)
            };
        }
    
        const total = await TheatreProcedure.countDocuments(query);
        const procedures = await TheatreProcedure.find(query)
            .populate('patient', 'firstName lastName patientId email phone dateOfBirth gender')
            .populate('theatre', 'name theatreNumber type floor')
            .populate('surgeon', 'firstName lastName email')
            .populate('anesthesiologist', 'name')
            .skip(startIndex)
            .limit(limit)
            .sort({ procedure_date: -1 });
    
        res.status(200).json({
            status: 'success',
            count: procedures.length,
            total,
            pagination: {
                page,
                limit,
                pages: Math.ceil(total / limit)
            },
            data: procedures
        });
    } catch (error) {
        logger.error('Get theatre procedures error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Server error'
        });
    }
});

router.get('/:id', protect, authorize('admin', 'surgeon'), async (req, res) => {
    try {
        const procedure = await TheatreProcedure.findById(req.params.id)
            .populate('patient', 'firstName lastName patientId email phone dateOfBirth gender bloodType')
            .populate('theatre', 'name theatreNumber type floor')
            .populate('surgeon', 'firstName lastName email')
            .populate('anesthesiologist', 'name')
        
        if (!procedure) {
            return res.status(404).json({
                status: 'error',
                message: 'Theatre procedure not found'
            });
        }

        res.status(200).json({
            status: 'error',
            data: procedure
        });
    } catch (error) {
        logger.error('Get theatre procedure error', error);
        res.status(500).json({
            status: 'error',
            message: 'Server error'
        });
    }
});

router.post('/', protect, authorize('admin', 'doctor'), [ 
    body('patient').notEmpty().withMessage('Patient is required'),
    body('theatre').notEmpty().withMessage('Theatre room is required'),
    body('surgeon').notEmpty().withMessage('Surgeon is required'),
    // body('procedure_type').notEmpty().withMessage('Procedure_type is required'),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                status: 'error',
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const patient = await Patient.findById(req.body.patient);
        if (!patient) {
            return res.status(404).json({
                status: 'error',
                message: 'Patient not found'
            });
        }

        const theatre = await Theatre.findById(req.body.theatre);
        if (!theatre) {
            return res.status(404).json({
                status: 'error',
                message: 'Theatre room not found'
            });
        }

        if (theatre.status !== 'active') {
            return res.status(400).json({
                status: 'error',
                message: `Theatre room is not available. Current status: ${theatre.status}`
            });
        }

        const existingProcedure = await TheatreProcedure.findOne({
            patient: req.body.patient,
            status: { $in: ['scheduled', 'on-going'] }
        });

        if (existingProcedure) {
            return res.status(400).json({
                status: 'error',
                message: 'Patient already has a scheduled theatre procedure'
            });
        }

        const theatreProcedure = await TheatreProcedure.create(req.body);

        theatre.status = 'inactive';
        await theatre.save();

        patient.status = 'active';
        await patient.save();

        const populatedProcedure = await TheatreProcedure.findById(theatreProcedure._id)
            .populate('patient', 'firstName lastName patientId')
            .populate('theatre', 'name theatreNumber')
            .populate('surgeon', 'firstName lastName');
        
        res.status(201).json({
            status: 'success',
            message: 'Patient theatre procedure scheduled succesfully',
            data: populatedProcedure
        });
    } catch (error) {
        logger.error('Create theatre procedure error', error);
        res.status(500).json({
            status: 'error',
            message: 'Server error'
        });
    }
});

router.put('/:id', protect, authorize('admin', 'surgeon'), async (req, res) => {
    try {
        let procedure = await TheatreProcedure.findById(req.params.id);

        if (!procedure) {
            return res.status(404).json({
                status: 'error',
                message: 'Theatre procedure not found'
            });
        }

        if (procedure.status === 'completed' && req.body.status !== 'completed') {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot update completed theatre procedure'
            });
        }

        procedure = await TheatreProcedure.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        }).populate('patient theatre surgeon anesthesiologist procedure_type priority');

        res.status(200).json({
            status: 'success',
            data: procedure
        });
    } catch (error) {
        logger.error('Update theatre procedure error', error);
        res.status(500).json({
            status: 'error',
            message: 'Server error'
        });
    }
});

router.delete('/:id', protect, authorize('admin'), async (req, res) => {
    try {
        const procedure = await TheatreProcedure.findById(req.params.id);

        if (!procedure) {
            return res.status(404).json({
                status: 'error',
                message: 'Theatre procedure not found'
            });
        }

        await procedure.deleteOne();

        res.status(200).json({
            status: 'success',
            message: 'Theatre procedure deleted successfully'
        });
    } catch (error) {
        logger.error('Delete theatre procedure error');
        res.status(500).json({
            status: 'error',
            message: 'Server error'
        });
    }
});

// @desc    Record a medication administered for a procedure
// @route   POST /api/theatre-procedures/:id/medications
// @access  Private (admin, surgeon, doctor, nurse)
router.post(
  '/:id/medications',
  protect,
  authorize('admin', 'surgeon', 'doctor', 'nurse'),
  async (req, res) => {
    try {
      const { medication, dosage, frequency, startDate, endDate, notes } = req.body;

      if (!medication) {
        return res.status(400).json({
          status: 'error',
          message: 'Medication name is required'
        });
      }

      const procedure = await TheatreProcedure.findById(req.params.id);

      if (!procedure) {
        return res.status(404).json({
          status: 'error',
          message: 'Theatre procedure not found'
        });
      }

      procedure.medications.push({
        medication,
        dosage,
        frequency,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        notes,
        recordedBy: req.user._id
      });

      await procedure.save();

      res.status(201).json({
        status: 'success',
        message: 'Medication recorded successfully',
        data: procedure.medications[procedure.medications.length - 1]
      });
    } catch (error) {
      logger.error('Add theatre procedure medication error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error'
      });
    }
  }
);

// @desc    Record a diagnosis against a procedure
// @route   POST /api/theatre-procedures/:id/diagnosis
// @access  Private (admin, surgeon, doctor)
router.post(
  '/:id/diagnosis',
  protect,
  authorize('admin', 'surgeon', 'doctor'),
  async (req, res) => {
    try {
      const { condition, notes } = req.body;

      if (!condition) {
        return res.status(400).json({
          status: 'error',
          message: 'Condition is required'
        });
      }

      const procedure = await TheatreProcedure.findById(req.params.id);

      if (!procedure) {
        return res.status(404).json({
          status: 'error',
          message: 'Theatre procedure not found'
        });
      }

      procedure.diagnoses.push({
        condition,
        notes,
        recordedBy: req.user._id
      });

      await procedure.save();

      res.status(201).json({
        status: 'success',
        message: 'Diagnosis recorded successfully',
        data: procedure.diagnoses[procedure.diagnoses.length - 1]
      });
    } catch (error) {
      logger.error('Add theatre procedure diagnosis error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error'
      });
    }
  }
);

// @desc    Complete a procedure
// @route   PUT /api/theatre-procedures/:id/discharge
// @access  Private (admin, surgeon)
router.put(
  '/:id/discharge',
  protect,
  authorize('admin', 'surgeon'),
  async (req, res) => {
    try {
      const { dischargeReason, dischargeSummary } = req.body;

      const procedure = await TheatreProcedure.findById(req.params.id);

      if (!procedure) {
        return res.status(404).json({
          status: 'error',
          message: 'Theatre procedure not found'
        });
      }

      if (procedure.status === 'completed') {
        return res.status(400).json({
          status: 'error',
          message: 'This procedure has already been completed'
        });
      }

      procedure.status = 'completed';
      procedure.completion = {
        reason: dischargeReason || 'recovered',
        summary: dischargeSummary,
        completedBy: req.user._id,
        completedAt: new Date()
      };

      await procedure.save();

      logger.info(
        `Theatre procedure ${procedure.procedureNumber} completed by ${req.user._id}`
      );

      res.status(200).json({
        status: 'success',
        message: 'Procedure completed successfully',
        data: procedure
      });
    } catch (error) {
      logger.error('Complete theatre procedure error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error'
      });
    }
  }
);

export default router;