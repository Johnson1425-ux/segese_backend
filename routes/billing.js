import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { protect, authorize } from '../middleware/auth.js';
import billingService from '../services/billingService.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Patient from '../models/Patient.js';
import Visit from '../models/Visit.js';
import InsuranceProvider from '../models/InsuranceProvider.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Validation middleware
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Helper function to update visit order statuses after payment
const updateVisitOrderStatuses = async (visit, paidItemType) => {
  let updated = false;

  // If lab test was paid, update lab order status
  if (paidItemType === 'lab_test' && visit.labOrders && visit.labOrders.length > 0) {
    // Find the most recent pending lab order and mark it as ready
    const pendingLabOrder = visit.labOrders
      .filter(order => order.status === 'Pending Payment')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    
    if (pendingLabOrder) {
      pendingLabOrder.status = 'Pending';
      updated = true;
      logger.info(`Lab order ${pendingLabOrder._id} status changed to Pending after payment`);
    }
  }

  // If imaging/radiology was paid, update radiology order status
  if (paidItemType === 'imaging' && visit.radiologyOrders && visit.radiologyOrders.length > 0) {
    // Find the most recent pending radiology order and mark it as ready
    const pendingRadiologyOrder = visit.radiologyOrders
      .filter(order => order.status === 'Pending Payment')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    
    if (pendingRadiologyOrder) {
      pendingRadiologyOrder.status = 'Pending';
      updated = true;
      logger.info(`Radiology order ${pendingRadiologyOrder._id} status changed to Pending after payment`);
    }
  }

  // If medication was paid, update prescription status
  if (paidItemType === 'medication' && visit.prescriptions && visit.prescriptions.length > 0) {
    // Find the most recent pending prescription and mark it as ready
    const pendingPrescription = visit.prescriptions
      .filter(prescription => prescription.status === 'Pending Payment')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    
    if (pendingPrescription) {
      pendingPrescription.status = 'Pending';
      updated = true;
      logger.info(`Prescription ${pendingPrescription._id} status changed to Pending after payment`);
    }
  }

  if (updated) {
    await visit.save();
  }

  return updated;
};

// @desc    Get all invoices with searching, filtering, and pagination
// @route   GET /api/billing/invoices
// @access  Private (Admin, Receptionist, Doctor)
router.get('/invoices',
  protect,
  authorize('admin', 'receptionist', 'doctor', 'pharmacist'),
  async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 10, 
        status, 
        search,
        sortBy = 'createdAt',
        order = 'desc'
      } = req.query;

      const skip = (page - 1) * limit;
      const sortOptions = { [sortBy]: order === 'desc' ? -1 : 1 };
      
      const pipeline = [];

      const matchStage = {};
      if (status && status !== 'all') {
        matchStage.status = status;
      }

      pipeline.push({
        $lookup: {
          from: 'patients',
          localField: 'patient',
          foreignField: '_id',
          as: 'patientInfo'
        }
      });
      pipeline.push({ $unwind: '$patientInfo' });

      if (search) {
        matchStage.$or = [
          { 'patientInfo.firstName': { $regex: search, $options: 'i' } },
          { 'patientInfo.lastName': { $regex: search, $options: 'i' } },
          { 'invoiceNumber': { $regex: search, $options: 'i' } }
        ];
      }

      if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
      }
      
      const countPipeline = [...pipeline, { $count: 'total' }];
      const dataPipeline = [
        ...pipeline,
        { $sort: sortOptions },
        { $skip: skip },
        { $limit: parseInt(limit) },
        { $lookup: { from: 'users', localField: 'generatedBy', foreignField: '_id', as: 'generatedByInfo' }},
        { $unwind: '$generatedByInfo' },
        { $project: {
            invoiceNumber: 1, createdAt: 1, totalAmount: 1, status: 1,
            patient: '$patientInfo',
            generatedBy: { firstName: '$generatedByInfo.firstName', lastName: '$generatedByInfo.lastName' }
        }}
      ];

      const [totalResult] = await Invoice.aggregate(countPipeline);
      const total = totalResult ? totalResult.total : 0;
      const invoices = await Invoice.aggregate(dataPipeline);
      
      res.status(200).json({
        status: 'success',
        data: {
          invoices,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Get invoices error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error while fetching invoices'
      });
    }
  }
);

