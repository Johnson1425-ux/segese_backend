import mongoose from 'mongoose';
import { nextSequence, highestExisting } from '../utils/sequence.js';

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
// receiptNumber is already indexed by `unique: true` on the field; declaring
// it again here made mongoose warn about a duplicate index at startup.

// Generate receipt number before saving
ReleaseSchema.pre('save', async function(next) {
  if (!this.receiptNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const prefix = `REL-${year}${month}${day}-`;

    // Was derived from a same-day countDocuments(), which collided under
    // concurrency and reissued numbers after a release was deleted.
    const sequence = await nextSequence(`release:${year}${month}${day}`, {
      seedFrom: () => highestExisting(mongoose.model('Release'), 'receiptNumber', prefix),
    });

    this.receiptNumber = `${prefix}${String(sequence).padStart(3, '0')}`;
  }
  next();
});

export default mongoose.model('Release', ReleaseSchema);
