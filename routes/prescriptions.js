import express from ‘express’;
import mongoose from ‘mongoose’;
import Visit from ‘../models/Visit.js’;
import Patient from ‘../models/Patient.js’;
import { protect, authorize } from ‘../middleware/auth.js’;
import billingService from ‘../services/billingService.js’;
import logger from ‘../utils/logger.js’;

const router = express.Router();

router.use(protect);

// @desc    Get all prescriptions (aggregated from all visits)
// @route   GET /api/prescriptions
// @access  Private (Admin, Pharmacist)
router.get(’/’, authorize(‘admin’, ‘pharmacist’), async (req, res) => {
try {
const { status, patientId } = req.query;

```
// Aggregate prescriptions from all active visits only
const matchStage = { 
  'prescriptions.0': { $exists: true },
  isActive: true
};

const visits = await Visit.find(matchStage)
  .populate('patient', 'firstName lastName patientId')
  .populate('patient.insurance.provider', 'name') // Populate insurance provider
  .populate('doctor', 'firstName lastName')
  .populate('prescriptions.prescribedBy', 'firstName lastName')
  .populate('prescriptions.quantifiedBy', 'firstName lastName')
  .sort({ createdAt: -1 });

// Flatten prescriptions with visit context
const allPrescriptions = [];

visits.forEach(visit => {
  if (visit.prescriptions && visit.prescriptions.length > 0) {
    visit.prescriptions.forEach(prescription => {
      // Apply filters
      if (patientId && visit.patient._id.toString() !== patientId) return;
      if (status && prescription.status !== status) return;
      
      // Only show active prescriptions
      if (!prescription.isActive) return;

      allPrescriptions.push({
        _id: prescription._id,
        medication: prescription.medication,
        medicineId: prescription.medicineId,
        dosage: prescription.dosage,
        frequency: prescription.frequency,
        duration: prescription.duration,
        notes: prescription.notes,
        status: prescription.status,
        isActive: prescription.isActive,
        quantifiedQuantity: prescription.quantifiedQuantity,
        quantifiedPrice: prescription.quantifiedPrice,
        sentToPharmacyAt: prescription.sentToPharmacyAt,
        sentToBillingAt: prescription.sentToBillingAt,
        createdAt: prescription.createdAt,
        patient: visit.patient,
        visit: {
          _id: visit._id,
          visitId: visit.visitId,
          visitDate: visit.visitDate,
          invoice: visit.invoice
        },
        prescribedBy: prescription.prescribedBy
      });
    });
  }
});

// Sort by most recent
allPrescriptions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

res.status(200).json({
  status: 'success',
  data: allPrescriptions,
  count: allPrescriptions.length
});
```

} catch (error) {
logger.error(‘Get prescriptions error:’, error);
res.status(500).json({
status: ‘error’,
message: ‘Server Error’
});
}
});

// @desc    Get prescriptions pending quantification (for pharmacist)
// @route   GET /api/prescriptions/pending-quantification
// @access  Private (Pharmacist, Admin)
router.get(’/pending-quantification’, authorize(‘admin’, ‘pharmacist’), async (req, res) => {
try {
const visits = await Visit.find({
‘prescriptions.status’: ‘Pending Quantification’,
‘prescriptions.isActive’: true,
isActive: true
})
.populate(‘patient’, ‘firstName lastName patientId’)
.populate(‘patient.insurance.provider’, ‘name’)
.populate(‘doctor’, ‘firstName lastName’)
.populate(‘prescriptions.prescribedBy’, ‘firstName lastName’)
.sort({ ‘prescriptions.sentToPharmacyAt’: 1 });

```
const pendingPrescriptions = [];

visits.forEach(visit => {
  if (visit.prescriptions && visit.prescriptions.length > 0) {
    visit.prescriptions.forEach(prescription => {
      if (prescription.status === 'Pending Quantification' && prescription.isActive) {
        pendingPrescriptions.push({
          _id: prescription._id,
          medication: prescription.medication,
          medicineId: prescription.medicineId,
          dosage: prescription.dosage,
          frequency: prescription.frequency,
          duration: prescription.duration,
          sentToPharmacyAt: prescription.sentToPharmacyAt,
          patient: visit.patient,
          visit: {
            _id: visit._id,
            visitId: visit.visitId,
            visitDate: visit.visitDate,
            invoice: visit.invoice
          },
          prescribedBy: prescription.prescribedBy,
          status: prescription.status
        });
      }
    });
  }
});

res.status(200).json({
  status: 'success',
  data: pendingPrescriptions,
  count: pendingPrescriptions.length
});
```

} catch (error) {
logger.error(‘Get pending quantification error:’, error);
res.status(500).json({
status: ‘error’,
message: ‘Server Error’
});
}
});