// @desc    Get single invoice
// @route   GET /api/billing/invoices/:id
// @access  Private
router.get('/invoices/:id',
  protect,
  [param('id').isMongoId().withMessage('Invalid invoice ID')],
  handleValidation,
  async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id)
        .populate('patient')
        .populate('visit')
        .populate('appointment')
        .populate('generatedBy', 'firstName lastName')
        .populate('insuranceCoverage.provider');

      if (!invoice) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice not found'
        });
      }

      res.status(200).json({
        status: 'success',
        data: invoice
      });
    } catch (error) {
      logger.error('Get invoice error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error'
      });
    }
});

// @desc    Create invoice
// @route   POST /api/billing/invoices
// @access  Private (Admin, Receptionist)
router.post('/invoices',
  protect,
  authorize('admin', 'receptionist', 'doctor'),
  [
    body('patient').isMongoId().withMessage('Valid patient ID required'),
    body('visit').optional().isMongoId().withMessage('If provided, visit ID must be valid'),
    body('items').isArray({ min: 1 }).withMessage('At least one item required'),
    body('items.*.type').isIn(['consultation', 'procedure', 'medication', 'lab_test', 'imaging', 'room_charge', 'equipment', 'other']),
    body('items.*.description').notEmpty().withMessage('Item description required'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Valid quantity required'),
    body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Valid price required'),
    body('paymentTerms').optional().isIn(['immediate', 'net_15', 'net_30', 'net_45', 'net_60'])
  ],
  handleValidation,
  async (req, res) => {
    try {
      const invoice = await billingService.createInvoice(req.body, req.user.id);

      const patient = await Patient.findById(req.body.patient);
      const hasInsurance = !!(patient?.insurance?.provider);

      res.status(201).json({
        status: 'success',
        message: 'Invoice created successfully' + (hasInsurance ? ' and marked as paid (insurance coverage)' : ''),
        data: invoice
      });
    } catch (error) {
      logger.error('Create invoice error:', error);
      res.status(500).json({
        status: 'error',
        message: error.message || 'Server error'
      });
    }
});

// @desc    Update invoice
// @route   PUT /api/billing/invoices/:id
// @access  Private (Admin)
router.put('/invoices/:id',
  protect,
  authorize('admin'),
  [param('id').isMongoId().withMessage('Invalid invoice ID')],
  handleValidation,
  async (req, res) => {
    try {
      const invoice = await Invoice.findById(req.params.id);
      
      if (!invoice) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice not found'
        });
      }

      if (invoice.status === 'paid') {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot update paid invoice'
        });
      }

      Object.assign(invoice, req.body);
      invoice.calculateTotals();
      await invoice.save();

      res.status(200).json({
        status: 'success',
        message: 'Invoice updated successfully',
        data: invoice
      });
    } catch (error) {
      logger.error('Update invoice error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error'
      });
    }
});

// @desc    Add payment to specific invoice
// @route   POST /api/billing/invoices/:id/payments
// @access  Private (Admin, Receptionist)
router.post('/invoices/:id/payments',
  protect,
  authorize('admin', 'receptionist'),
  [
    param('id').isMongoId().withMessage('Invalid invoice ID'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Valid amount required'),
    body('method').isIn(['cash', 'credit_card', 'debit_card', 'check', 'bank_transfer', 'insurance', 'online']),
    body('patient').optional().isMongoId().withMessage('Valid patient ID required'),
    body('cardDetails').optional().isObject(),
    body('checkDetails').optional().isObject()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const invoiceId = req.params.id;
      
      const invoice = await Invoice.findById(invoiceId);
      if (!invoice) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice not found'
        });
      }

      const paymentData = {
        ...req.body,
        invoice: invoiceId,
        patient: req.body.patient || invoice.patient
      };

      const payment = await billingService.processPayment(paymentData, req.user.id);

      res.status(201).json({
        status: 'success',
        message: 'Payment processed successfully',
        data: payment
      });
    } catch (error) {
      logger.error('Add payment to invoice error:', error);
      res.status(500).json({
        status: 'error',
        message: error.message || 'Server error'
      });
    }
  }
);

