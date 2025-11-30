import nodemailer from 'nodemailer';
import logger from './logger.js';

const sendEmail = async (options) => {
  try {
    // Validate required environment variables
    if (!process.env.SMTP_HOST || !process.env.SMTP_USERNAME || !process.env.SMTP_PASSWORD) {
      throw new Error('Missing required SMTP configuration. Check your environment variables.');
    }

    const port = parseInt(process.env.SMTP_PORT) || 587;
    
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: port,
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD
      },
      // Only use these TLS settings if needed (e.g., for self-signed certs in dev)
      tls: {
        // Remove rejectUnauthorized: false in production
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      },
      // Increase timeouts for cloud hosting
      connectionTimeout: 120000, // 120 seconds
      greetingTimeout: 60000, // 60 seconds
      socketTimeout: 120000, // 120 seconds
    });

    // Verify connection in development
    if (process.env.NODE_ENV === 'development') {
      try {
        await transporter.verify();
        logger.info('SMTP connection verified successfully');
      } catch (verifyError) {
        logger.error('SMTP verification failed:', verifyError.message);
        throw new Error(`SMTP configuration error: ${verifyError.message}`);
      }
    }

    // Validate email options
    if (!options.email) {
      throw new Error('Recipient email is required');
    }
    if (!options.subject) {
      throw new Error('Email subject is required');
    }
    if (!options.html && !options.message) {
      throw new Error('Email content (html or message) is required');
    }

    const message = {
      from: `${process.env.FROM_NAME || 'Hospital Management System'} <${process.env.FROM_EMAIL}>`,
      to: options.email,
      subject: options.subject,
      text: options.message || '',
      html: options.html || (options.message ? options.message.replace(/\n/g, '<br>') : ''),
    };

    // Add reply-to if provided
    if (options.replyTo) {
      message.replyTo = options.replyTo;
    }

    const info = await transporter.sendMail(message);
    
    logger.info(`Email sent successfully`, {
      recipient: options.email,
      subject: options.subject,
      messageId: info.messageId
    });
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response
    };
    
  } catch (error) {
    logger.error('Email sending error:', {
      error: error.message,
      code: error.code,
      command: error.command,
      recipient: options?.email,
      subject: options?.subject,
      // Include stack trace only in development
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // Throw a user-friendly error with more context
    let errorMessage = 'Failed to send email';
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Check SMTP credentials.';
    } else if (error.code === 'ESOCKET') {
      errorMessage = 'Could not connect to email server. Check SMTP host and port.';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Email server connection timed out.';
    } else if (error.message) {
      errorMessage = `Failed to send email: ${error.message}`;
    }
    
    throw new Error(errorMessage);
  }
};

export default sendEmail;
