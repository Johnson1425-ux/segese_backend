const mongoose = require('mongoose');
const User = require('../models/User');
const logger = require('../utils/logger');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

const setupAdminInteractive = async () => {
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
      rl.close();
      process.exit(0);
    }

    logger.info('Setting up admin user...\n');

    // Get admin details from user
    const firstName = await question('Enter first name (default: Admin): ') || 'Admin';
    const lastName = await question('Enter last name (default: User): ') || 'User';
    const email = await question('Enter email (default: admin@hospital.com): ') || 'admin@hospital.com';
    const password = await question('Enter password (default: Admin123!): ') || 'Admin123!';
    const phone = await question('Enter phone number (default: +1234567890): ') || '+1234567890';
    const department = await question('Enter department (default: Administration): ') || 'Administration';
    
    const gender = await question('Enter gender (Male/Female/Other, default: Other): ') || 'Male';
    const dateOfBirth = await question('Enter date of birth (YYYY-MM-DD, default: 1990-01-01): ') || '1990-01-01';

    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      logger.error('Invalid email format');
      rl.close();
      process.exit(1);
    }

    // Validate password length
    if (password.length < 8) {
      logger.error('Password must be at least 8 characters long');
      rl.close();
      process.exit(1);
    }

    // Validate date format
    const birthDate = new Date(dateOfBirth);
    if (isNaN(birthDate.getTime())) {
      logger.error('Invalid date format. Please use YYYY-MM-DD');
      rl.close();
      process.exit(1);
    }

    // Create admin user
    const adminData = {
      firstName,
      lastName,
      email,
      password,
      role: 'admin',
      department,
      phone,
      dateOfBirth: birthDate,
      gender,
      isEmailVerified: true,
      isActive: true,
      permissions: [
        "read:patients", "write:patients", 'delete:patients',
        'read:doctors', 'write:doctors', 'delete:doctors',
        'read:appointments', 'write:appointments', 'delete:appointments',
        'read:visits', 'write:visits', 'delete:visits',
        'read:users', 'write:users', 'delete:users',
        'read:reports', 'write:reports',
        'read:settings', 'write:settings',
        // 'read:dashboard', 'write:dashboard',
        // 'start:visits', 'end:visits'
      ]
    };

    const admin = await User.create(adminData);

    logger.info('\n✅ Admin user created successfully!');
    logger.info(`📧 Email: ${admin.email}`);
    logger.info(`🔑 Password: ${password}`);
    logger.info(`👤 Name: ${admin.firstName} ${admin.lastName}`);
    logger.info(`📞 Phone: ${admin.phone}`);
    logger.info(`🏥 Department: ${admin.department}`);
    logger.info('\n⚠️  Please change the password after first login');

    rl.close();
    process.exit(0);
  } catch (error) {
    logger.error('Error setting up admin user:', error);
    rl.close();
    process.exit(1);
  }
};

// Run the setup
setupAdminInteractive();
