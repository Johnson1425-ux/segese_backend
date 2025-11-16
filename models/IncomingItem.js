import mongoose from 'mongoose';

const IncomingItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
  },
  from: {
    type: String,
    default: 'Main Store',
  },
  received: {
    type: Boolean,
    default: false,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model('IncomingItem', IncomingItemSchema);