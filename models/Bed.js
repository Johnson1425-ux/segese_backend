import mongoose from 'mongoose';

const bedSchema = new mongoose.Schema({
  bedNumber: {
    type: String,
    required: [true, 'Bed number is required'],
    trim: true
  },
  ward: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ward',
    required: [true, 'Ward is required']
  },
  type: {
    type: String,
    enum: ['standard', 'icu', 'isolation', 'private', 'semi-private', 'pediatric', 'maternity'],
    default: 'standard'
  },
  status: {
    type: String,
    enum: ['available', 'occupied', 'maintenance', 'reserved', 'cleaning'],
    default: 'available'
  },
  features: [{
    type: String,
    enum: ['adjustable', 'electric', 'manual', 'oxygen_outlet', 'monitor', 'suction', 'call_button']
  }],
  currentPatient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient'
  },
  assignedNurse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastCleaned: {
    type: Date
  },
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot be more than 500 characters']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index to ensure bed number is unique within a ward
bedSchema.index({ bedNumber: 1, ward: 1 }, { unique: true });
bedSchema.index({ ward: 1 });
bedSchema.index({ status: 1 });
bedSchema.index({ currentPatient: 1 });

// Pre-save middleware to clear currentPatient when status changes to available
bedSchema.pre('save', function(next) {
  if (this.status === 'available' && this.currentPatient) {
    this.currentPatient = null;
  }
  next();
});

// Static method to get available beds in a ward
bedSchema.statics.getAvailableBedsInWard = async function(wardId) {
  return this.find({ ward: wardId, status: 'available', isActive: true });
};

// Static method to get bed statistics
bedSchema.statics.getStatistics = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  const result = {
    total: 0,
    available: 0,
    occupied: 0,
    maintenance: 0,
    reserved: 0,
    cleaning: 0
  };

  stats.forEach(stat => {
    result.total += stat.count;
    result[stat._id] = stat.count;
  });

  return result;
};

export default mongoose.model('Bed', bedSchema);