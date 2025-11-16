const mongoose = require('mongoose');
const User = require('../models/User');
const logger = require('../utils/logger');
require('dotenv').config();

const setupAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hospital_management', {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    logger.info('Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      logger.info('Admin user already exists');
      logger.info(`Admin Email: ${existingAdmin.email}`);
      logger.info(`Admin Name: ${existingAdmin.firstName} ${existingAdmin.lastName}`);
      process.exit(0);
    }

    // Create admin user
    const adminData = {
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@hospital.com',
      password: 'Admin123!',
      role: 'admin',
      department: 'Administration',
      phone: '+1234567890',
      dateOfBirth: new Date('1990-01-01'),
      gender: 'other',
      isEmailVerified: true,
      isActive: true,
      permissions: [
        'read:patients', 'write:patients', 'delete:patients',
        'read:doctors', 'write:doctors', 'delete:doctors',
        'read:appointments', 'write:appointments', 'delete:appointments',
        'read:users', 'write:users', 'delete:users',
        'read:dashboard', 'write:dashboard',
        'read:reports', 'write:reports',
        'read:settings', 'write:settings',
        'read:visits', 'write:visits', 'delete:visits',
        'start:visits', 'end:visits'
      ]
    };

    const admin = await User.create(adminData);

    logger.info('Admin user created successfully!');
    logger.info(`Admin Email: ${admin.email}`);
    logger.info(`Admin Password: ${adminData.password}`);
    logger.info(`Admin Name: ${admin.firstName} ${admin.lastName}`);
    logger.info('Please change the password after first login');

    process.exit(0);
  } catch (error) {
    logger.error('Error setting up admin user:', error);
    process.exit(1);
  }
};

// Run the setup
setupAdmin();
