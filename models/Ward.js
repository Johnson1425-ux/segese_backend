import mongoose from 'mongoose';

const wardSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Ward name is required'],
    trim: true,
    maxlength: [100, 'Ward name cannot be more than 100 characters']
  },
  wardNumber: {
    type: String,
    required: [true, 'Ward number is required'],
    unique: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['general', 'icu', 'ccu', 'nicu', 'pediatric', 'maternity', 'surgical', 'medical', 'orthopedic', 'emergency', 'isolation', 'private'],
    required: [true, 'Ward type is required']
  },
  floor: {
    type: Number,
    required: [true, 'Floor number is required']
  },
  capacity: {
    type: Number,
    required: [true, 'Ward capacity is required'],
    min: [1, 'Capacity must be at least 1']
  },
  occupiedBeds: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  headNurse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance', 'full'],
    default: 'active'
  },
  facilities: [{
    type: String,
    enum: ['oxygen', 'ventilator', 'monitor', 'bathroom', 'shower', 'tv', 'wifi', 'air_conditioning', 'heating']
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for available beds
wardSchema.virtual('availableBeds').get(function() {
  return this.capacity - this.occupiedBeds;
});

// Virtual for occupancy rate
wardSchema.virtual('occupancyRate').get(function() {
  return this.capacity > 0 ? ((this.occupiedBeds / this.capacity) * 100).toFixed(2) : 0;
});

// Indexes
// wardSchema.index({ wardNumber: 1 });
wardSchema.index({ type: 1 });
wardSchema.index({ status: 1 });
wardSchema.index({ floor: 1 });

// Pre-save middleware to update status based on occupancy
wardSchema.pre('save', function(next) {
  if (this.occupiedBeds >= this.capacity) {
    this.status = 'full';
  } else if (this.status === 'full' && this.occupiedBeds < this.capacity) {
    this.status = 'active';
  }
  next();
});

// Static method to get ward statistics
wardSchema.statics.getStatistics = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        totalWards: { $sum: 1 },
        totalCapacity: { $sum: '$capacity' },
        totalOccupied: { $sum: '$occupiedBeds' },
        activeWards: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        }
      }
    }
  ]);

  const result = stats[0] || { totalWards: 0, totalCapacity: 0, totalOccupied: 0, activeWards: 0 };
  result.totalAvailable = result.totalCapacity - result.totalOccupied;
  result.overallOccupancyRate = result.totalCapacity > 0 
    ? ((result.totalOccupied / result.totalCapacity) * 100).toFixed(2) 
    : 0;

  return result;
};

export default mongoose.model('Ward', wardSchema);