// @desc    Process payment
// @route   POST /api/billing/payments
// @access  Private (Admin, Receptionist)
router.post('/payments',
  protect,
  authorize('admin', 'receptionist'),
  [
    body('invoice').isMongoId().withMessage('Valid invoice ID required'),
    body('patient').isMongoId().withMessage('Valid patient ID required'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Valid amount required'),
    body('method').isIn(['cash', 'credit_card', 'debit_card', 'check', 'bank_transfer', 'insurance', 'online']),
    body('cardDetails').optional().isObject(),
    body('checkDetails').optional().isObject()
  ],
  handleValidation,
  async (req, res) => {
    try {
      const payment = await billingService.processPayment(req.body, req.user.id);

      res.status(201).json({
        status: 'success',
        message: 'Payment processed successfully',
        data: payment
      });
    } catch (error) {
      logger.error('Process payment error:', error);
      res.status(500).json({
        status: 'error',
        message: error.message || 'Server error'
      });
    }
});

// @desc    Get payments
// @route   GET /api/billing/payments
// @access  Private
router.get('/payments',
  protect,
  async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 10,
        patientId,
        invoiceId,
        status,
        method,
        startDate,
        endDate
      } = req.query;

      const query = {};
      
      if (patientId) query.patient = patientId;
      if (invoiceId) query.invoice = invoiceId;
      if (status) query.status = status;
      if (method) query.method = method;
      if (startDate || endDate) {
        query.paymentDate = {};
        if (startDate) query.paymentDate.$gte = new Date(startDate);
        if (endDate) query.paymentDate.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const payments = await Payment.find(query)
        .populate('patient', 'firstName lastName')
        .populate('invoice', 'invoiceNumber totalAmount')
        .populate('processedBy', 'firstName lastName')
        .sort({ paymentDate: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Payment.countDocuments(query);

      res.status(200).json({
        status: 'success',
        data: {
          payments,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      logger.error('Get payments error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error'
      });
    }
});

// @desc    Process insurance claim
// @route   POST /api/billing/insurance-claims
// @access  Private (Admin, Receptionist)
router.post('/insurance-claims',
  protect,
  authorize('admin', 'receptionist'),
  [
    body('invoiceId').isMongoId().withMessage('Valid invoice ID required'),
    body('providerId').isMongoId().withMessage('Valid provider ID required'),
    body('policyNumber').notEmpty().withMessage('Policy number required'),
    body('planCode').notEmpty().withMessage('Plan code required')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const invoice = await billingService.processInsuranceClaim(
        req.body.invoiceId,
        req.body,
        req.user.id
      );

      res.status(200).json({
        status: 'success',
        message: 'Insurance claim submitted successfully',
        data: invoice
      });
    } catch (error) {
      logger.error('Process insurance claim error:', error);
      res.status(500).json({
        status: 'error',
        message: error.message || 'Server error'
      });
    }
});

// @desc    Get insurance providers
// @route   GET /api/billing/insurance-providers
// @access  Private
router.get('/insurance-providers',
  protect,
  async (req, res) => {
    try {
      const providers = await InsuranceProvider.find({ isActive: true })
        .select('name code type');

      res.status(200).json({
        status: 'success',
        data: providers
      });
    } catch (error) {
      logger.error('Get insurance providers error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error'
      });
    }
});

// @desc    Process refund
// @route   POST /api/billing/refunds
// @access  Private (Admin)
router.post('/refunds',
  protect,
  authorize('admin'),
  [
    body('paymentId').isMongoId().withMessage('Valid payment ID required'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Valid amount required'),
    body('reason').notEmpty().withMessage('Refund reason required')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const payment = await billingService.processRefund(
        req.body.paymentId,
        req.body,
        req.user.id
      );

      res.status(200).json({
        status: 'success',
        message: 'Refund processed successfully',
        data: payment
      });
    } catch (error) {
      logger.error('Process refund error:', error);
      res.status(500).json({
        status: 'error',
        message: error.message || 'Server error'
      });
    }
});

// @desc    Generate patient statement
// @route   GET /api/billing/statements/:patientId
// @access  Private
router.get('/statements/:patientId',
  protect,
  [
    param('patientId').isMongoId().withMessage('Invalid patient ID'),
    query('startDate').optional().isISO8601().withMessage('Valid start date required'),
    query('endDate').optional().isISO8601().withMessage('Valid end date required')
  ],
  handleValidation,
  async (req, res) => {
    try {
      const { patientId } = req.params;
      const { startDate, endDate } = req.query;

      const statement = await billingService.generateStatement(
        patientId,
        startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate || new Date()
      );

      res.status(200).json({
        status: 'success',
        data: statement
      });
    } catch (error) {
      logger.error('Generate statement error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error'
      });
    }
});

