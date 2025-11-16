import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'CREATE', 'UPDATE', 'DELETE', 'VIEW',
      'LOGIN', 'LOGOUT', 'PASSWORD_CHANGE',
      'PERMISSION_CHANGE', 'EXPORT_DATA',
      'PRINT', 'EMAIL_SENT', 'API_ACCESS'
    ]
  },
  entityType: {
    type: String,
    required: true,
    enum: [
      'User', 'Patient', 'Appointment', 'Visit',
      'Prescription', 'LabTest', 'Medication',
      'Report', 'Settings', 'System', 'Invoice', 'Payment'
    ]
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false
  },
  description: {
    type: String,
    required: true
  },
  changes: {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  },
  ipAddress: String,
  userAgent: String,
  sessionId: String,
  requestMethod: String,
  requestUrl: String,
  responseStatus: Number,
  responseTime: Number,
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

// Static method to create audit log
auditLogSchema.statics.log = async function(data) {
  try {
    return await this.create(data);
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw error to prevent disrupting main operations
  }
};

// Method to get user activity
auditLogSchema.statics.getUserActivity = async function(userId, limit = 100) {
  return await this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('userId', 'firstName lastName email role');
};

// Method to get entity history
auditLogSchema.statics.getEntityHistory = async function(entityType, entityId) {
  return await this.find({ entityType, entityId })
    .sort({ createdAt: -1 })
    .populate('userId', 'firstName lastName email role');
};

export default mongoose.model('AuditLog', auditLogSchema);
