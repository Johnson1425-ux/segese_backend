import nodemailer from 'nodemailer';
import logger from './logger.js';

const sendEmail = async (options) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_PORT == 465, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD
      },
      // Additional settings for better reliability
      tls: {
        rejectUnauthorized: false
      },
      // Connection timeout
      connectionTimeout: 60000, // 60 seconds
      greetingTimeout: 30000, // 30 seconds
      socketTimeout: 60000, // 60 seconds
    });

    // Verify connection configuration (optional, for debugging)
    if (process.env.NODE_ENV === 'development') {
      await transporter.verify();
      logger.info('SMTP connection verified successfully');
    }

    const message = {
      from: `${process.env.FROM_NAME || 'Hospital Management System'} <${process.env.FROM_EMAIL}>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.html || (options.message ? options.message.replace(/\n/g, '<br>') : ''),
    };

    const info = await transporter.sendMail(message);
    
    logger.info(`Email sent successfully to ${options.email}. Message ID: ${info.messageId}`);
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
      recipient: options.email,
      subject: options.subject,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // Throw a more user-friendly error
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

export default sendEmail;