import mongoose from 'mongoose';

const StockItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    unique: true,
    trim: true,
  },
  category: {
    type: String,
    required: [true, 'Please add a category'],
  },
  quantity: {
    type: Number,
    required: [true, 'Please add a quantity'],
  },
  reorder: {
    type: Number,
    required: [true, 'Please add a reorder level'],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model('StockItem', StockItemSchema);