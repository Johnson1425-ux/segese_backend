import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true
  },
  visit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Visit',
    unique: true,
    sparse: true // Allows null values while maintaining uniqueness for non-null values
  },
  appointment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  },
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'partial', 'paid', 'overdue', 'cancelled', 'refunded'],
    default: 'pending'
  },
  items: [{
    type: {
      type: String,
      enum: ['consultation', 'procedure', 'medication', 'lab_test', 'imaging', 'room_charge', 'equipment', 'other'],
      required: true
    },
    code: String,
    description: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0
    },
    discount: {
      type: Number,
      default: 0,
      min: 0
    },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'fixed'
    },
    tax: {
      type: Number,
      default: 0,
      min: 0
    },
    taxType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage'
    },
    total: {
      type: Number,
      required: true
    },
    coveredByInsurance: {
      type: Boolean,
      default: false
    },
    insuranceApproved: {
      type: Boolean,
      default: false
    },
    paid: {
      type: Boolean,
      default: false
    },
    paidAt: {
      type: Date
    },
    // NEW: Track which payment this item was paid with
    paymentId: {
      type: mongoose.Schema.Types.ObjectId
    },
    notes: String
  }],
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  totalDiscount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalTax: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  insuranceCoverage: {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InsuranceProvider'
    },
    policyNumber: String,
    coverageAmount: {
      type: Number,
      default: 0
    },
    approvalCode: String,
    claimNumber: String,
    status: {
      type: String,
      enum: ['pending', 'approved', 'partial', 'rejected', 'processing'],
      default: 'pending'
    },
    notes: String
  },
  patientResponsibility: {
    type: Number,
    default: 0
  },
  amountPaid: {
    type: Number,
    default: 0,
    min: 0
  },
  balanceDue: {
    type: Number,
    default: 0
  },
  // Payment records embedded in invoice (single source of truth)
  payments: [{
    amount: {
      type: Number,
      required: true
    },
    method: {
      type: String,
      enum: ['cash', 'credit_card', 'debit_card', 'mobile_money', 'bank_transfer', 'insurance'],
      required: true
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    paidAt: {
      type: Date,
      default: Date.now
    },
    reference: String,
    notes: String,
    // NEW: Track which items were paid in this payment
    itemIndices: [Number]
  }],
  paymentTerms: {
    type: String,
    enum: ['immediate', 'net_15', 'net_30', 'net_45', 'net_60', 'installment'],
    default: 'immediate'
  },
  dueDate: {
    type: Date,
    required: true
  },
  issueDate: {
    type: Date,
    default: Date.now
  },
  paidDate: Date,
  notes: String,
  internalNotes: String,
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes for better query performance
invoiceSchema.index({ patient: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ status: 1, dueDate: 1 });
invoiceSchema.index({ 'insuranceCoverage.provider': 1, 'insuranceCoverage.status': 1 });

// Virtual for checking if invoice is overdue
invoiceSchema.virtual('isOverdue').get(function() {
  return this.status === 'pending' && this.dueDate < new Date();
});

// Virtual to get unpaid items count
invoiceSchema.virtual('unpaidItemsCount').get(function() {
  return this.items.filter(item => !item.paid).length;
});

// Virtual to get total unpaid amount
invoiceSchema.virtual('unpaidAmount').get(function() {
  return this.items
    .filter(item => !item.paid)
    .reduce((sum, item) => sum + item.total, 0);
});

/**
 * UNIFIED CALCULATION METHOD
 * Single source of truth for all invoice calculations
 * Uses payments array as primary source, items[].paid as secondary indicator
 */
invoiceSchema.methods.calculateTotals = function() {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;
  let insuranceCoverage = 0;

  // Calculate item totals
  this.items.forEach(item => {
    const itemSubtotal = item.quantity * item.unitPrice;
    
    // Calculate discount
    let discount = 0;
    if (item.discountType === 'percentage') {
      discount = (itemSubtotal * item.discount) / 100;
    } else {
      discount = item.discount;
    }
    
    // Calculate tax
    let tax = 0;
    const afterDiscount = itemSubtotal - discount;
    if (item.taxType === 'percentage') {
      tax = (afterDiscount * item.tax) / 100;
    } else {
      tax = item.tax;
    }
    
    item.total = afterDiscount + tax;
    subtotal += itemSubtotal;
    totalDiscount += discount;
    totalTax += tax;
    
    // Insurance coverage calculation
    if (item.coveredByInsurance && item.insuranceApproved) {
      insuranceCoverage += item.total;
    }
  });

  this.subtotal = subtotal;
  this.totalDiscount = totalDiscount;
  this.totalTax = totalTax;
  this.totalAmount = subtotal - totalDiscount + totalTax;
  
  // Insurance coverage
  if (this.insuranceCoverage && this.insuranceCoverage.coverageAmount) {
    this.insuranceCoverage.coverageAmount = Math.min(insuranceCoverage, this.insuranceCoverage.coverageAmount);
    this.patientResponsibility = this.totalAmount - this.insuranceCoverage.coverageAmount;
  } else {
    this.patientResponsibility = this.totalAmount;
  }
  
  // UNIFIED PAYMENT CALCULATION
  // Calculate amountPaid from payments array (single source of truth)
  this.amountPaid = this.payments.reduce((sum, payment) => sum + payment.amount, 0);
  this.balanceDue = this.totalAmount - this.amountPaid;
  
  // Update status based on balance
  this._updatePaymentStatus();
};

/**
 * CENTRALIZED STATUS UPDATE
 * Single method to handle all status transitions
 */
invoiceSchema.methods._updatePaymentStatus = function() {
  const now = new Date();
  
  // Check if fully paid
  if (this.balanceDue <= 0 && this.amountPaid > 0) {
    this.status = 'paid';
    if (!this.paidDate) {
      this.paidDate = now;
    }
    // Ensure all items are marked as paid
    this.items.forEach(item => {
      if (!item.paid) {
        item.paid = true;
        item.paidAt = now;
      }
    });
  } 
  // Check if partially paid
  else if (this.amountPaid > 0 && this.balanceDue > 0) {
    this.status = 'partial';
  }
  // Check if overdue
  else if (this.status === 'pending' && this.dueDate < now) {
    this.status = 'overdue';
  }
  // Default to pending
  else if (this.amountPaid === 0 && this.status === 'paid') {
    this.status = 'pending';
    this.paidDate = null;
  }
};

/**
 * IMPROVED: Pay specific items with proper payment tracking
 * @param {Array} itemIndices - Array of item indices to mark as paid
 * @param {Object} paymentInfo - Payment details (method, paidBy, reference, notes)
 * @returns {Number} - Total amount paid
 */
invoiceSchema.methods.payItems = function(itemIndices, paymentInfo) {
  const now = new Date();
  let totalPaid = 0;
  const paidItemsList = [];

  // Mark items as paid and calculate total
  itemIndices.forEach(index => {
    if (index < this.items.length && !this.items[index].paid) {
      this.items[index].paid = true;
      this.items[index].paidAt = now;
      totalPaid += this.items[index].total;
      paidItemsList.push({
        index: index,
        description: this.items[index].description,
        amount: this.items[index].total
      });
    }
  });

  // Don't add payment if nothing was actually paid
  if (totalPaid === 0) {
    return 0;
  }

  // Create payment record with item tracking
  const paymentRecord = {
    amount: totalPaid,
    method: paymentInfo.method || 'cash',
    paidBy: paymentInfo.paidBy,
    paidAt: now,
    reference: paymentInfo.reference || `Payment for ${itemIndices.length} item(s)`,
    notes: paymentInfo.notes,
    itemIndices: itemIndices // Track which items this payment covers
  };

  // Generate unique payment ID for tracking
  const paymentId = new mongoose.Types.ObjectId();
  
  // Link payment to paid items
  itemIndices.forEach(index => {
    if (index < this.items.length) {
      this.items[index].paymentId = paymentId;
    }
  });

  // Add payment to array
  if (!this.payments) this.payments = [];
  this.payments.push(paymentRecord);

  // Recalculate totals (this also updates status)
  this.calculateTotals();

  return totalPaid;
};

/**
 * LEGACY SUPPORT: Add payment without specifying items
 * Marks items as paid in order until amount is exhausted
 * @param {Number} amount - Payment amount
 */
invoiceSchema.methods.addPayment = function(amount) {
  const now = new Date();
  let remainingAmount = amount;
  const paidIndices = [];

  // Find unpaid items and mark them as paid until amount is exhausted
  for (let i = 0; i < this.items.length && remainingAmount > 0; i++) {
    if (!this.items[i].paid) {
      const itemTotal = this.items[i].total;
      
      if (remainingAmount >= itemTotal) {
        // Full item payment
        this.items[i].paid = true;
        this.items[i].paidAt = now;
        remainingAmount -= itemTotal;
        paidIndices.push(i);
      } else {
        // Partial payment - don't mark as paid
        break;
      }
    }
  }

  // Add payment record
  if (!this.payments) this.payments = [];
  this.payments.push({
    amount: amount,
    method: 'cash', // Default for legacy
    paidAt: now,
    reference: 'Legacy payment',
    itemIndices: paidIndices
  });

  // Recalculate totals
  this.calculateTotals();
};

/**
 * Method to check and update overdue status
 */
invoiceSchema.methods.checkOverdueStatus = function() {
  if (this.status === 'pending' && this.dueDate < new Date()) {
    this.status = 'overdue';
    return true;
  }
  return false;
};

/**
 * Get payment summary
 */
invoiceSchema.methods.getPaymentSummary = function() {
  return {
    totalAmount: this.totalAmount,
    amountPaid: this.amountPaid,
    balanceDue: this.balanceDue,
    status: this.status,
    paymentsCount: this.payments.length,
    unpaidItemsCount: this.unpaidItemsCount,
    unpaidAmount: this.unpaidAmount
  };
};

/**
 * Static method to generate invoice number
 */
invoiceSchema.statics.generateInvoiceNumber = async function() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  
  const lastInvoice = await this.findOne({
    invoiceNumber: new RegExp(`^INV-${year}${month}`)
  }).sort({ invoiceNumber: -1 });
  
  let sequence = 1;
  if (lastInvoice) {
    const lastSequence = parseInt(lastInvoice.invoiceNumber.split('-')[2]);
    sequence = lastSequence + 1;
  }
  
  return `INV-${year}${month}-${String(sequence).padStart(5, '0')}`;
};

/**
 * IMPROVED PRE-SAVE HOOK
 * Only calculates totals, doesn't duplicate logic
 */
invoiceSchema.pre('save', function(next) {
  // Only recalculate if items or payments changed
  if (this.isModified('items') || this.isModified('payments')) {
    this.calculateTotals();
  }
  
  // Check overdue status
  this.checkOverdueStatus();
  
  next();
});

export default mongoose.model('Invoice', invoiceSchema);
