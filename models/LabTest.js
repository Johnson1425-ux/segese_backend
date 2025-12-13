import mongoose from 'mongoose';

const labTestSchema = new mongoose.Schema({
  testName: {
    type: String,
    required: false,
    trim: true
  },
  patient:{
    type: mongoose.Schema.ObjectId,
    ref: 'Patient',
    required: true
  },
  orderedBy:{
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Completed', 'Cancelled'],
    default: 'Pending'
  },
  results: {
    type: String
  },
  category: {
    type: String,
    required: false,
    enum: ['Hematology', 'Chemistry', 'Microbiology', 'Imaging', 'Other'],
  },
  code: { // Optional test code like LOINC
    type: String,
    unique: true,
    sparse: true
  }
}, { timestamps: true });

export default mongoose.model('LabTest', labTestSchema);