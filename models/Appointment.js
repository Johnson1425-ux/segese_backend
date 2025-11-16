import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema({
  appointmentId: {
    type: String,
    unique: true,
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  appointmentDate: {
    type: String,
    required: true
  },
  appointmentTime: {
    type: String,
    required: true
  },
  duration: {
    type: Number, // in minutes
    default: 30
  },
  type: {
    type: String,
    enum: [ // Corrected to lowercase
      'consultation',
      'follow-up',
      'emergency',
      'routine'
    ],
    required: true
  },
  status: {
    type: String,
    enum: [ // Corrected to lowercase
      'scheduled',
      'confirmed',
      'in-progress',
      'completed',
      'cancelled',
      'no-show'
    ],
    default: 'scheduled'
  },
  reason: {
    type: String,
    required: true
  },
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
}, {
  timestamps: true,
});

// Pre-save middleware to generate appointment ID
appointmentSchema.pre('save', async function(next) {
  if (this.isNew && !this.appointmentId) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(year, 0, 1),
        $lt: new Date(year + 1, 0, 1)
      }
    });
    this.appointmentId = `A${year}${(count + 1).toString().padStart(4, '0')}`;
  }
  next();
});

export default mongoose.model('Appointment', appointmentSchema);