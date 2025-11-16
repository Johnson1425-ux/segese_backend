const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

const setupEmail = async () => {
  console.log('🏥 Hospital Management System - Email Setup');
  console.log('==========================================\n');

  console.log('Choose your email service provider:');
  console.log('1. Gmail (Recommended for development)');
  console.log('2. SendGrid (Recommended for production)');
  console.log('3. Outlook/Hotmail');
  console.log('4. Custom SMTP Server');
  console.log('');

  const choice = await question('Enter your choice (1-4): ');
  let emailConfig = {};

  switch (choice) {
    case '1':
      console.log('\n📧 Gmail Setup');
      console.log('==============');
      console.log('Note: You need to use an "App Password" for Gmail, not your regular password.');
      console.log('1. Go to https://myaccount.google.com/security');
      console.log('2. Enable 2-factor authentication if not already enabled');
      console.log('3. Generate an "App Password" for this application');
      console.log('4. Use that app password below\n');

      const gmailEmail = await question('Gmail address: ');
      const gmailPassword = await question('App password (not your regular password): ');
      const gmailName = await question('Sender name (Hospital Management System): ') || 'Hospital Management System';

      emailConfig = {
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '587',
        SMTP_USERNAME: gmailEmail,
        SMTP_PASSWORD: gmailPassword,
        FROM_EMAIL: gmailEmail,
        FROM_NAME: gmailName
      };
      break;

    case '2':
      console.log('\n📧 SendGrid Setup');
      console.log('=================');
      console.log('1. Create account at https://sendgrid.com');
      console.log('2. Create an API key in SendGrid dashboard');
      console.log('3. Verify your sender domain/email\n');

      const sendgridApiKey = await question('SendGrid API Key: ');
      const sendgridEmail = await question('Verified sender email: ');
      const sendgridName = await question('Sender name (Hospital Management System): ') || 'Hospital Management System';

      emailConfig = {
        SMTP_HOST: 'smtp.sendgrid.net',
        SMTP_PORT: '587',
        SMTP_USERNAME: 'apikey',
        SMTP_PASSWORD: sendgridApiKey,
        FROM_EMAIL: sendgridEmail,
        FROM_NAME: sendgridName
      };
      break;

    case '3':
      console.log('\n📧 Outlook/Hotmail Setup');
      console.log('========================');
      
      const outlookEmail = await question('Outlook/Hotmail address: ');
      const outlookPassword = await question('Password: ');
      const outlookName = await question('Sender name (Hospital Management System): ') || 'Hospital Management System';

      emailConfig = {
        SMTP_HOST: 'smtp-mail.outlook.com',
        SMTP_PORT: '587',
        SMTP_USERNAME: outlookEmail,
        SMTP_PASSWORD: outlookPassword,
        FROM_EMAIL: outlookEmail,
        FROM_NAME: outlookName
      };
      break;

    case '4':
      console.log('\n📧 Custom SMTP Setup');
      console.log('====================');
      
      const customHost = await question('SMTP Host: ');
      const customPort = await question('SMTP Port (587): ') || '587';
      const customUsername = await question('SMTP Username: ');
      const customPassword = await question('SMTP Password: ');
      const customEmail = await question('From Email: ');
      const customName = await question('Sender name (Hospital Management System): ') || 'Hospital Management System';

      emailConfig = {
        SMTP_HOST: customHost,
        SMTP_PORT: customPort,
        SMTP_USERNAME: customUsername,
        SMTP_PASSWORD: customPassword,
        FROM_EMAIL: customEmail,
        FROM_NAME: customName
      };
      break;

    default:
      console.log('Invalid choice. Exiting...');
      rl.close();
      return;
  }

  // Read existing .env file or create new one
  const envPath = path.join(__dirname, '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Update or add email configuration
  const emailKeys = Object.keys(emailConfig);
  emailKeys.forEach(key => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const newLine = `${key}=${emailConfig[key]}`;
    
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, newLine);
    } else {
      envContent += `\n${newLine}`;
    }
  });

  // Add hospital name if not exists
  const hospitalNameRegex = /^HOSPITAL_NAME=.*$/m;
  if (!hospitalNameRegex.test(envContent)) {
    const hospitalName = await question('Hospital/Organization name (Hospital Management System): ') || 'Hospital Management System';
    envContent += `\nHOSPITAL_NAME=${hospitalName}`;
  }

  // Write updated .env file
  fs.writeFileSync(envPath, envContent.trim() + '\n');

  console.log('\n✅ Email configuration saved to .env file!');
  console.log('\n🧪 Testing email configuration...');

  // Test email configuration
  try {
    process.env = { ...process.env, ...emailConfig };
    const sendEmail = require('./utils/sendEmail');
    
    const testEmail = await question('Enter email address to send test email: ');
    
    await sendEmail({
      email: testEmail,
      subject: 'Test Email - Hospital Management System',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">🏥 Hospital Management System</h2>
          <h3>Email Configuration Test</h3>
          <p>Congratulations! Your email configuration is working correctly.</p>
          <p>✅ SMTP Host: ${emailConfig.SMTP_HOST}</p>
          <p>✅ From Email: ${emailConfig.FROM_EMAIL}</p>
          <p>✅ Sender Name: ${emailConfig.FROM_NAME}</p>
          <hr>
          <p><small>This is a test email sent at ${new Date().toLocaleString()}</small></p>
        </div>
      `,
      text: 'Email configuration test successful! Your Hospital Management System can now send emails.'
    });

    console.log('✅ Test email sent successfully!');
    console.log('Your email configuration is working correctly.');
    
  } catch (error) {
    console.log('❌ Test email failed:', error.message);
    console.log('Please check your configuration and try again.');
  }

  console.log('\n🚀 Setup complete! Your server can now send emails.');
  console.log('Don\'t forget to restart your server to load the new environment variables.');
  
  rl.close();
};

// Run setup if called directly
if (require.main === module) {
  setupEmail().catch(console.error);
}

module.exports = { setupEmail };