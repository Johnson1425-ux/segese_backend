import mongoose from 'mongoose';

const RequisitionItemSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Medicine',
    required: true
  },
  requestedQty: {
    type: Number,
    required: true,
    min: 1
  },
  issuedQty: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['Pending', 'Issued', 'Rejected', 'Partial'],
    default: 'Pending'
  },
  remarks: String
});

const RequisitionSchema = new mongoose.Schema({
  requisitionNumber: {
    type: String,
    unique: true,
    required: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestedFor: {
    department: {
      type: String,
      required: true,
      enum: ['Pharmacy', 'Surgery', 'Pediatrics', 'Maternity', 'Emergency', 'Outpatient', 'Laboratory', 'Radiology', 'Other']
    },
    location: String
  },
  items: [RequisitionItemSchema],
  status: {
    type: String,
    enum: ['Draft', 'Submitted', 'In Progress', 'Completed', 'Cancelled'],
    default: 'Submitted'
  },
  priority: {
    type: String,
    enum: ['Normal', 'Urgent', 'Emergency'],
    default: 'Normal'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  issuedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  issuedAt: Date,
  notes: String,
  internalNotes: String
}, {
  timestamps: true
});

// Generate requisition number
RequisitionSchema.statics.generateRequisitionNumber = async function() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  
  const lastReq = await this.findOne({
    requisitionNumber: new RegExp(`^REQ-${year}${month}`)
  }).sort({ requisitionNumber: -1 });
  
  let sequence = 1;
  if (lastReq) {
    const lastSequence = parseInt(lastReq.requisitionNumber.split('-')[2]);
    sequence = lastSequence + 1;
  }
  
  return `REQ-${year}${month}-${String(sequence).padStart(5, '0')}`;
};

// Update overall status based on items
RequisitionSchema.methods.updateStatus = function() {
  const allIssued = this.items.every(item => item.status === 'Issued');
  const allRejected = this.items.every(item => item.status === 'Rejected');
  const someIssued = this.items.some(item => item.status === 'Issued');
  
  if (allIssued) {
    this.status = 'Completed';
  } else if (allRejected) {
    this.status = 'Cancelled';
  } else if (someIssued) {
    this.status = 'In Progress';
  }
};

export default mongoose.model('Requisition', RequisitionSchema);