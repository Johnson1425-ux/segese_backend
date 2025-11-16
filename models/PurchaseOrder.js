import mongoose from 'mongoose';

const PurchaseOrderSchema = new mongoose.Schema({
  poNumber: {
    type: String,
    required: [true, 'Please provide PO number'],
    unique: true,
    trim: true,
  },
  supplier: {
    name: {
      type: String,
      required: [true, 'Please provide supplier name'],
    },
    contact: String,
    email: String,
    phone: String,
  },
  totalAmount: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'partial', 'completed', 'cancelled'],
    default: 'pending',
  },
  receivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: {
    type: Date,
  },
  notes: String,
});

export default mongoose.model('PurchaseOrder', PurchaseOrderSchema);