export const getEmailTemplate = (type, data) => {
  const baseStyle = `
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
      .content { background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; }
      .footer { background: #64748b; color: white; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
      .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
      .button:hover { background: #1d4ed8; }
      .alert { background: #fee2e2; border: 1px solid #fecaca; color: #dc2626; padding: 15px; border-radius: 5px; margin: 15px 0; }
      .success { background: #dcfce7; border: 1px solid #bbf7d0; color: #166534; padding: 15px; border-radius: 5px; margin: 15px 0; }
    </style>
  `;

  const templates = {
    passwordReset: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset Request</title>
        ${baseStyle}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏥 ${data.hospitalName || 'Hospital Management System'}</h1>
            <h2>Password Reset Request</h2>
          </div>
          <div class="content">
            <p>Hello ${data.userName || 'User'},</p>
            
            <p>We received a request to reset your password for your Hospital Management System account.</p>
            
            <div class="alert">
              <strong>⚠️ Important:</strong> This password reset link will expire in 10 minutes for security reasons.
            </div>
            
            <p>To reset your password, click the button below:</p>
            
            <div style="text-align: center;">
              <a href="${data.resetUrl}" class="button">Reset Your Password</a>
            </div>
            
            <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background: #f1f5f9; padding: 10px; border-radius: 5px;">
              ${data.resetUrl}
            </p>
            
            <p><strong>If you didn't request this password reset, please ignore this email.</strong> Your password will remain unchanged.</p>
            
            <div class="success">
              <strong>🔒 Security Tip:</strong> For your account security, we recommend choosing a strong password that includes uppercase and lowercase letters, numbers, and special characters.
            </div>
            
            <p>If you're having trouble or need assistance, please contact our IT support team.</p>
            
            <p>Best regards,<br>
            Hospital Management System Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Hospital Management System. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `,

    emailVerification: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email Address</title>
        ${baseStyle}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏥 ${data.hospitalName || 'Hospital Management System'}</h1>
            <h2>Welcome to Our Team!</h2>
          </div>
          <div class="content">
            <p>Hello ${data.userName || 'User'},</p>
            
            <p>Welcome to the Hospital Management System! We're excited to have you join our team as a <strong>${data.userRole || 'team member'}</strong>.</p>
            
            <p>To complete your account setup and start using the system, please verify your email address by clicking the button below:</p>
            
            <div style="text-align: center;">
              <a href="${data.verificationUrl}" class="button">Verify Email Address</a>
            </div>
            
            <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="word-break: break-all; background: #f1f5f9; padding: 10px; border-radius: 5px;">
              ${data.verificationUrl}
            </p>
            
            <div class="alert">
              <strong>⚠️ Important:</strong> This verification link will expire in 24 hours. If it expires, you can request a new verification email from the system.
            </div>
            
            <div class="success">
              <strong>🎉 What's Next?</strong>
              <ul style="text-align: left; margin: 10px 0;">
                <li>Verify your email address using the link above</li>
                <li>Log in to your account</li>
                <li>Complete your profile information</li>
                <li>Start using the hospital management features</li>
              </ul>
            </div>
            
            <p>If you didn't create this account or believe this email was sent to you by mistake, please contact our IT support team immediately.</p>
            
            <p>Welcome aboard!<br>
            Hospital Management System Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Hospital Management System. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `,

    emailVerified: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Verification Successful</title>
        ${baseStyle}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏥 ${data.hospitalName || 'Hospital Management System'}</h1>
            <h2>Email Verified Successfully! ✅</h2>
          </div>
          <div class="content">
            <p>Hello ${data.userName || 'User'},</p>
            
            <div class="success">
              <strong>🎉 Congratulations!</strong> Your email address has been successfully verified.
            </div>
            
            <p>Your account is now fully activated and you have access to all the features of the Hospital Management System based on your role as <strong>${data.userRole || 'team member'}</strong>.</p>
            
            <p>You can now:</p>
            <ul>
              <li>Access your dashboard</li>
              <li>Manage patient records (based on your permissions)</li>
              <li>Schedule and view appointments</li>
              <li>Use all system features available to your role</li>
            </ul>
            
            <div style="text-align: center;">
              <a href="${data.loginUrl || process.env.FRONTEND_URL + '/login'}" class="button">Access Your Account</a>
            </div>
            
            <p>If you have any questions or need help getting started, please don't hesitate to contact our support team.</p>
            
            <p>Thank you for being part of our team!<br>
            Hospital Management System Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Hospital Management System. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `,

    passwordChanged: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Changed Successfully</title>
        ${baseStyle}
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏥 ${data.hospitalName || 'Hospital Management System'}</h1>
            <h2>Password Changed Successfully</h2>
          </div>
          <div class="content">
            <p>Hello ${data.userName || 'User'},</p>
            
            <div class="success">
              <strong>✅ Success!</strong> Your password has been changed successfully.
            </div>
            
            <p>This email confirms that your password was changed on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}.</p>
            
            <div class="alert">
              <strong>🔐 Security Notice:</strong> If you did not make this change, please contact our IT support team immediately and consider changing your password again.
            </div>
            
            <p>For your security, please remember:</p>
            <ul>
              <li>Keep your password confidential</li>
              <li>Don't share your login credentials with anyone</li>
              <li>Use a strong, unique password</li>
              <li>Log out when using shared computers</li>
            </ul>
            
            <div style="text-align: center;">
              <a href="${data.loginUrl || process.env.FRONTEND_URL + '/login'}" class="button">Access Your Account</a>
            </div>
            
            <p>If you have any concerns about your account security, please contact our support team.</p>
            
            <p>Best regards,<br>
            Hospital Management System Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Hospital Management System. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  return templates[type] || null;
};
