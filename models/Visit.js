// import { result } from 'lodash';
import mongoose from 'mongoose';
import { type } from 'os';

// Sub-schema for Vital Signs
const vitalSignsSchema = new mongoose.Schema({
  temperature: Number,
  bloodPressure: String, // e.g., "120/80"
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

// Sub-schema for Lab Orders
const labOrderSchema = new mongoose.Schema({
  testName: { type: String, required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  orderedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['Pending', 'Completed', 'Cancelled'], default: 'Pending' },
  results: String,
  notes: String,
}, { timestamps: true });

// Sub-schema for Prescriptions
const prescriptionSchema = new mongoose.Schema({
  medication: { type: String, required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  dosage: { type: String, required: true },
  frequency: { type: String, required: true },
  duration: String,
  notes: String,
  prescribedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  isActive: {
    type: Boolean,
    default: true
  }
});


const visitSchema = new mongoose.Schema({
  visitId: { type: String, unique: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  visitDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['Pending Payment', 'In Queue', 'In-Progress', 'completed'], default: 'Pending Payment' },
  type: { type: String, enum: ['consultation', 'emergency', 'follow-up', 'routine'], required: true },
  reason: { type: String, required: true },
  symptoms: [String],
  startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  room: String,
  notes: String,
  duration: Number,
  vitalSigns: vitalSignsSchema,
  diagnosis: [diagnosisSchema],
  labOrders: [labOrderSchema],
  prescriptions: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Prescription'
  },

  isActive: {
    type: Boolean,
    default: true
  }

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

// Instance method to end visit
visitSchema.methods.endVisit = function(endedById, endNotes = '') {
  if (this.status !== 'active') throw new Error('Visit is not active.');
  this.status = 'completed';
  this.endedBy = endedById;
  if (endNotes) {
    this.notes = `${this.notes || ''}\nEnd Note: ${endNotes}`;
  }
  return this.save();
};

export default mongoose.model('Visit', visitSchema);