// @desc    Quantify prescription (pharmacist sets quantity and price)
// @route   PATCH /api/prescriptions/:id/quantify
// @access  Private (Pharmacist, Admin)
router.patch(’/:id/quantify’, authorize(‘admin’, ‘pharmacist’), async (req, res) => {
try {
const { id } = req.params;
const { quantifiedQuantity, notes } = req.body;

```
// Find the visit containing this prescription
const visit = await Visit.findOne({ 'prescriptions._id': id })
  .populate('patient')
  .populate('patient.insurance.provider', 'name');

if (!visit) {
  return res.status(404).json({
    status: 'error',
    message: 'Prescription not found'
  });
}

const prescription = visit.prescriptions.id(id);

if (!prescription) {
  return res.status(404).json({
    status: 'error',
    message: 'Prescription not found'
  });
}

if (prescription.status !== 'Pending Quantification') {
  return res.status(400).json({
    status: 'error',
    message: `Cannot quantify. Current status: ${prescription.status}`
  });
}

// Get medicine details with improved error handling and fallback
const Medicine = mongoose.model('Medicine');
let medicine = null;

// First attempt: Find by medicineId if it exists
if (prescription.medicineId) {
  logger.info(`Attempting to find medicine by ID: ${prescription.medicineId}`);
  medicine = await Medicine.findById(prescription.medicineId);
}

// Fallback: If not found by ID, try to find by medication name
if (!medicine) {
  logger.warn(`Medicine not found by ID ${prescription.medicineId}, attempting lookup by name: ${prescription.medication}`);
  
  medicine = await Medicine.findOne({ 
    name: { $regex: new RegExp(`^${prescription.medication}$`, 'i') }
  });

  if (medicine) {
    // Update the prescription with the correct medicineId for future reference
    prescription.medicineId = medicine._id;
    logger.info(`Found medicine by name and updated medicineId to: ${medicine._id}`);
  }
}

if (!medicine) {
  logger.error(`Medicine not found - ID: ${prescription.medicineId}, Name: ${prescription.medication}`);
  return res.status(404).json({
    status: 'error',
    message: `Medicine not found in inventory. Medicine: "${prescription.medication}". Please verify the medicine exists in the catalog.`
  });
}

// Check stock availability from MedicineBatch (your batch-based system)
const MedicineBatch = mongoose.model('MedicineBatch');
const availableBatches = await MedicineBatch.find({
  medicine: medicine._id, // Use the found medicine's ID
  status: 'active',
  expiryDate: { $gt: new Date() }
}).sort('expiryDate'); // FIFO - First to expire, first out

const totalAvailableStock = availableBatches.reduce(
  (sum, batch) => sum + batch.quantityRemaining, 
  0
);

// Check stock availability
if (totalAvailableStock < quantifiedQuantity) {
  return res.status(400).json({
    status: 'error',
    message: `Insufficient stock. Available: ${totalAvailableStock}, Requested: ${quantifiedQuantity}`
  });
}

// Get price from ItemPrice model based on insurance
const ItemPrice = mongoose.model('ItemPrice');
const patient = visit.patient;
const hasInsurance = !!(patient.insurance?.provider);
const insuranceProviderName = patient.insurance?.provider?.name;

const itemPrice = await ItemPrice.findOne({ 
  name: { $regex: new RegExp(`^${medicine.name}$`, 'i') } 
});

let price = 0;
let priceSource = 'Not Found';

if (itemPrice) {
  if (hasInsurance && insuranceProviderName && itemPrice.prices && itemPrice.prices[insuranceProviderName]) {
    // Use insurance-specific price
    price = itemPrice.prices[insuranceProviderName];
    priceSource = insuranceProviderName;
  } else if (itemPrice.prices && itemPrice.prices.Pharmacy) {
    // Use Pharmacy (cash) price
    price = itemPrice.prices.Pharmacy;
    priceSource = 'Pharmacy';
  }
}

// Fallback to medicine.sellingPrice if no price found in ItemPrice
if (price === 0 && medicine.sellingPrice) {
  price = medicine.sellingPrice;
  priceSource = 'Medicine Catalog';
}

// Fallback to medicine.prices.Pharmacy
if (price === 0 && medicine.prices && medicine.prices.Pharmacy) {
  price = medicine.prices.Pharmacy;
  priceSource = 'Medicine Prices (Pharmacy)';
}

if (price === 0) {
  return res.status(400).json({
    status: 'error',
    message: `No price found for ${medicine.name}. Please set a price in the Item Price or Medicine catalog.`
  });
}

const totalPrice = quantifiedQuantity * price;

// Update prescription
prescription.quantifiedQuantity = quantifiedQuantity;
prescription.quantifiedPrice = price;
prescription.totalPrice = totalPrice;
prescription.quantifiedBy = req.user.id;
prescription.quantifiedAt = new Date();
prescription.status = 'Quantified';

if (notes) {
  prescription.notes = prescription.notes 
    ? `${prescription.notes}\nPharmacist: ${notes}` 
    : notes;
}

await visit.save();

logger.info(
  `Prescription ${id} quantified. ` +
  `Medicine: ${medicine.name}, Quantity: ${quantifiedQuantity}, ` +
  `Price: ${price} (${priceSource}), Total: ${totalPrice}`
);

res.status(200).json({
  status: 'success',
  message: 'Prescription quantified successfully',
  data: {
    prescription,
    priceInfo: {
      unitPrice: price,
      quantity: quantifiedQuantity,
      totalPrice: totalPrice,
      priceSource: priceSource
    }
  }
});
```

} catch (error) {
logger.error(‘Quantify prescription error’, error);
res.status(400).json({
status: ‘error’,
message: error.message
});
}
});