// @desc    Get billing dashboard statistics
// @route   GET /api/billing/statistics
// @access  Private (Admin)
router.get('/statistics',
  protect,
  authorize('admin', 'receptionist'),
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      const dateQuery = {};
      if (startDate) dateQuery.$gte = new Date(startDate);
      if (endDate) dateQuery.$lte = new Date(endDate);

      const invoiceStats = await Invoice.aggregate([
        { $match: dateQuery.createdAt ? { createdAt: dateQuery } : {} },
        {
          $group: {
            _id: null,
            totalInvoices: { $sum: 1 },
            totalAmount: { $sum: '$totalAmount' },
            totalPaid: { $sum: '$amountPaid' },
            totalDue: { $sum: '$balanceDue' },
            avgInvoiceAmount: { $avg: '$totalAmount' }
          }
        }
      ]);

      const paymentStats = await Payment.aggregate([
        { $match: dateQuery.paymentDate ? { paymentDate: dateQuery } : {} },
        {
          $group: {
            _id: '$method',
            count: { $sum: 1 },
            total: { $sum: '$amount' }
          }
        }
      ]);

      const overdueInvoices = await Invoice.countDocuments({
        status: 'overdue'
      });

      res.status(200).json({
        status: 'success',
        data: {
          invoices: invoiceStats[0] || {},
          payments: paymentStats,
          overdueCount: overdueInvoices
        }
      });
    } catch (error) {
      logger.error('Get billing statistics error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error'
      });
    }
});

// @desc    Mark a specific invoice item as paid
// @route   PATCH /api/billing/invoices/:invoiceId/items/:itemIndex/pay
// @access  Private (Admin, Receptionist)
router.patch('/invoices/:invoiceId/items/:itemIndex/pay',
  protect, 
  authorize('admin', 'receptionist'), 
  async (req, res) => {
    try {
      const { invoiceId, itemIndex } = req.params;
      const { paymentMethod, amount } = req.body;

      const invoice = await Invoice.findById(invoiceId)
        .populate('visit')
        .populate({ path: 'visit', populate: { path: 'patient' }});
      
      if (!invoice) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice not found'
        });
      }

      if (itemIndex >= invoice.items.length) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid item index'
        });
      }

      // Mark item as paid
      invoice.items[itemIndex].paid = true;
      invoice.items[itemIndex].paidAt = new Date();
      
      // Record payment
      const payment = {
        amount: amount || invoice.items[itemIndex].total,
        method: paymentMethod || 'cash',
        paidBy: req.user.id,
        paidAt: new Date(),
        reference: `Payment for ${invoice.items[itemIndex].description}`
      };
      
      if (!invoice.payments) invoice.payments = [];
      invoice.payments.push(payment);
      
      // Recalculate totals
      invoice.calculateTotals();
      await invoice.save();

      // Get the item type that was paid
      const paidItemType = invoice.items[itemIndex].type;

      // === CHECK IF CONSULTATION PAID FOR NON-INSURED PATIENT ===
      if (invoice.visit && paidItemType === 'consultation') {
        const visit = invoice.visit;
        const hasInsurance = !!(visit.patient?.insurance?.provider);
        
        if (!hasInsurance && visit.status === 'Pending Payment') {
          visit.status = 'In Queue';
          visit.consultationFeePaid = true;
          await visit.save();
          logger.info(`Visit ${visit.visitId} moved to queue after consultation payment`);
        }
      }

      // === CHECK IF LAB TEST OR RADIOLOGY PAID ===
      if (invoice.visit && (paidItemType === 'lab_test' || paidItemType === 'imaging' || paidItemType === 'medication')) {
        const visit = await Visit.findById(invoice.visit._id)
          .populate('patient');
        
        if (visit) {
          await updateVisitOrderStatuses(visit, paidItemType);
        }
      }

      logger.info(`Invoice item paid: ${invoice.invoiceNumber} - Item ${itemIndex}`);

      res.status(200).json({
        status: 'success',
        message: 'Payment recorded successfully',
        data: invoice
      });
    } catch (error) {
      logger.error('Record item payment error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server Error'
      });
    }
});

