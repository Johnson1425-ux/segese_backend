import 'dotenv/config';
import mongoose from 'mongoose';
import readline from 'readline';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import { validatePassword, PASSWORD_REQUIREMENTS_MESSAGE } from '../utils/passwordPolicy.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

/**
 * Prompt without echoing the typed characters, so the password does not end up
 * in the terminal scrollback or in a screen recording.
 */
const secretQuestion = (query) =>
  new Promise((resolve) => {
    const onData = (char) => {
      if (['\n', '\r', ''].includes(char.toString())) {
        process.stdin.removeListener('data', onData);
      } else {
        process.stdout.write('\x1B[2K\x1B[200D' + query + '*'.repeat(rl.line.length));
      }
    };

    process.stdin.on('data', onData);
    rl.question(query, (value) => {
      process.stdout.write('\n');
      resolve(value);
    });
  });

const setupAdminInteractive = async () => {
  if (!process.env.MONGODB_URI) {
    logger.error('MONGODB_URI is not configured');
    rl.close();
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
      rl.close();
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log('Setting up admin user...\n');

    const firstName = (await question('Enter first name (default: Admin): ')) || 'Admin';
    const lastName = (await question('Enter last name (default: User): ')) || 'User';
    const email = await question('Enter email: ');

    // No default password: a well-known fallback is how deployments end up
    // reachable with published credentials.
    const password = await secretQuestion('Enter password: ');

    const phone = await question('Enter phone number (optional): ');
    const department = (await question('Enter department (default: Administration): ')) || 'Administration';

    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      logger.error('Invalid email format');
      rl.close();
      process.exit(1);
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      logger.error(PASSWORD_REQUIREMENTS_MESSAGE);
      rl.close();
      process.exit(1);
    }

    const admin = await User.create({
      firstName,
      lastName,
      email,
      password,
      role: 'admin',
      department,
      ...(phone ? { phone } : {}),
      isEmailVerified: true,
      isActive: true,
    });

    // The password is deliberately not echoed here — logger output is written
    // to logs/ on disk.
    logger.info('Admin user created successfully!');
    logger.info(`Email: ${admin.email}`);
    logger.info(`Name: ${admin.firstName} ${admin.lastName}`);
    logger.info('Please change the password after first login');

    rl.close();
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    logger.error('Error setting up admin user:', error);
    rl.close();
    process.exit(1);
  }
};

setupAdminInteractive();
