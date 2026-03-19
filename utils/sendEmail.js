import { Resend } from 'resend';
import logger from './logger.js';

const sendEmail = async (options) => {
  try {
    console.log('Attempting to send email via Resend...');
    console.log('Recipient:', options.email);
    console.log('Subject:', options.subject);

    if (!options.email)              throw new Error('Recipient email is required');
    if (!options.subject)            throw new Error('Email subject is required');
    if (!options.html && !options.message) throw new Error('Email content is required');
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
    if (!process.env.FROM_EMAIL)     throw new Error('FROM_EMAIL is not configured');

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: `${process.env.FROM_NAME || 'Segese Medical Clinic'} <${process.env.FROM_EMAIL}>`,
      to: options.email,
      subject: options.subject,
      text: options.message || '',
      html: options.html || (options.message ? options.message.replace(/\n/g, '<br>') : ''),
      ...(options.replyTo && { reply_to: options.replyTo }),
    });

    if (error) {
      throw new Error(error.message || 'Resend API error');
    }

    console.log('Email sent successfully via Resend');
    console.log('Message ID:', data.id);

    logger.info('Email sent successfully via Resend', {
      recipient: options.email,
      subject: options.subject,
      messageId: data.id,
    });

    return {
      success: true,
      messageId: data.id,
      provider: 'resend',
    };
  } catch (error) {
    console.error('Resend email error:', error.message);

    logger.error('Resend email error:', {
      error: error.message,
      recipient: options?.email,
      subject: options?.subject,
    });

    throw new Error(`Failed to send email: ${error.message}`);
  }
};

export default sendEmail;
