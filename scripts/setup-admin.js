import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import { validatePassword, PASSWORD_REQUIREMENTS_MESSAGE } from '../utils/passwordPolicy.js';

/**
 * Creates the initial admin account.
 *
 * Credentials are taken from the environment rather than hardcoded, so that a
 * deployment never ships with a publicly known password. The password is also
 * no longer written to the log files.
 *
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' npm run setup-admin
 */
const setupAdmin = async () => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    logger.error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set. Example:\n' +
      "  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='<strong password>' npm run setup-admin"
    );
    process.exit(1);
  }

  const passwordCheck = validatePassword(password);
  if (!passwordCheck.valid) {
    logger.error(`ADMIN_PASSWORD is too weak. ${PASSWORD_REQUIREMENTS_MESSAGE}`);
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    logger.error('MONGODB_URI is not configured');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    logger.info('Connected to MongoDB');

    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      logger.info('Admin user already exists');
      logger.info(`Admin Email: ${existingAdmin.email}`);
      logger.info(`Admin Name: ${existingAdmin.firstName} ${existingAdmin.lastName}`);
      await mongoose.connection.close();
      process.exit(0);
    }

    const admin = await User.create({
      firstName: process.env.ADMIN_FIRST_NAME || 'Admin',
      lastName: process.env.ADMIN_LAST_NAME || 'User',
      email,
      password,
      role: 'admin',
      department: 'Administration',
      isEmailVerified: true,
      isActive: true,
    });

    logger.info('Admin user created successfully!');
    logger.info(`Admin Email: ${admin.email}`);
    logger.info(`Admin Name: ${admin.firstName} ${admin.lastName}`);
    logger.info('Sign in with the password supplied via ADMIN_PASSWORD, then change it.');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    logger.error('Error setting up admin user:', error);
    process.exit(1);
  }
};

setupAdmin();
