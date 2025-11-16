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
    ref: 'Visit'
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

// Method to calculate totals
invoiceSchema.methods.calculateTotals = function() {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;
  let insuranceCoverage = 0;

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
    
    if (item.coveredByInsurance && item.insuranceApproved) {
      insuranceCoverage += item.total;
    }
  });

  this.subtotal = subtotal;
  this.totalDiscount = totalDiscount;
  this.totalTax = totalTax;
  this.totalAmount = subtotal - totalDiscount + totalTax;
  
  if (this.insuranceCoverage && this.insuranceCoverage.coverageAmount) {
    this.insuranceCoverage.coverageAmount = Math.min(insuranceCoverage, this.insuranceCoverage.coverageAmount);
    this.patientResponsibility = this.totalAmount - this.insuranceCoverage.coverageAmount;
  } else {
    this.patientResponsibility = this.totalAmount;
  }
  
  this.balanceDue = this.totalAmount - this.amountPaid;
};

// Method to add payment
invoiceSchema.methods.addPayment = function(amount) {
  this.amountPaid += amount;
  this.balanceDue = this.totalAmount - this.amountPaid;
  
  if (this.balanceDue <= 0) {
    this.status = 'paid';
    this.paidDate = new Date();
  } else if (this.amountPaid > 0) {
    this.status = 'partial';
  }
};

// Method to check and update overdue status
invoiceSchema.methods.checkOverdueStatus = function() {
  if (this.status === 'pending' && this.dueDate < new Date()) {
    this.status = 'overdue';
    return true;
  }
  return false;
};

// Static method to generate invoice number
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

// Pre-save hook to calculate totals
invoiceSchema.pre('save', function(next) {
  this.calculateTotals();
  this.checkOverdueStatus();
  next();
});

export default mongoose.model('Invoice', invoiceSchema);