// @desc    Send quantified prescription to billing
// @route   PATCH /api/prescriptions/:id/send-to-billing
// @access  Private (Pharmacist, Admin)
router.patch(’/:id/send-to-billing’, authorize(‘admin’, ‘pharmacist’), async (req, res) => {
try {
const { id } = req.params;

```
// Find the visit containing this prescription
const visit = await Visit.findOne({ 'prescriptions._id': id })
  .populate('patient')
  .populate('patient.insurance.provider', 'name');

if (!visit) {
  return res.status(404).json({
    status: 'error',
    message: 'Prescription not found'
  });
}

const prescription = visit.prescriptions.id(id);

if (!prescription) {
  return res.status(404).json({
    status: 'error',
    message: 'Prescription not found'
  });
}

if (prescription.status !== 'Quantified') {
  return res.status(400).json({
    status: 'error',
    message: `Cannot send to billing. Must be quantified first. Current status: ${prescription.status}`
  });
}

if (!visit.invoice) {
  return res.status(400).json({
    status: 'error',
    message: 'No invoice found for this visit'
  });
}

const patient = visit.patient;
const hasInsurance = !!(patient.insurance?.provider);
const insuranceProviderName = patient.insurance?.provider?.name;

// Add prescription to invoice
await billingService.addItemsToInvoice(
  visit.invoice,
  [{
    type: 'medication',
    description: `${prescription.medication} - ${prescription.dosage}, ${prescription.frequency}`,
    quantity: prescription.quantifiedQuantity,
    unitPrice: prescription.quantifiedPrice,
    total: prescription.totalPrice,
    notes: prescription.duration,
    insuranceProvider: insuranceProviderName || 'Cash'
  }],
  hasInsurance
);

// Update prescription status
const newStatus = hasInsurance ? 'Pending' : 'Pending Payment';
prescription.status = newStatus;
prescription.sentToBillingAt = new Date();

await visit.save();

logger.info(
  `Prescription ${id} sent to billing. ` +
  `Added to invoice ${visit.invoice}. Status: ${newStatus}`
);

res.status(200).json({
  status: 'success',
  message: hasInsurance ? 
    'Prescription sent to billing. Ready for dispensing.' :
    'Prescription sent to billing. Payment required before dispensing.',
  data: prescription
});
```

} catch (error) {
logger.error(‘Send to billing error’, error);
res.status(400).json({
status: ‘error’,
message: error.message
});
}
});

