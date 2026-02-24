import express from 'express';
import mongoose from 'mongoose';
import Visit from '../models/Visit.js';
import Patient from '../models/Patient.js';
import Service from '../models/Service.js';
import Invoice from '../models/Invoice.js';
import { protect, authorize } from '../middleware/auth.js';
import { checkPaymentEligibility } from '../middleware/paymentEligibility.js';
import billingService from '../services/billingService.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// @desc    Get all active visits
// @route   GET /api/visits
router.get('/', authorize('admin', 'doctor', 'receptionist'), async (req, res) => {
    try {
        const { search } = req.query;
        const query = { isActive: true };

        if (req.user.role === 'doctor') {
            query.doctor = req.user.id;
        }

        let visits;
        if (search) {
            const patientSearchRegex = new RegExp(search, 'i');
            const matchingPatients = await Patient.find({
                $or: [
                    { firstName: { $regex: patientSearchRegex } },
                    { lastName: { $regex: patientSearchRegex } }
                ]
            }).select('_id');

            query.patient = { $in: matchingPatients.map(p => p._id) };
        }

        visits = await Visit.find(query)
            .populate('patient', 'firstName lastName fullName') 
            .populate('doctor', 'firstName lastName fullName')
            .sort({ visitDate: -1 });

        res.status(200).json({ status: 'success', data: visits });
    } catch (error) {
        logger.error('Get visits error:', error);
        res.status(500).json({ status: 'error', message: 'Server Error' });
    }
});

// @desc    Get a single visit by ID
// @route   GET /api/visits/:id
router.get('/:id', authorize('admin', 'doctor', 'receptionist'), async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id)
            .populate('patient')
            .populate('doctor')
            .populate('invoice');
        
        if (!visit) {
            return res.status(404).json({ status: 'error', message: 'Visit not found' });
        }
        
        res.status(200).json({ status: 'success', data: visit });
    } catch (error) {
        logger.error('Get single visit error:', error);
        res.status(500).json({ status: 'error', message: 'Server Error' });
    }
});

// @desc    Create a new visit with invoice (CENTRALIZED)
// @route   POST /api/visits
// @access  Private (Admin, Receptionist)
router.post('/', authorize('admin', 'receptionist'), async (req, res) => {
  try {
    const { patientId, doctorId, visitDate, reason, type } = req.body;
    
    // Check for active visit
    const activeVisit = await Visit.findOne({ 
      patient: patientId, 
      isActive: true
    });
    if (activeVisit) {
      return res.status(400).json({
        status: 'error',
        message: 'Patient already has an active visit'
      });
    }

    // Fetch patient
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({
        status: 'error',
        message: 'Patient not found'
      });
    }

    const hasInsurance = !!(patient.insurance?.provider);
    const visitStatus = hasInsurance ? 'In Queue' : 'Pending Payment';
    
    // Create visit
    const newVisit = new Visit({
      patient: patientId,
      doctor: doctorId,
      visitDate,
      reason,
      status: visitStatus,
      type,
      startedBy: req.user.id,
    });
    const visit = await newVisit.save();

    // === USE CENTRALIZED BILLING SERVICE ===
    // Look up consultation service
    const consultationService = await Service.findOne({
        name: 'Consultation fees',
        category: 'Consultation'
    });

    if (consultationService) {
      // Create invoice via billingService (CENTRALIZED)
      // This will check for duplicates automatically
      const invoice = await billingService.createInvoice({
        patient: patientId,
        visit: visit._id,
        items: [{
          type: 'consultation',
          description: consultationService.name,
          quantity: 1,
          unitPrice: consultationService.price,
          total: consultationService.price
        }],
        paymentTerms: 'immediate'
      }, req.user.id);

      // Link invoice to visit (billingService does this too, but be explicit)
      visit.invoice = invoice._id;
      visit.consultationFeeAmount = consultationService.price;
      visit.consultationFeePaid = hasInsurance;
      await visit.save();

      logger.info(`Visit ${visit.visitId} created with invoice ${invoice.invoiceNumber}`);
    }

    res.status(201).json({
      status: 'success',
      data: visit,
      message: hasInsurance ? 
        'Visit created. Consultation fee covered by insurance.' :
        'Visit created. Payment required before services can be ordered.'
    });
  } catch (error) {
    logger.error('Create visit error:', error);
    res.status(400).json({ status: 'error', message: error.message });
  }
});

