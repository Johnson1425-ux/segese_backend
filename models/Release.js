import mongoose from 'mongoose';

const ReleaseSchema = new mongoose.Schema({
  corpseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Corpse',
    required: true
  },
  releaseType: {
    type: String,
    enum: ['Burial', 'Cremation', 'Transfer', 'Repatriation'],
    required: true
  },
  releasedTo: {
    name: {
      type: String,
      required: true
    },
    relationship: String,
    idNumber: String,
    phone: String,
    address: String
  },
  funeralHome: {
    name: String,
    contactPerson: String,
    phone: String,
    address: String,
    licenseNumber: String
  },
  releaseDate: {
    type: Date,
    required: true
  },
  authorizedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  documents: [{
    type: {
      type: String,
      enum: ['Death Certificate', 'Burial Permit', 'ID Copy', 'Release Form', 'Other'],
      required: true
    },
    filename: String,
    uploadDate: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Released', 'Cancelled'],
    default: 'Pending'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvalDate: Date,
  completedDate: {
    type: Date
  },
  cancelledDate: {
    type: Date
  },
  releaseNotes: String,
  cancellationReason: String,
  receiptNumber: {
    type: String,
    unique: true
  }
}, { timestamps: true });

ReleaseSchema.index({ status: 1, releaseDate: 1 });
ReleaseSchema.index({ corpseId: 1 });
ReleaseSchema.index({ receiptNumber: 1 });

// Generate receipt number before saving
ReleaseSchema.pre('save', async function(next) {
  if (!this.receiptNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    // Find the latest release for today to get sequential number
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const count = await mongoose.model('Release').countDocuments({
      createdAt: { $gte: today, $lt: tomorrow }
    });
    
    const sequential = String(count + 1).padStart(3, '0');
    this.receiptNumber = `REL-${year}${month}${day}-${sequential}`;
  }
  next();
});

export default mongoose.model('Release', ReleaseSchema);
