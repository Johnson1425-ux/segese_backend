import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  paymentNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  method: {
    type: String,
    enum: ['cash', 'credit_card', 'debit_card', 'check', 'bank_transfer', 'insurance', 'online', 'other'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled'],
    default: 'pending'
  },
  transactionId: {
    type: String,
    sparse: true
  },
  gateway: {
    type: String,
    enum: ['stripe', 'paypal', 'square', 'razorpay', 'manual', 'other']
  },
  gatewayResponse: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  cardDetails: {
    last4: String,
    brand: String,
    expiryMonth: Number,
    expiryYear: Number,
    holderName: String
  },
  checkDetails: {
    checkNumber: String,
    bankName: String,
    accountNumber: String,
    routingNumber: String
  },
  insuranceDetails: {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InsuranceProvider'
    },
    claimNumber: String,
    approvalCode: String,
    coverageAmount: Number,
    patientResponsibility: Number
  },
  refundDetails: {
    refundedAmount: {
      type: Number,
      default: 0
    },
    refundReason: String,
    refundedAt: Date,
    refundedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    refundTransactionId: String
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  receiptNumber: String,
  notes: String,
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes
paymentSchema.index({ patient: 1, status: 1, createdAt: -1 });
paymentSchema.index({ invoice: 1, status: 1 });
// paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ paymentDate: -1 });

// Static method to generate payment number
paymentSchema.statics.generatePaymentNumber = async function() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  const lastPayment = await this.findOne({
    paymentNumber: new RegExp(`^PAY-${year}${month}${day}`)
  }).sort({ paymentNumber: -1 });
  
  let sequence = 1;
  if (lastPayment) {
    const lastSequence = parseInt(lastPayment.paymentNumber.split('-')[2]);
    sequence = lastSequence + 1;
  }
  
  return `PAY-${year}${month}${day}-${String(sequence).padStart(4, '0')}`;
};

// Method to process refund
paymentSchema.methods.processRefund = async function(amount, reason, userId) {
  if (amount > this.amount - this.refundDetails.refundedAmount) {
    throw new Error('Refund amount exceeds payment amount');
  }
  
  this.refundDetails.refundedAmount += amount;
  this.refundDetails.refundReason = reason;
  this.refundDetails.refundedAt = new Date();
  this.refundDetails.refundedBy = userId;
  
  if (this.refundDetails.refundedAmount >= this.amount) {
    this.status = 'refunded';
  }
  
  await this.save();
  return this;
};

export default mongoose.model('Payment', paymentSchema);
