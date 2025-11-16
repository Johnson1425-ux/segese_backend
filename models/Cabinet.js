import mongoose from 'mongoose';

const CabinetSchema = new mongoose.Schema({
  number: {
    type: String,
    required: true,
    unique: true
  },
  location: {
    type: String,
    required: true
  },
  capacity: {
    type: Number,
    default: 1
  },
  isOccupied: {
    type: Boolean,
    default: false
  },
  occupiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Corpse',
    default: null
  },
  temperature: {
    type: Number,
    default: 4.0 // Celsius
  },
  status: {
    type: String,
    enum: ['Active', 'Maintenance', 'Out of Service'],
    default: 'Active'
  },
  lastMaintenance: {
    type: Date,
    default: Date.now
  },
  nextMaintenance: {
    type: Date
  },
  notes: {
    type: String
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  defaultAt: Date,
  deletedBy:{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }
}, { timestamps: true });

// Index for faster queries
CabinetSchema.index({ isOccupied: 1, status: 1 });

// Virtual for days until next maintenance
CabinetSchema.virtual('daysUntilMaintenance').get(function() {
  if (!this.nextMaintenance) return null;
  const today = new Date();
  const diffTime = this.nextMaintenance - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

CabinetSchema.pre(/^find/, function(next) {
  this.find({ isDeleted: { $ne: true } });
  next();
});

export default mongoose.model('Cabinet', CabinetSchema);