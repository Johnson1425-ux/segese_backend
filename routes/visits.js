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

// @desc    Get visits — active only by default, all for reporting
// @route   GET /api/visits
// @query   isActive=all  → returns all visits (active + ended), used by reports
//          isActive=true → (default) returns only active visits
//          search        → filter by patient name
router.get('/', authorize('admin', 'doctor', 'receptionist'), async (req, res) => {
try {
const { search, isActive, startDate, endDate, page, limit } = req.query;

  // Default behaviour: only active visits (preserves existing frontend usage)
  // Reports pass ?isActive=all to get the full historical dataset
  const query = {};
  if (isActive === 'all') {
    // No isActive filter — return everything
  } else {
    query.isActive = true;
  }

  // Doctors only see their own visits (unchanged)
  if (req.user.role === 'doctor') {
    query.doctor = req.user.id;
  }

  // Date range filter (used by reports)
  if (startDate || endDate) {
    query.visitDate = {};
    if (startDate) query.visitDate.$gte = new Date(startDate);
    if (endDate)   query.visitDate.$lte = new Date(endDate);
  }

  // Patient name search (unchanged)
  if (search) {
    const patientSearchRegex = new RegExp(search, 'i');
    const matchingPatients = await Patient.find({
      $or: [
        { firstName: { $regex: patientSearchRegex } },
        { lastName:  { $regex: patientSearchRegex } }
      ]
    }).select('_id');
    query.patient = { $in: matchingPatients.map(p => p._id) };
  }

  // Pagination — optional, used by reports when fetching large datasets
  const pageNum  = parseInt(page)  || null;
  const limitNum = parseInt(limit) || null;

  let visitsQuery = Visit.find(query)
    .populate('patient', 'firstName lastName fullName dateOfBirth gender')
    .populate('doctor', 'firstName lastName fullName')
    .sort({ visitDate: -1 });

  if (pageNum && limitNum) {
    visitsQuery = visitsQuery.skip((pageNum - 1) * limitNum).limit(limitNum);
  }

  const visits = await visitsQuery;
  const total  = (pageNum && limitNum) ? await Visit.countDocuments(query) : visits.length;

  res.status(200).json({
    status: 'success',
    count: visits.length,
    total,
    data: visits
  });
} catch (error) {
  logger.error('Get visits error:', error);
  res.status(500).json({
    status: 'error',
    message: 'Server Error'
  });
}

});

// @desc    Get a single visit by ID
// @route   GET /api/visits/:id
router.get('/:id', authorize('admin', 'doctor', 'receptionist'), async (req, res) => {
try {
const User = mongoose.model('User');

  const visit = await Visit.findById(req.params.id)
    .populate('patient')
    .populate('doctor')
    .populate('invoice');
    
  if (!visit) {
    return res.status(404).json({ 
      status: 'error', 
      message: 'Visit not found' 
    });
  }

  // Convert to plain object for easier manipulation
  const visitObj = visit.toObject();

  // Collect all user IDs that need to be populated
  const userIds = new Set();
  
  visitObj.vitalSigns?.forEach(v => {
    if (v.recordedBy) userIds.add(v.recordedBy.toString());
  });
  
  visitObj.diagnosis?.forEach(d => {
    if (d.diagnosedBy) userIds.add(d.diagnosedBy.toString());
  });
  
  visitObj.labOrders?.forEach(l => {
    if (l.orderedBy) userIds.add(l.orderedBy.toString());
    if (l.completedBy) userIds.add(l.completedBy.toString());
  });
  
  visitObj.radiologyOrders?.forEach(r => {
    if (r.orderedBy) userIds.add(r.orderedBy.toString());
    if (r.completedBy) userIds.add(r.completedBy.toString());
  });
  
  visitObj.prescriptions?.forEach(p => {
    if (p.prescribedBy) userIds.add(p.prescribedBy.toString());
    if (p.quantifiedBy) userIds.add(p.quantifiedBy.toString());
  });

  // Fetch all users at once
  const users = await User.find({ 
    _id: { $in: Array.from(userIds) } 
  }).select('firstName lastName');

  // Create a lookup map
  const userMap = new Map();
  users.forEach(user => {
    userMap.set(user._id.toString(), {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName
    });
  });

  // Populate the user data
  visitObj.vitalSigns?.forEach(v => {
    if (v.recordedBy) {
      v.recordedBy = userMap.get(v.recordedBy.toString()) || v.recordedBy;
    }
  });
  
  visitObj.diagnosis?.forEach(d => {
    if (d.diagnosedBy) {
      d.diagnosedBy = userMap.get(d.diagnosedBy.toString()) || d.diagnosedBy;
    }
  });
  
  visitObj.labOrders?.forEach(l => {
    if (l.orderedBy) {
      l.orderedBy = userMap.get(l.orderedBy.toString()) || l.orderedBy;
    }
    if (l.completedBy) {
      l.completedBy = userMap.get(l.completedBy.toString()) || l.completedBy;
    }
  });
  
  visitObj.radiologyOrders?.forEach(r => {
    if (r.orderedBy) {
      r.orderedBy = userMap.get(r.orderedBy.toString()) || r.orderedBy;
    }
    if (r.completedBy) {
      r.completedBy = userMap.get(r.completedBy.toString()) || r.completedBy;
    }
  });
  
  visitObj.prescriptions?.forEach(p => {
    if (p.prescribedBy) {
      p.prescribedBy = userMap.get(p.prescribedBy.toString()) || p.prescribedBy;
    }
    if (p.quantifiedBy) {
      p.quantifiedBy = userMap.get(p.quantifiedBy.toString()) || p.quantifiedBy;
    }
  });
    
  res.status(200).json({ 
    status: 'success', 
    data: visitObj 
  });
} catch (error) {
  logger.error('Get single visit error:', error);
  res.status(500).json({ 
    status: 'error',
    message: 'Server Error' 
  });
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
res.status(400).json({
status: 'error',
message: error.message
});
}
});