// @desc    Get prescriptions ready for dispensing (paid)
// @route   GET /api/prescriptions/ready-for-dispensing
// @access  Private (Pharmacist, Admin)
router.get(’/ready-for-dispensing’, authorize(‘admin’, ‘pharmacist’), async (req, res) => {
try {
const visits = await Visit.find({
‘prescriptions.status’: { $in: [‘Pending’, ‘Paid’] }, // Insurance or paid prescriptions
‘prescriptions.isActive’: true,
isActive: true
})
.populate(‘patient’, ‘firstName lastName patientId’)
.populate(‘doctor’, ‘firstName lastName’)
.populate(‘prescriptions.quantifiedBy’, ‘firstName lastName’)
.sort({ ‘prescriptions.sentToBillingAt’: 1 });

```
const readyPrescriptions = [];

visits.forEach(visit => {
  if (visit.prescriptions && visit.prescriptions.length > 0) {
    visit.prescriptions.forEach(prescription => {
      // Only show prescriptions that are paid or covered by insurance
      if ((prescription.status === 'Pending' || prescription.status === 'Paid') 
          && prescription.isActive) {
        readyPrescriptions.push({
          _id: prescription._id,
          medication: prescription.medication,
          medicineId: prescription.medicineId,
          dosage: prescription.dosage,
          frequency: prescription.frequency,
          duration: prescription.duration,
          quantifiedQuantity: prescription.quantifiedQuantity,
          quantifiedPrice: prescription.quantifiedPrice,
          totalPrice: prescription.totalPrice,
          status: prescription.status,
          quantifiedBy: prescription.quantifiedBy,
          quantifiedAt: prescription.quantifiedAt,
          sentToBillingAt: prescription.sentToBillingAt,
          patient: visit.patient,
          visit: {
            _id: visit._id,
            visitId: visit.visitId,
            visitDate: visit.visitDate
          }
        });
      }
    });
  }
});

res.status(200).json({
  status: 'success',
  data: readyPrescriptions,
  count: readyPrescriptions.length
});
```

} catch (error) {
logger.error(‘Get ready for dispensing error:’, error);
res.status(500).json({
status: ‘error’,
message: ‘Server Error’
});
}
});

// Get prescriptions for a specific patient
router.get(’/patient/:patientId’, authorize(‘admin’, ‘doctor’, ‘nurse’, ‘pharmacist’), async (req, res) => {
try {
const visits = await Visit.find({
patient: req.params.patientId,
‘prescriptions.0’: { $exists: true }
})
.populate(‘prescriptions.prescribedBy’, ‘firstName lastName’)
.populate(‘prescriptions.quantifiedBy’, ‘firstName lastName’)
.sort({ createdAt: -1 });

```
// Flatten all prescriptions from all visits
const allPrescriptions = [];
visits.forEach(visit => {
  if (visit.prescriptions && visit.prescriptions.length > 0) {
    visit.prescriptions.forEach(prescription => {
      if (prescription.isActive) {
        allPrescriptions.push({
          ...prescription.toObject(),
          visitId: visit.visitId,
          visitDate: visit.visitDate
        });
      }
    });
  }
});

res.status(200).json({
  status: 'success',
  data: allPrescriptions
});
```

} catch (error) {
logger.error(‘Get patient prescriptions error’, error);
res.status(500).json({
status: ‘error’,
message: ‘Server Error’
});
}
});

// Update prescription (mark as inactive/dispensed)
router.patch(’/:id’, authorize(‘admin’, ‘doctor’, ‘pharmacist’), async (req, res) => {
try {
const { id } = req.params;
const { isActive, status } = req.body;

```
// Find the visit containing this prescription
const visit = await Visit.findOne({ 'prescriptions._id': id });

if (!visit) {
  return res.status(404).json({
    status: 'error',
    message: 'Prescription not found'
  });
}

const prescription = visit.prescriptions.id(id);

if (!prescription) {
  return res.status(404).json({
    status: 'error',
    message: 'Prescription not found'
  });
}

// Update the prescription
if (isActive !== undefined) {
  prescription.isActive = isActive;
}
if (status) {
  prescription.status = status;
}

await visit.save();

res.status(200).json({
  status: 'success',
  data: prescription
});
```

} catch (error) {
logger.error(‘Update prescription error’, error);
res.status(400).json({
status: ‘error’,
message: error.message
});
}
});

// @desc    Delete a prescription permanently
// @route   DELETE /api/prescriptions/:id
// @access  Private (Pharmacist only)
router.delete(’/:id’, authorize(‘pharmacist’), async (req, res) => {
try {
const { id } = req.params;

```
const visit = await Visit.findOne({ 'prescriptions._id': id });

if (!visit) {
  return res.status(404).json({ status: 'error', message: 'Prescription not found' });
}

const prescription = visit.prescriptions.id(id);

if (!prescription) {
  return res.status(404).json({ status: 'error', message: 'Prescription not found' });
}

visit.prescriptions.pull({ _id: id });
await visit.save();

logger.info(`Prescription ${id} permanently deleted by user ${req.user.id}`);

res.status(200).json({ status: 'success', message: 'Prescription deleted successfully' });
```

} catch (error) {
logger.error(‘Delete prescription error’, error);
res.status(500).json({ status: ‘error’, message: error.message });
}
});

export default router;