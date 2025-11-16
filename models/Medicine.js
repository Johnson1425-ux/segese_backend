import mongoose from "mongoose";

const MedicineSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add medicine name'],
    trim: true,
  },
  genericName: {
    type: String,
    trim: true,
  },
  type: {
    type: String,
    enum: ['Syrup', 'Injection', 'Infusion', 'Gel', 'Capsule', 'Tablet', 'Cream', 'Drop', 'Inhaler', 'Other'],
    required: true,
  },
  strength: {
    type: String, // e.g., "500mg", "10ml"
  },
  manufacturer: {
    type: String,
  },
  category: {
    type: String,
    // enum: ['Antibiotic', 'Analgesic', 'Antiviral', 'Antifungal', 'Cardiovascular', 'Diabetic', 'Other']
  },
  sellingPrice: {
    type: Number,
    required: [true, 'Please add selling price'],
  },
  prices: {
    BRITAM: { type: Number, default: '-' },
    NSSF: { type: Number, default: '-' },
    NHIF: { type: Number, default: '-' },
    ASSEMBLE: { type: Number, default: '-' },
    Pharmacy: { type: Number, default: '-' },
    HospitalShop: { type: Number, default: '-' },
  },
  reorderLevel: {
    type: Number,
    default: 10,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for uniqueness
MedicineSchema.index({ name: 1, type: 1, strength: 1 }, { unique: true });

export const Medicine = mongoose.model('Medicine', MedicineSchema);