// @desc    Add vital signs to visit
// @route   POST /api/visits/:id/vitals
// @access  Private (Nurse, Doctor, Receptionist)
router.post('/:id/vitals', authorize('admin', 'nurse', 'doctor', 'receptionist'),checkPaymentEligibility, async (req, res) => {
try {
const visit = req.visit;
const { temperature, bloodPressure, heartRate, oxygenSaturation } = req.body;

const newVitalsData = {
  temperature,
  bloodPressure,
  heartRate,
  oxygenSaturation,
  patient: visit.patient._id,
  recordedBy: req.user.id,
  recordedAt: new Date() // Explicitly set the recording time
};

if (!visit.vitalSigns) {
  visit.vitalSigns = [];
}

visit.vitalSigns.push(newVitalsData);
await visit.save();

res.status(201).json({
  status: 'success',
  message: 'Vital signs recorded successfully',
  data: newVitalsData
});

} catch (error) {
logger.error('Add vital signs error:', error);
res.status(500).json({
status: 'error',
message: 'Server error'
});
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
  res.status(400).json({ 
    status: 'error', 
    message: error.message 
  });
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
  res.status(400).json({ 
    status: 'error', 
    message: error.message 
  });
}

});

// @desc    Add prescription (NEW WORKFLOW - goes to pharmacist first, NOT added to invoice yet)
// @route   POST /api/visits/:id/prescriptions
router.post('/:id/prescriptions',
authorize('admin', 'doctor'),
checkPaymentEligibility,
async (req, res) => {
try {
const visit = req.visit;
const { medication, dosage, frequency, duration, type, notes } = req.body;

  // Step 1: Initialize the Medicine model
  const Medicine = mongoose.model('Medicine');
  
  // Step 2: Build the search criteria
  // We search by name (case-insensitive)
  const searchCriteria = { 
    name: { $regex: new RegExp(`^${medication}$`, 'i') }
  };

  // If a specific type (e.g., 'Tablet', 'Syrup') is provided, include it in the search
  if (type) {
    searchCriteria.type = type;
  }

  // Step 3: Perform ONE search to find the medicine item
  const medicineItem = await Medicine.findOne(searchCriteria);

  // Step 4: Validate if the medicine exists in inventory
  if (!medicineItem) {
    return res.status(404).json({
      status: 'error',
      message: `Medication "${medication}" ${type ? `of type ${type} ` : ''}not found in inventory.`
    });
  }

  // Step 5: Create the prescription object
  // We use the official name and ID from the database record (medicineItem)
  const newPrescription = {
    medication: medicineItem.name,
    medicineId: medicineItem._id, 
    dosage,
    frequency,
    duration,
    notes: notes || '',
    patient: visit.patient._id,
    prescribedBy: req.user.id,
    status: 'Pending Quantification', 
    quantifiedQuantity: null, 
    quantifiedPrice: null, 
    sentToPharmacyAt: new Date()
  };
  
  // Step 6: Update the visit record
  visit.prescriptions.push(newPrescription);
  await visit.save();

  logger.info(
    `Prescription for "${medicineItem.name}" created for visit ${visit.visitId}. ` +
    `Sent to pharmacy for quantification.`
  );

  res.status(201).json({ 
    status: 'success', 
    data: newPrescription,
    message: 'Prescription created and sent to pharmacy for quantification.'
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
return res.status(404).json({
status: 'error',
message: 'Visit not found'
});
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

res.status(201).json({ 
  status: 'success', 
  data: newDiagnosis 
});

} catch (error) {
logger.error('Add diagnosis error:', error);
res.status(400).json({
status: 'error',
message: error.message
});
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
