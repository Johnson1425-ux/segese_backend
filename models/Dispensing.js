import mongoose from 'mongoose';

const DispensingSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.ObjectId,
    ref: 'Patient',
    required: true,
  },
  medicine: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
  },
  issuedBy: {
    type: String, // Or could be a ref to a User model
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model('Dispensing', DispensingSchema);