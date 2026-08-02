import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import sendEmail from '../utils/sendEmail.js';

// The previous version tried several require() paths as a cwd fallback and
// read `.sendEmail` off the module, but sendEmail is a default export, so the
// binding was always undefined. ESM resolves relative to this file, so the
// fallbacks are unnecessary and the import above is the real function.

// Connect to MongoDB
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

// Test email templates
const testWelcomeEmail = async (email, name) => {
  const emailOptions = {
    to: email,
    subject: 'Welcome to Hospital Management System',
    template: 'welcome',
    context: {
      name: name,
      loginUrl: `${process.env.CLIENT_URL}/login`
    }
  };

  try {
    await sendEmail(emailOptions);
    console.log(`✅ Welcome email sent successfully to ${email}`);
  } catch (error) {
    console.error(`❌ Failed to send welcome email to ${email}:`, error.message);
  }
};

const testPasswordResetEmail = async (email, name, resetUrl) => {
  const emailOptions = {
    to: email,
    subject: 'Password Reset Request',
    template: 'password-reset',
    context: {
      name: name,
      resetUrl: resetUrl,
      expiryTime: '10 minutes'
    }
  };

  try {
    await sendEmail(emailOptions);
    console.log(`✅ Password reset email sent successfully to ${email}`);
  } catch (error) {
    console.error(`❌ Failed to send password reset email to ${email}:`, error.message);
  }
};

const testEmailVerificationEmail = async (email, name, verifyUrl) => {
  const emailOptions = {
    to: email,
    subject: 'Verify Your Email Address',
    template: 'email-verification',
    context: {
      name: name,
      verifyUrl: verifyUrl,
      expiryTime: '24 hours'
    }
  };

  try {
    await sendEmail(emailOptions);
    console.log(`✅ Email verification email sent successfully to ${email}`);
  } catch (error) {
    console.error(`❌ Failed to send email verification email to ${email}:`, error.message);
  }
};

const testAppointmentConfirmationEmail = async (email, patientName, doctorName, appointmentDate, appointmentTime) => {
  const emailOptions = {
    to: email,
    subject: 'Appointment Confirmation',
    template: 'appointment-confirmation',
    context: {
      patientName: patientName,
      doctorName: doctorName,
      appointmentDate: appointmentDate,
      appointmentTime: appointmentTime,
      clinicName: process.env.CLINIC_NAME || 'Hospital Management System',
      clinicPhone: process.env.CLINIC_PHONE || '(555) 123-4567',
      clinicAddress: process.env.CLINIC_ADDRESS || '123 Healthcare St, Medical City, MC 12345'
    }
  };

  try {
    await sendEmail(emailOptions);
    console.log(`✅ Appointment confirmation email sent successfully to ${email}`);
  } catch (error) {
    console.error(`❌ Failed to send appointment confirmation email to ${email}:`, error.message);
  }
};

const testAppointmentReminderEmail = async (email, patientName, doctorName, appointmentDate, appointmentTime) => {
  const emailOptions = {
    to: email,
    subject: 'Appointment Reminder',
    template: 'appointment-reminder',
    context: {
      patientName: patientName,
      doctorName: doctorName,
      appointmentDate: appointmentDate,
      appointmentTime: appointmentTime,
      clinicName: process.env.CLINIC_NAME || 'Hospital Management System',
      clinicPhone: process.env.CLINIC_PHONE || '(555) 123-4567',
      reminderTime: '24 hours'
    }
  };

  try {
    await sendEmail(emailOptions);
    console.log(`✅ Appointment reminder email sent successfully to ${email}`);
  } catch (error) {
    console.error(`❌ Failed to send appointment reminder email to ${email}:`, error.message);
  }
};

// Main test function
const runEmailTests = async () => {
  try {
    await connectDB();

    console.log('🧪 Starting Email Function Tests...\n');

    // Test data
    const testEmail = process.env.TEST_EMAIL || 'test@example.com';
    const testName = 'John Doe';
    const resetUrl = `${process.env.CLIENT_URL}/reset-password/sample-token`;
    const verifyUrl = `${process.env.CLIENT_URL}/verify-email/sample-token`;

    // Test 1: Welcome Email
    console.log('📧 Testing Welcome Email...');
    await testWelcomeEmail(testEmail, testName);

    // Test 2: Password Reset Email
    console.log('\n📧 Testing Password Reset Email...');
    await testPasswordResetEmail(testEmail, testName, resetUrl);

    // Test 3: Email Verification Email
    console.log('\n📧 Testing Email Verification Email...');
    await testEmailVerificationEmail(testEmail, testName, verifyUrl);

    // Test 4: Appointment Confirmation Email
    console.log('\n📧 Testing Appointment Confirmation Email...');
    await testAppointmentConfirmationEmail(
      testEmail,
      testName,
      'Dr. Sarah Wilson',
      'December 15, 2024',
      '2:30 PM'
    );

    // Test 5: Appointment Reminder Email
    console.log('\n📧 Testing Appointment Reminder Email...');
    await testAppointmentReminderEmail(
      testEmail,
      testName,
      'Dr. Sarah Wilson',
      'December 16, 2024',
      '10:00 AM'
    );

    console.log('\n✅ All email tests completed!');

  } catch (error) {
    console.error('❌ Error running email tests:', error);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed.');
    process.exit(0);
  }
};

// Test individual email function
const testSingleEmail = async (type, recipientEmail) => {
  try {
    await connectDB();

    const testName = 'Test User';
    
    switch (type) {
      case 'welcome':
        await testWelcomeEmail(recipientEmail, testName);
        break;
      case 'password-reset':
        const resetUrl = `${process.env.CLIENT_URL}/reset-password/test-token`;
        await testPasswordResetEmail(recipientEmail, testName, resetUrl);
        break;
      case 'email-verification':
        const verifyUrl = `${process.env.CLIENT_URL}/verify-email/test-token`;
        await testEmailVerificationEmail(recipientEmail, testName, verifyUrl);
        break;
      case 'appointment-confirmation':
        await testAppointmentConfirmationEmail(
          recipientEmail,
          testName,
          'Dr. Test Doctor',
          'Today',
          '2:00 PM'
        );
        break;
      case 'appointment-reminder':
        await testAppointmentReminderEmail(
          recipientEmail,
          testName,
          'Dr. Test Doctor',
          'Tomorrow',
          '10:00 AM'
        );
        break;
      default:
        console.error('❌ Invalid email type. Available types: welcome, password-reset, email-verification, appointment-confirmation, appointment-reminder');
        break;
    }

  } catch (error) {
    console.error('❌ Error testing email:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

// Check command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  // Run all tests
  runEmailTests();
} else if (args.length >= 2) {
  // Test single email: node test-email-functions.js <type> <email>
  const emailType = args[0];
  const recipientEmail = args[1];
  testSingleEmail(emailType, recipientEmail);
} else {
  console.log('📖 Usage:');
  console.log('  Run all tests: node test-email-functions.js');
  console.log('  Test single email: node test-email-functions.js <type> <email>');
  console.log('  Available types: welcome, password-reset, email-verification, appointment-confirmation, appointment-reminder');
  process.exit(0);
}