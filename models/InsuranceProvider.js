import mongoose from 'mongoose';

const insuranceProviderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  code: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['private', 'government', 'corporate', 'other'],
    default: 'private'
  },
  contactInfo: {
    phone: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    fax: String,
    website: String,
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    }
  },
  billingInfo: {
    payerId: String,
    taxId: String,
    npi: String, // National Provider Identifier
    claimsAddress: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    },
    electronicPayerId: String,
    clearinghouseId: String
  },
  coveragePlans: [{
    planName: {
      type: String,
      required: true
    },
    planCode: {
      type: String,
      required: true
    },
    planType: {
      type: String,
      enum: ['HMO', 'PPO', 'EPO', 'POS', 'HDHP', 'other'],
      required: true
    },
    coverageDetails: {
      consultationCoverage: {
        type: Number,
        min: 0,
        max: 100,
        default: 80
      },
      medicationCoverage: {
        type: Number,
        min: 0,
        max: 100,
        default: 70
      },
      labTestCoverage: {
        type: Number,
        min: 0,
        max: 100,
        default: 80
      },
      procedureCoverage: {
        type: Number,
        min: 0,
        max: 100,
        default: 80
      },
      emergencyCoverage: {
        type: Number,
        min: 0,
        max: 100,
        default: 100
      },
      deductible: {
        type: Number,
        default: 0
      },
      copay: {
        type: Number,
        default: 0
      },
      outOfPocketMax: {
        type: Number,
        default: 0
      }
    },
    requiresPreAuth: {
      type: Boolean,
      default: false
    },
    preAuthProcedures: [String],
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  contractDetails: {
    contractNumber: String,
    startDate: Date,
    endDate: Date,
    negotiatedRates: {
      type: Map,
      of: Number
    },
    paymentTerms: {
      type: String,
      enum: ['net_30', 'net_45', 'net_60', 'net_90'],
      default: 'net_30'
    }
  },
  apiIntegration: {
    enabled: {
      type: Boolean,
      default: false
    },
    apiEndpoint: String,
    apiKey: String,
    apiSecret: String,
    supportedOperations: [{
      type: String,
      enum: ['eligibility', 'claims', 'authorization', 'payment']
    }]
  },
  performanceMetrics: {
    averageReimbursementTime: Number,
    approvalRate: Number,
    denialRate: Number,
    appealSuccessRate: Number
  },
  notes: String,
  isActive: {
    type: Boolean,
    default: true
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes
// insuranceProviderSchema.index({ code: 1 });
// insuranceProviderSchema.index({ name: 1 });
insuranceProviderSchema.index({ isActive: 1 });

// Method to check coverage for a specific service
insuranceProviderSchema.methods.checkCoverage = function(planCode, serviceType) {
  const plan = this.coveragePlans.find(p => p.planCode === planCode && p.isActive);
  if (!plan) return null;
  
  const coverageMap = {
    'consultation': plan.coverageDetails.consultationCoverage,
    'medication': plan.coverageDetails.medicationCoverage,
    'lab_test': plan.coverageDetails.labTestCoverage,
    'procedure': plan.coverageDetails.procedureCoverage,
    'emergency': plan.coverageDetails.emergencyCoverage
  };
  
  return {
    coveragePercentage: coverageMap[serviceType] || 0,
    requiresPreAuth: plan.requiresPreAuth && plan.preAuthProcedures.includes(serviceType),
    copay: plan.coverageDetails.copay,
    deductible: plan.coverageDetails.deductible
  };
};

export default mongoose.model('InsuranceProvider', insuranceProviderSchema);