// @desc    Add lab order to invoice (CENTRALIZED)
// @route   POST /api/visits/:id/lab-orders
router.post('/:id/lab-orders', 
  authorize('admin', 'doctor'), 
  checkPaymentEligibility,
  async (req, res) => {
    try {
      const visit = req.visit;
      const hasInsurance = req.hasInsurance;
      const { testName, notes } = req.body;

      // Look up service
      const service = await Service.findOne({ 
        name: testName,
        category: 'Lab Test'
      });

      // Determine initial status based on insurance
      const initialStatus = hasInsurance ? 'Pending' : 'Pending Payment';

      // Add to visit (clinical tracking)
      const newLabOrder = {
        testName,
        notes,
        patient: visit.patient._id,
        orderedBy: req.user.id,
        status: initialStatus
      };
      visit.labOrders.push(newLabOrder);
      await visit.save();

      // === USE CENTRALIZED BILLING SERVICE ===
      // Add to invoice via billingService
      if (visit.invoice && service) {
        await billingService.addItemsToInvoice(
          visit.invoice,
          [{
            type: 'lab_test',
            description: testName,
            quantity: 1,
            unitPrice: service.price,
            total: service.price,
            notes
          }],
          hasInsurance
        );

        logger.info(`Lab test added to invoice for visit ${visit.visitId}`);
      }

      res.status(201).json({ 
        status: 'success', 
        data: newLabOrder,
        message: hasInsurance ? 
          'Lab test ordered and ready for processing.' :
          'Lab test ordered. Payment required before test can be performed.',
        priceInfo: service ? {
          service: testName,
          price: service.price,
          coveredByInsurance: hasInsurance
        } : null
      });
    } catch (error) {
      logger.error('Add lab order error:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
});

// @desc    Add radiology order to invoice (CENTRALIZED)
// @route   POST /api/visits/:id/radiology-orders
router.post('/:id/radiology-orders', 
  authorize('admin', 'doctor'), 
  checkPaymentEligibility,
  async (req, res) => {
    try {
      const visit = req.visit;
      const hasInsurance = req.hasInsurance;
      const { orderData } = req.body;
      const { scanType, bodyPart, reason } = orderData;

      // Look up service
      const service = await Service.findOne({ 
        name: scanType,
        category: 'Imaging'
      });

      // Determine initial status based on insurance
      const initialStatus = hasInsurance ? 'Pending' : 'Pending Payment';

      // Add to visit (clinical tracking)
      const newRadiologyOrder = {
        scanType,
        bodyPart,
        reason,
        patient: visit.patient._id,
        orderedBy: req.user.id,
        status: initialStatus
      };
      
      if (!visit.radiologyOrders) {
        visit.radiologyOrders = [];
      }
      
      visit.radiologyOrders.push(newRadiologyOrder);
      await visit.save();

      // === USE CENTRALIZED BILLING SERVICE ===
      // Add to invoice via billingService
      if (visit.invoice && service) {
        await billingService.addItemsToInvoice(
          visit.invoice,
          [{
            type: 'imaging',
            description: `${scanType} - ${bodyPart}`,
            quantity: 1,
            unitPrice: service.price,
            total: service.price,
            notes: reason
          }],
          hasInsurance
        );

        logger.info(`Radiology order added to invoice for visit ${visit.visitId}`);
      }

      res.status(201).json({ 
        status: 'success', 
        data: newRadiologyOrder,
        message: hasInsurance ? 
          'Radiology order created and ready for processing.' :
          'Radiology order created. Payment required before scan can be performed.',
        priceInfo: service ? {
          service: scanType,
          price: service.price,
          coveredByInsurance: hasInsurance
        } : null
      });
    } catch (error) {
      logger.error('Add radiology order error:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
});

// @desc    Add prescription to invoice (Medicine + ItemPrice based on Insurance)
// @route   POST /api/visits/:id/prescriptions
router.post('/:id/prescriptions', 
  authorize('admin', 'doctor'),
  checkPaymentEligibility,
  async (req, res) => {
    try {
      const visit = req.visit;
      const hasInsurance = req.hasInsurance;
      const { medication, type: medicineType, dosage, frequency, duration } = req.body;

      // Step 1: Check if medication exists in Medicine model
      const Medicine = mongoose.model('Medicine');

        // Build query explicitly
        const medicineQuery = { 
          name: { $regex: new RegExp(`^${medication}$`, 'i') }
        };
        
        if (medicineType) {
          medicineQuery.type = medicineType;
        }
        
        const medicineItem = await Medicine.findOne(medicineQuery);

      if (!medicineItem) {
        return res.status(404).json({
          status: 'error',
          message: `Medication "${medication}" not found in inventory`
        });
      }

      // Step 2: Get patient's insurance provider
      const patient = await Patient.findById(visit.patient._id)
        .populate('insurance.provider', 'name');
      
      const insuranceProviderName = patient?.insurance?.provider?.name;

      // Step 3: Fetch price from ItemPrice model based on insurance
      const ItemPrice = mongoose.model('ItemPrice');
      const itemPrice = await ItemPrice.findOne({ 
        name: { $regex: new RegExp(`^${medicineItem.name}$`, 'i') } 
      });

      let price = 0;
      let priceSource = 'Not Found';

      if (itemPrice) {
        if (hasInsurance && insuranceProviderName && itemPrice.prices[insuranceProviderName]) {
          // Use insurance-specific price (e.g., NHIF, NSSF, BRITAM, ASSEMBLE)
          price = itemPrice.prices[insuranceProviderName];
          priceSource = insuranceProviderName;
        } else if (itemPrice.prices.Pharmacy) {
          // Use Pharmacy price for cash patients or if insurance price not available
          price = itemPrice.prices.Pharmacy;
          priceSource = 'Pharmacy (Cash)';
        } else {
          // Fallback to Medicine model selling price
          price = medicineItem.sellingPrice || 0;
          priceSource = 'Medicine Model';
        }
      } else {
        // ItemPrice not found, use Medicine model selling price
        price = medicineItem.sellingPrice || 0;
        priceSource = 'Medicine Model (No ItemPrice)';
      }

      if (price <= 0) {
        return res.status(400).json({
          status: 'error',
          message: `No price configured for medication "${medication}" with insurance provider "${insuranceProviderName || 'Cash'}"`
        });
      }

      // Determine initial status based on insurance
      const initialStatus = hasInsurance ? 'Pending' : 'Pending Payment';

      // Step 4: Add to visit (clinical tracking)
      const newPrescription = {
        medication: medicineItem.name,
        dosage,
        frequency,
        duration,
        patient: visit.patient._id,
        prescribedBy: req.user.id,
        status: initialStatus
      };
      visit.prescriptions.push(newPrescription);
      await visit.save();

      // Step 5: Add to invoice via billingService
      if (visit.invoice) {
        await billingService.addItemsToInvoice(
          visit.invoice,
          [{
            type: 'medication',
            description: `${medicineItem.name} - ${dosage}, ${frequency}`,
            quantity: 1,
            unitPrice: price,
            total: price,
            notes: duration,
            insuranceProvider: insuranceProviderName || 'Cash'
          }],
          hasInsurance
        );

        logger.info(
          `Medication "${medicineItem.name}" added to invoice for visit ${visit.visitId}. ` +
          `Price: ${price} (Source: ${priceSource})`
        );
      }

      res.status(201).json({ 
        status: 'success', 
        data: newPrescription,
        message: hasInsurance ? 
          'Prescription added and ready for dispensing.' :
          'Prescription added. Payment required before medication can be dispensed.',
        priceInfo: {
          medication: medicineItem.name,
          price: price,
          priceSource: priceSource,
          coveredByInsurance: hasInsurance,
          insuranceProvider: insuranceProviderName || 'Cash'
        }
      });
    } catch (error) {
      logger.error('Add prescription error:', error);
      res.status(400).json({ 
        status: 'error', 
        message: error.message 
      });
    }
});

// @desc    Update payment status (consultation fee paid)
// @route   PATCH /api/visits/:id/payment-status
router.patch('/:id/payment-status', 
  authorize('admin', 'receptionist'), 
  async (req, res) => {
    try {
      const visit = await Visit.findById(req.params.id)
        .populate('patient')
        .populate('invoice');

      if (!visit) {
        return res.status(404).json({
          status: 'error',
          message: 'Visit not found'
        });
      }

      if (!visit.invoice) {
        return res.status(400).json({
          status: 'error',
          message: 'No invoice found for this visit'
        });
      }

      const invoice = await Invoice.findById(visit.invoice);
      
      if (!invoice) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice not found'
        });
      }

      // Check if consultation item is paid
      const consultationItem = invoice.items.find(item => item.type === 'consultation');
      
      if (consultationItem && consultationItem.paid) {
        // Consultation fee is paid, move to queue
        visit.status = 'In Queue';
        visit.consultationFeePaid = true;
        await visit.save();

        return res.status(200).json({
          status: 'success',
          message: 'Payment confirmed. Visit moved to queue.',
          data: visit
        });
      }

      res.status(400).json({
        status: 'error',
        message: 'Consultation fee has not been paid yet'
      });
    } catch (error) {
      logger.error('Update payment status error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server Error'
      });
    }
});

