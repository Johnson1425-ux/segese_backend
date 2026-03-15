import nodemailer from 'nodemailer';
import logger from './logger.js';

// Create SMTP transporter
let transporter = null;

const createTransporter = () => {
  const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD'];
  const missing = requiredVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    logger.warn(`⚠️ Missing SMTP env vars: ${missing.join(', ')} - emails will fail!`);
    return null;
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587
    auth: {
      user: process.env.SMTP_USERNAME,
      pass: process.env.SMTP_PASSWORD,
    },
    ...(process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false' && {
      tls: { rejectUnauthorized: false }
    }),
  });

  logger.info('✅ SMTP transporter configured successfully');
  return transport;
};

transporter = createTransporter();

const sendEmail = async (options) => {
  try {
    console.log('📧 Attempting to send email via SMTP...');
    console.log('Recipient:', options.email);
    console.log('Subject:', options.subject);

    // Validate required fields
    if (!options.email) throw new Error('Recipient email is required');
    if (!options.subject) throw new Error('Email subject is required');
    if (!options.html && !options.message) throw new Error('Email content (html or message) is required');
    if (!process.env.FROM_EMAIL) throw new Error('FROM_EMAIL is not configured in environment variables');

    // Re-create transporter if not initialized
    if (!transporter) {
      transporter = createTransporter();
      if (!transporter) throw new Error('SMTP is not configured. Check SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD.');
    }

    // Prepare email message
    const msg = {
      to: options.email,
      from: `"${process.env.FROM_NAME || 'Segese Medical Clinic'}" <${process.env.FROM_EMAIL}>`,
      subject: options.subject,
      text: options.message || '',
      html: options.html || (options.message ? options.message.replace(/\n/g, '<br>') : ''),
      ...(options.replyTo && { replyTo: options.replyTo }),
    };

    console.log('📤 Sending email from:', process.env.FROM_EMAIL);

    const response = await transporter.sendMail(msg);

    console.log('✅ Email sent successfully via SMTP');
    console.log('Message ID:', response.messageId);

    logger.info('Email sent successfully via SMTP', {
      recipient: options.email,
      subject: options.subject,
      messageId: response.messageId,
    });

    return {
      success: true,
      messageId: response.messageId,
      provider: 'smtp',
    };
  } catch (error) {
    console.error('❌ SMTP email error:', error);

    logger.error('SMTP email error:', {
      error: error.message,
      code: error.code,
      recipient: options?.email,
      subject: options?.subject,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

    let errorMessage = 'Failed to send email';

    if (error.code === 'ECONNREFUSED') {
      errorMessage = `SMTP connection refused. Check SMTP_HOST (${process.env.SMTP_HOST}) and SMTP_PORT (${process.env.SMTP_PORT}).`;
    } else if (error.code === 'EAUTH') {
      errorMessage = 'SMTP authentication failed. Check SMTP_USERNAME and SMTP_PASSWORD.';
    } else if (error.code === 'ESOCKET' || error.code === 'ETIMEDOUT') {
      errorMessage = 'SMTP connection timed out. Check your host and port settings.';
    } else if (error.message.includes('FROM_EMAIL')) {
      errorMessage = 'FROM_EMAIL not configured. Add a sender email to environment variables.';
    } else if (error.message.includes('SMTP is not configured')) {
      errorMessage = error.message;
    } else {
      errorMessage = `Failed to send email: ${error.message}`;
    }

    throw new Error(errorMessage);
  }
};

export default sendEmail;