import sgMail from '@sendgrid/mail';
import logger from './logger.js';

// Set SendGrid API key
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  logger.info('✅ SendGrid configured successfully');
} else {
  logger.warn('⚠️ SENDGRID_API_KEY not found - emails will fail!');
}

const sendEmail = async (options) => {
  try {
    console.log('📧 Attempting to send email via SendGrid...');
    console.log('Recipient:', options.email);
    console.log('Subject:', options.subject);

    // Validate required fields
    if (!options.email) {
      throw new Error('Recipient email is required');
    }
    if (!options.subject) {
      throw new Error('Email subject is required');
    }
    if (!options.html && !options.message) {
      throw new Error('Email content (html or message) is required');
    }

    // Validate SendGrid is configured
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error('SENDGRID_API_KEY is not configured in environment variables');
    }

    if (!process.env.FROM_EMAIL) {
      throw new Error('FROM_EMAIL is not configured in environment variables');
    }

    // Prepare email message
    const msg = {
      to: options.email,
      from: {
        email: process.env.FROM_EMAIL,
        name: process.env.FROM_NAME || 'Segese Medical Clinic'
      },
      subject: options.subject,
      text: options.message || '',
      html: options.html || (options.message ? options.message.replace(/\n/g, '<br>') : ''),
    };

    // Add reply-to if provided
    if (options.replyTo) {
      msg.replyTo = options.replyTo;
    }

    console.log('📤 Sending email from:', msg.from.email);

    // Send email via SendGrid
    const response = await sgMail.send(msg);
    
    console.log('✅ Email sent successfully via SendGrid');
    console.log('Status Code:', response[0].statusCode);
    
    logger.info('Email sent successfully via SendGrid', {
      recipient: options.email,
      subject: options.subject,
      statusCode: response[0].statusCode,
      messageId: response[0].headers['x-message-id']
    });

    return {
      success: true,
      messageId: response[0].headers['x-message-id'],
      statusCode: response[0].statusCode,
      provider: 'sendgrid'
    };

  } catch (error) {
    console.error('❌ SendGrid email error:', error);
    
    // Log detailed error information
    logger.error('SendGrid email error:', {
      error: error.message,
      code: error.code,
      statusCode: error.response?.statusCode,
      body: error.response?.body,
      recipient: options?.email,
      subject: options?.subject,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // Provide user-friendly error messages
    let errorMessage = 'Failed to send email';
    
    if (error.code === 401 || error.response?.statusCode === 401) {
      errorMessage = 'SendGrid authentication failed. Check your API key.';
    } else if (error.code === 403 || error.response?.statusCode === 403) {
      errorMessage = 'SendGrid access forbidden. Verify sender email address and API key permissions.';
    } else if (error.response?.body?.errors) {
      const errorMessages = error.response.body.errors.map(e => e.message).join(', ');
      errorMessage = `SendGrid error: ${errorMessages}`;
    } else if (error.message.includes('API key')) {
      errorMessage = 'SendGrid API key not configured. Add SENDGRID_API_KEY to environment variables.';
    } else if (error.message.includes('FROM_EMAIL')) {
      errorMessage = 'FROM_EMAIL not configured. Add verified sender email to environment variables.';
    } else {
      errorMessage = `Failed to send email: ${error.message}`;
    }
    
    throw new Error(errorMessage);
  }
};

export default sendEmail;