// @desc    Pay for multiple invoice items at once
// @route   POST /api/billing/invoices/:invoiceId/pay-items
// @access  Private (Admin, Receptionist)
router.post('/invoices/:invoiceId/pay-items', 
  protect, 
  authorize('admin', 'receptionist'), 
  async (req, res) => {
    try {
      const { invoiceId } = req.params;
      const { itemIndices, method, amount } = req.body;

      const invoice = await Invoice.findById(invoiceId)
        .populate('visit')
        .populate({ path: 'visit', populate: { path: 'patient' }});
      
      if (!invoice) {
        return res.status(404).json({
          status: 'error',
          message: 'Invoice not found'
        });
      }

      if (!itemIndices || itemIndices.length === 0) {
        return res.status(400).json({
          status: 'error',
          message: 'No items selected for payment'
        });
      }

      // Mark selected items as paid and track what types were paid
      let consultationPaid = false;
      let labTestPaid = false;
      let radiologyPaid = false;
      let medicationPaid = false;

      itemIndices.forEach(index => {
        if (index < invoice.items.length) {
          invoice.items[index].paid = true;
          invoice.items[index].paidAt = new Date();
          
          // Check what type of item was paid
          const itemType = invoice.items[index].type;
          if (itemType === 'consultation') {
            consultationPaid = true;
          } else if (itemType === 'lab_test') {
            labTestPaid = true;
          } else if (itemType === 'imaging') {
            radiologyPaid = true;
          } else if (itemType === 'medication') {
            medicationPaid = true;
          }
        }
      });
      
      // Record payment
      const payment = {
        amount: amount,
        method: method || 'cash',
        paidBy: req.user.id,
        paidAt: new Date(),
        reference: `Payment for ${itemIndices.length} item(s)`
      };
      
      if (!invoice.payments) invoice.payments = [];
      invoice.payments.push(payment);
      
      // Recalculate totals
      invoice.amountPaid = (invoice.amountPaid || 0) + amount;
      invoice.balanceDue = invoice.totalAmount - invoice.amountPaid;
      
      // Update status
      if (invoice.balanceDue <= 0) {
        invoice.status = 'paid';
        invoice.paidDate = new Date();
      } else if (invoice.amountPaid > 0) {
        invoice.status = 'partial';
      }
      
      await invoice.save();

      // === CHECK IF CONSULTATION PAID FOR NON-INSURED PATIENT ===
      if (invoice.visit && consultationPaid) {
        const visit = invoice.visit;
        const hasInsurance = !!(visit.patient?.insurance?.provider);
        
        if (!hasInsurance && visit.status === 'Pending Payment') {
          visit.status = 'In Queue';
          visit.consultationFeePaid = true;
          await visit.save();
          logger.info(`Visit ${visit.visitId} moved to queue after consultation payment`);
        }
      }

      // === CHECK IF LAB TEST, RADIOLOGY, OR MEDICATION PAID ===
      if (invoice.visit) {
        const visit = await Visit.findById(invoice.visit._id)
          .populate('patient');
        
        if (visit) {
          if (labTestPaid) {
            await updateVisitOrderStatuses(visit, 'lab_test');
          }
          if (radiologyPaid) {
            await updateVisitOrderStatuses(visit, 'imaging');
          }
          if (medicationPaid) {
            await updateVisitOrderStatuses(visit, 'medication');
          }
        }
      }

      logger.info(`Invoice items paid: ${invoice.invoiceNumber} - ${itemIndices.length} items`);

      res.status(200).json({
        status: 'success',
        message: 'Payment recorded successfully',
        data: invoice
      });
    } catch (error) {
      logger.error('Pay invoice items error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server Error'
      });
    }
});

export default router;
