import mongoose from 'mongoose';

const RadiologyRequestSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
  },
  orderedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  visit: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Visit',
  },
  scanType: { // e.g., X-Ray, CT Scan, MRI
    type: String,
    required: [true, 'Please specify the scan type'],
  },
  bodyPart: {
    type: String,
    required: [true, 'Please specify the body part to be scanned'],
  },
  reason: {
    type: String,
    required: [true, 'Please provide a reason for the scan'],
  },
  status: {
    type: String,
    enum: ['Pending', 'Completed', 'Cancelled'],
    default: 'Pending',
  },
  findings: {
    type: String,
  },
  imageUrl: {
    type: String,
  },
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  completedAt: {
    type: Date,
  },
}, { timestamps: true });

export default mongoose.model('RadiologyRequest', RadiologyRequestSchema);