import mongoose from 'mongoose';

const ipdRecordSchema = new mongoose.Schema({
  admissionNumber: {
    type: String,
    unique: true
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: [true, 'Patient is required']
  },
  ward: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ward',
    required: [true, 'Ward is required']
  },
  bed: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bed',
    required: [true, 'Bed is required']
  },
  admissionDate: {
    type: Date,
    required: [true, 'Admission date is required'],
    default: Date.now
  },
  dischargeDate: {
    type: Date
  },
  admissionReason: {
    type: String,
    required: [true, 'Admission reason is required'],
    maxlength: [1000, 'Admission reason cannot be more than 1000 characters']
  },
  diagnosis: [{
    condition: {
      type: String,
      required: true
    },
    diagnosedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    diagnosedDate: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],
  admittingDoctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Admitting doctor is required']
  },
  assignedNurse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  emergencyContact: {
    name: {
      type: String,
      required: [true, 'Emergency contact name is required']
    },
    relationship: String,
    phone: {
      type: String,
      required: [true, 'Emergency contact phone is required']
    },
    email: String
  },
  insurance: {
    provider: String,
    policyNumber: String,
    approvalNumber: String,
    coverageAmount: Number
  },
  status: {
    type: String,
    enum: ['admitted', 'under_observation', 'critical', 'stable', 'discharged', 'transferred', 'deceased', 'absconded'],
    default: 'admitted'
  },
  admissionType: {
    type: String,
    enum: ['emergency', 'elective', 'transfer', 'observation'],
    required: [true, 'Admission type is required']
  },
  expectedDischargeDate: {
    type: Date
  },
  actualDischargeDate: {
    type: Date
  },
  dischargeReason: {
    type: String,
    enum: ['recovered', 'referred', 'against_medical_advice', 'deceased', 'absconded', 'transferred'],
  },
  dischargeSummary: {
    type: String,
    maxlength: [2000, 'Discharge summary cannot be more than 2000 characters']
  },
  dischargedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  treatments: [{
    treatment: String,
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    performedDate: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],
  medications: [{
    medication: String,
    dosage: String,
    frequency: String,
    startDate: Date,
    endDate: Date,
    prescribedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: String
  }],
  vitalSigns: [{
    recordedDate: {
      type: Date,
      default: Date.now
    },
    bloodPressure: {
      systolic: Number,
      diastolic: Number
    },
    heartRate: Number,
    temperature: Number,
    respiratoryRate: Number,
    oxygenSaturation: Number,
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: String
  }],
  nursingNotes: [{
    note: {
      type: String,
      required: true
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    recordedDate: {
      type: Date,
      default: Date.now
    },
    category: {
      type: String,
      enum: ['general', 'medication', 'vital_signs', 'treatment', 'observation', 'incident'],
      default: 'general'
    }
  }],
  procedures: [{
    procedure: {
      type: String,
      required: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    performedDate: {
      type: Date,
      default: Date.now
    },
    outcome: String,
    complications: String,
    notes: String
  }],
  billing: {
    totalAmount: {
      type: Number,
      default: 0
    },
    paidAmount: {
      type: Number,
      default: 0
    },
    balance: {
      type: Number,
      default: 0
    }
  },
  notes: {
    type: String,
    maxlength: [2000, 'Notes cannot be more than 2000 characters']
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

// Virtual for length of stay
ipdRecordSchema.virtual('lengthOfStay').get(function() {
  const endDate = this.dischargeDate || new Date();
  const startDate = this.admissionDate;
  const diffTime = Math.abs(endDate - startDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Indexes
// ipdRecordSchema.index({ admissionNumber: 1 });
ipdRecordSchema.index({ patient: 1 });
ipdRecordSchema.index({ ward: 1 });
ipdRecordSchema.index({ bed: 1 });
ipdRecordSchema.index({ status: 1 });
ipdRecordSchema.index({ admissionDate: -1 });
ipdRecordSchema.index({ admittingDoctor: 1 });

// Pre-save middleware to generate admission number
ipdRecordSchema.pre('save', async function(next) {
  if (this.isNew && !this.admissionNumber) {
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(year, 0, 1),
        $lt: new Date(year + 1, 0, 1)
      }
    });
    this.admissionNumber = `ADM${year}${(count + 1).toString().padStart(5, '0')}`;
  }
  next();
});

// Static method to get IPD statistics
ipdRecordSchema.statics.getStatistics = async function() {
  const stats = await this.aggregate([
    {
      $facet: {
        statusCounts: [
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ],
        admissionTypeCounts: [
          {
            $group: {
              _id: '$admissionType',
              count: { $sum: 1 }
            }
          }
        ],
        averageStay: [
          {
            $match: { dischargeDate: { $exists: true } }
          },
          {
            $project: {
              lengthOfStay: {
                $divide: [
                  { $subtract: ['$dischargeDate', '$admissionDate'] },
                  1000 * 60 * 60 * 24
                ]
              }
            }
          },
          {
            $group: {
              _id: null,
              avgStay: { $avg: '$lengthOfStay' }
            }
          }
        ]
      }
    }
  ]);

  return stats[0];
};

export default mongoose.model('IPDRecord', ipdRecordSchema);