// @desc    Add a diagnosis to a visit
// @route   POST /api/visits/:id/diagnosis
router.post('/:id/diagnosis', authorize('admin', 'doctor'), async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id);
        if (!visit) {
            return res.status(404).json({ status: 'error', message: 'Visit not found' });
        }

        const { condition, icd10Code, notes } = req.body;

        const newDiagnosis = {
            condition,
            icd10Code,
            notes,
            patient: visit.patient._id,
            diagnosedBy: req.user.id,
        };

        visit.diagnosis.push(newDiagnosis);
        await visit.save();

        res.status(201).json({ status: 'success', data: newDiagnosis });
    } catch (error) {
        logger.error('Add diagnosis error:', error);
        res.status(400).json({ status: 'error', message: error.message });
    }
});

// @desc    End a visit
// @route   PATCH /api/visits/:id/end-visit
router.patch('/:id/end-visit', authorize('admin', 'receptionist'), async (req, res) => {
    try {
        const visit = await Visit.findById(req.params.id);
        if (!visit) {
            return res.status(404).json({
                status: 'error',
                message: 'Visit not found'
            });
        }

        visit.isActive = !visit.isActive;
        await visit.save();

        res.status(200).json({
            status: 'success',
            message: `Visit ended successfully`
        });
    } catch (error) {
        logger.error('Ending visit error', error);
        res.status(500).json({
            status: 'error',
            message: 'Server Error'
        });
    }
});

export default router;