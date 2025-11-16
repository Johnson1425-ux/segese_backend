import mongoose from 'mongoose';

const SoldMedicineSchema = new mongoose.Schema({
  name: String,
  qty: Number,
  price: Number,
});

const DirectDispensingSchema = new mongoose.Schema({
  clientName: {
    type: String,
    required: true,
  },
  medicines: [SoldMedicineSchema],
  totalCost: {
    type: Number,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model('DirectDispensing', DirectDispensingSchema);