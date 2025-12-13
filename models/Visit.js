import mongoose from 'mongoose';

// Sub-schema for Vital Signs
const vitalSignsSchema = new mongoose.Schema({
  temperature: Number,
  bloodPressure: String,
  heartRate: Number,
  respiratoryRate: Number,
  oxygenSaturation: Number,
}, { _id: false });

// Sub-schema for Diagnosis
const diagnosisSchema = new mongoose.Schema({
  condition: { type: String, required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  diagnosedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  notes: String,
  icd10Code: String,
  isFinal: { type: Boolean, default: false }
}, { _id: false });

// Sub-schema for Lab Orders (Clinical tracking only)
const labOrderSchema = new mongoose.Schema({
  testName: { type: String, required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  orderedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['Pending Payment', 'Pending', 'Completed', 'Cancelled'], default: 'Pending' },
  results: String,
  notes: String,
  completedAt: Date,
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  price: Number,
}, { timestamps: true });

const radiologySchema = new mongoose.Schema({
  scanType: { type: String, required: true },
  bodyPart: { type: String, required: true },
  reason: { type: String, required: true},
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  orderedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['Pending Payment', 'Pending', 'In Progress', 'Completed', 'Cancelled'], default: 'Pending' },
  findings: { type: String },
  notes: { type: String },
  completedAt: { type: Date },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Sub-schema for Prescriptions (Clinical tracking only)
const prescriptionSchema = new mongoose.Schema({
  medication: { type: String, required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  dosage: { type: String, required: true },
  frequency: { type: String, required: true },
  duration: String,
  notes: String,
  prescribedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['Pending Payment', 'Pending', 'Dispensed'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
});

const visitSchema = new mongoose.Schema({
  visitId: { type: String, unique: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  visitDate: { type: Date, default: Date.now },
  status: { 
    type: String, 
    enum: ['Pending Payment', 'In Queue', 'In-Progress', 'completed'], 
    default: 'Pending Payment' 
  },
  type: { 
    type: String, 
    enum: ['consultation', 'emergency', 'follow-up', 'routine'], 
    required: true 
  },
  reason: { type: String, required: true },
  symptoms: [String],
  startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  room: String,
  notes: String,
  duration: Number,
  
  // Clinical data
  vitalSigns: vitalSignsSchema,
  diagnosis: [diagnosisSchema],
  labOrders: [labOrderSchema],
  radiologyOrders: [radiologySchema],
  prescriptions: [prescriptionSchema],
  
  // Financial tracking (simplified - main data is in Invoice)
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice'
  },
  consultationFeePaid: { type: Boolean, default: false },
  consultationFeeAmount: { type: Number, default: 0 },

  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

// Pre-save middleware to generate visit ID
visitSchema.pre('save', async function(next) {
  if (this.isNew && !this.visitId) {
    const year = new Date().getFullYear().toString().slice(-2);
    const count = await this.constructor.countDocuments();
    this.visitId = `V${year}${(count + 1).toString().padStart(5, '0')}`;
  }
  next();
});

// Virtual to get financial summary from invoice
visitSchema.virtual('financialSummary').get(async function() {
  if (!this.invoice) return null;
  
  const Invoice = mongoose.model('Invoice');
  const invoice = await Invoice.findById(this.invoice);
  
  return invoice ? {
    invoiceNumber: invoice.invoiceNumber,
    totalAmount: invoice.totalAmount,
    amountPaid: invoice.amountPaid,
    balanceDue: invoice.balanceDue,
    status: invoice.status
  } : null;
});

// Method to get payment summary
visitSchema.methods.getPaymentSummary = function() {
  return {
    visitId: this.visitId,
    totalCharges: this.totalCharges,
    insuranceCoverage: this.insuranceCoverage,
    patientResponsibility: this.patientResponsibility,
    totalPaid: this.totalPaid,
    outstandingBalance: this.outstandingBalance,
    consultationFeePaid: this.consultationFeePaid,
    allServicesPaid: this.allServicesPaid,
    serviceCharges: this.serviceCharges,
    paymentRecords: this.paymentRecords
  };
};

// Instance method to end visit
visitSchema.methods.endVisit = function(endedById, endNotes = '') {
  if (this.status !== 'In-Progress') {
    throw new Error('Visit is not in progress.');
  }
  this.status = 'completed';
  this.endedBy = endedById;
  if (endNotes) {
    this.notes = `${this.notes || ''}\nEnd Note: ${endNotes}`;
  }
  return this.save();
};

// Static method to get visits with outstanding invoices
visitSchema.statics.getVisitsWithOutstandingPayments = async function() {
  const Invoice = mongoose.model('Invoice');
  
  // Get all unpaid invoices
  const unpaidInvoices = await Invoice.find({
    status: { $in: ['pending', 'partial', 'overdue'] },
    balanceDue: { $gt: 0 }
  }).select('_id');
  
  const invoiceIds = unpaidInvoices.map(inv => inv._id);
  
  return this.find({
    invoice: { $in: invoiceIds },
    isActive: true
  }).populate('patient', 'firstName lastName patientId')
    .populate('doctor', 'firstName lastName')
    .populate('invoice');
};

export default mongoose.model('Visit', visitSchema);