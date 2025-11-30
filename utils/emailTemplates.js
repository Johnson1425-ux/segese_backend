export const getEmailTemplate = (type, data) => {
  const baseStyle = `
    <style>
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { padding: 30px 20px; text-align: center; border-bottom: 2px solid #e5e7eb; }
      .content { padding: 30px 20px; }
      .footer { padding: 20px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
      .button { display: inline-block; padding: 12px 30px; background: #000000; color: #ffffff; text-decoration: none; border-radius: 4px; margin: 20px 0; }
      .link-box { background: #f9fafb; padding: 15px; border: 1px solid #e5e7eb; border-radius: 4px; word-break: break-all; font-size: 14px; color: #6b7280; }
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
            <h2 style="margin: 0; color: #111827;">${data.hospitalName || 'Segese Medical Clinic'}</h2>
          </div>
          <div class="content">
            <p>Hello ${data.userName || 'User'},</p>
            
            <p>We received a request to reset your password. This link will expire in 10 minutes.</p>
            
            <div style="text-align: center;">
              <a href="${data.resetUrl}" class="button">Reset Password</a>
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <div class="link-box">${data.resetUrl}</div>
            
            <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
            
            <p>Best regards,<br>
            Segese Medical Clinic Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Segese Medical Clinic. All rights reserved.</p>
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
            <h2 style="margin: 0; color: #111827;">${data.hospitalName || 'Segese Medical Clinic'}</h2>
          </div>
          <div class="content">
            <p>Hello ${data.userName || 'User'},</p>
            
            <p>Welcome to the Segese Medical Clinic. To complete your account setup, please verify your email address.</p>
            
            <div style="text-align: center;">
              <a href="${data.verificationUrl}" class="button">Verify Email Address</a>
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <div class="link-box">${data.verificationUrl}</div>
            
            <p>This verification link will expire in 24 hours.</p>
            
            <p>If you didn't create this account, please contact our support team.</p>
            
            <p>Best regards,<br>
            Segese Medical Clinic Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Segese Medical Clinic. All rights reserved.</p>
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
            <h2 style="margin: 0; color: #111827;">${data.hospitalName || 'Segese Medical Clinic'}</h2>
          </div>
          <div class="content">
            <p>Hello ${data.userName || 'User'},</p>
            
            <p>Your email address has been successfully verified. Your account is now fully activated.</p>
            
            <div style="text-align: center;">
              <a href="${data.loginUrl || process.env.FRONTEND_URL + '/login'}" class="button">Access Your Account</a>
            </div>
            
            <p>If you have any questions, please contact our support team.</p>
            
            <p>Best regards,<br>
            Segese Medical Clinic Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Segese Medical Clinic. All rights reserved.</p>
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
            <h2 style="margin: 0; color: #111827;">${data.hospitalName || 'Segese Medical Clinic'}</h2>
          </div>
          <div class="content">
            <p>Hello ${data.userName || 'User'},</p>
            
            <p>Your password has been changed successfully on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}.</p>
            
            <p>If you did not make this change, please contact our support team immediately.</p>
            
            <div style="text-align: center;">
              <a href="${data.loginUrl || process.env.FRONTEND_URL + '/login'}" class="button">Access Your Account</a>
            </div>
            
            <p>Best regards,<br>
            Segese Medical Clinic Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Segese Medical Clinic. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  return templates[type] || null;
};
