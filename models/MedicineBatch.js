import mongoose from "mongoose";

const MedicineBatchSchema = new mongoose.Schema({
  medicine: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Medicine',
    required: true,
  },
  purchaseOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder',
    required: true,
  },
  batchNumber: {
    type: String,
    required: true,
  },
  expiryDate: {
    type: Date,
    required: [true, 'Please provide expiry date'],
  },
  quantityReceived: {
    type: Number,
    required: true,
  },
  quantityRemaining: {
    type: Number,
    required: true,
  },
  buyingPrice: {
    type: Number,
    required: true,
  },
  sellingPrice: {
    type: Number,
    required: true,
  },
  location: {
    type: String,
    default: 'MAIN STORE',
  },
  status: {
    type: String,
    enum: ['active', 'depleted', 'expired', 'damaged'],
    default: 'active',
  },
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  receivedAt: {
    type: Date,
    default: Date.now,
  },
});

MedicineBatchSchema.pre('save', function(next) {
  if (this.quantityRemaining <= 0) {
    this.status = 'depleted';
  } else if (this.expiryDate < new Date()) {
    this.status = 'expired';
  }
  next();
});

export const MedicineBatch = mongoose.model('MedicineBatch', MedicineBatchSchema);