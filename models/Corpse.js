import mongoose from 'mongoose';

const CorpseSchema = new mongoose.Schema({
  firstName: { 
    type: String, 
    required: true 
  },
  middleName: { 
    type: String, 
    required: true 
  },
  lastName: { 
    type: String, 
    required: true 
  },
  sex: {
    type: String,
    enum: ['Male', 'Female'],
    required: true
  },
  dateOfBirth: {
    type: Date,
    required: true
  },
  dateOfDeath: { 
    type: Date, 
    required: true 
  },
  causeOfDeath: { 
    type: String 
  },
  cabinetNumber: { 
    type: String 
  },
  registeredBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  status: { 
    type: String, 
    enum: ['In Storage', 'Released', 'Awaiting Autopsy'], 
    default: 'In Storage' 
  },
  nextOfKin: {
    firstName: String,
    middleName: String,
    lastName: String,
    relationship: String,
    phone: String,
  },
}, { timestamps: true });

CorpseSchema.index({ status: 1, cabinetNumber: 1 });
CorpseSchema.index({ dateOfDeath: -1 });

CorpseSchema.pre('save', function(next) {
  if (this.dateOfDeath > new Date()) {
    next(new Error('Date of death cannot be in the future'));
  }
  if (this.dateOfDeath < this.dateOfBirth) {
    next(new Error('Date of death must be after date of birth'));
  }
  next();
});

export default mongoose.model('Corpse', CorpseSchema);