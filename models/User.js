import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { type } from 'os';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 15 * 60 * 1000; // 15 minutes

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'Please add a first name']
  },
  lastName: {
    type: String,
    required: [true, 'Please add a last name']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  phone: String,
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'radiologist', 'surgeon', 'lab_technician', 'mortuary_attendant'],
    default: 'user'
  },
  employeeId: {
    type: String,
    unique: true,
    sparse: true
  },
  // specialization: String,
  department: String,
  // licenseNumber: String,
  
  // Personal Information
  dateOfBirth: Date,
  gender: {
    type: String,
    enum: ['male', 'female', 'other', 'Male', 'Female', 'Other', 'prefer_not_to_say']
  },
  address: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  profileImage: String,

  schedule: {
    monday: { type: String, default: 'Off' },
    tuesday: { type: String, default: 'Off' },
    wednesday: { type: String, default: 'Off' },
    thursday: { type: String, default: 'Off' },
    friday: { type: String, default: 'Off' },
    saturday: { type: String, default: 'Off' },
    sunday: { type: String, default: 'Off' } 
  },

  isActive: {
    type: Boolean,
    default: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: String,
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  lastLogin: {
    type: Date
  },
  
  // User preferences (for theme, language, etc.)
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false }
    }
  }
}, {
  timestamps: true
});

// Encrypt password using bcrypt
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Check if the account is currently locked
userSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment failed login attempts and lock account if necessary
userSchema.methods.incrementFailedLoginAttempts = async function() {
  this.failedLoginAttempts += 1;
  if (this.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
    this.lockUntil = Date.now() + LOCK_TIME;
  }
  await this.save();
};

// Reset failed login attempts on successful login
userSchema.methods.resetLoginAttempts = async function() {
  this.failedLoginAttempts = 0;
  this.lockUntil = null;
  await this.save();
};

// Sign JWT and return
userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Method to generate and hash verification token
userSchema.methods.getVerificationToken = function() {
  const verificationToken = crypto.randomBytes(20).toString('hex');
  
  this.verificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
    
  return verificationToken;
};

// Generate and hash password token
userSchema.methods.getResetPasswordToken = function() {
  const resetToken = crypto.randomBytes(20).toString('hex');
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

// Permission methods
userSchema.methods.hasPermission = function(permission) {
  // Define role-based permissions
  const rolePermissions = {
    admin: ['all'],
    doctor: ['view_patients', 'view_appointments', 'prescribe_medications', 'order_lab_tests'],
    nurse: ['view_patients', 'edit_vitals', 'view_visits'],
    receptionist: ['create_patients', 'edit_patients', 'view_patients', 'create_appointments', 'create_visits', 'view_visits', 'view_appointments', 'edit_appointments'],
    pharmacist: ['view_prescriptions', 'dispense_medications'],
    lab_technician: ['view_lab_tests', 'update_lab_results'],
    radiologist: ['view_radiology_requests', 'update_radiology_results'],
    mortuary_attendant: ['view_corpses', 'update_corpses']
  };
  
  const permissions = rolePermissions[this.role] || [];
  return permissions.includes('all') || permissions.includes(permission);
};

userSchema.methods.hasAnyPermission = function(permissions) {
  return permissions.some(permission => this.hasPermission(permission));
};

userSchema.methods.hasAllPermissions = function(permissions) {
  return permissions.every(permission => this.hasPermission(permission));
};

export default mongoose.model('User', userSchema);