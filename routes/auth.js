import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import sendEmail from '../utils/sendEmail.js';

const router = express.Router();

// @desc    Register user and send verification email
// @route   POST /api/auth/register
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // Basic validation
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    // Create user
    const user = new User({
      firstName,
      lastName,
      email,
      password
    });

    await user.save();

    // Generate verification token and send email
    const verificationToken = user.getVerificationToken();
    await user.save({ validateBeforeSave: false });

    const verifyURL = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
    const message = `Please verify your email by clicking the following link: \n\n ${verifyURL}`;

    try {
      await sendEmail({
        email: user.email,
        subject: 'Email Verification',
        message,
      });
      
      res.status(200).json({ 
        success: true, 
        data: 'User registered successfully. Verification email sent' 
      });
    } catch (err) {
      // If email fails, clear the token and handle error
      user.verificationToken = undefined;
      await user.save({ validateBeforeSave: false });
      
      res.status(500).json({ 
        success: false,
        message: 'User registered but verification email could not be sent' 
      });
    }
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
router.get('/verify-email/:token', async (req, res) => {
  try {
    // Get hashed token
    const verificationToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');

    const user = await User.findOne({ verificationToken });

    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid verification token' 
      });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();

    res.status(200).json({ 
      success: true, 
      data: 'Email verified successfully' 
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Please provide an email and password' });
  }

  try {
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check if user is verified
    // if (!user.isVerified) {
    //   return res.status(401).json({
    //     success: false,
    //     message: 'Please verify your email before logging in'
    //   });
    // }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated. Please contact support.'
      });
    }
    
    if (user.isLocked()) {
        return res.status(423).json({ success: false, message: 'Account is temporarily locked. Please try again later.' });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      await user.incrementFailedLoginAttempts();
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    await user.resetLoginAttempts();

    const token = user.getSignedJwtToken();
    const userResponse = { ...user._doc };
    delete userResponse.password;
    
    res.status(200).json({ 
      success: true, 
      data: { user: userResponse, token } 
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server Error' 
    });
  }
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'There is no user with that email' 
      });
    }

    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    const resetURL = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please click the following link to reset your password: \n\n ${resetURL}`;

    try {
      await sendEmail({ 
        email: user.email, 
        subject: 'Password Reset', 
        message 
      });
      res.status(200).json({ 
        success: true, 
        data: 'Reset email sent' 
      });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      res.status(500).json({ 
        success: false, 
        message: 'Email could not be sent' 
      });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
router.put('/reset-password/:token', async (req, res) => {
  try {
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid or expired token' 
      });
    }

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({ 
      success: true, 
      data: 'Password reset successfully' 
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get current logged in user
// @route   GET /api/auth/me
router.get('/me', protect, async (req, res) => {
    const user = await User.findById(req.user.id);
    res.status(200).json({
        success: true,
        data: { user }
    });
});

// @desc    Logout user / clear cookie
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: 'User logged out successfully' 
  });
});

// @desc    Change user password
// @route   PUT /api/auth/change-password
// @access  Private
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Basic validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required',
        errors: [
          ...(!currentPassword ? [{ field: 'currentPassword', message: 'Current password is required' }] : []),
          ...(!newPassword ? [{ field: 'newPassword', message: 'New password is required' }] : []),
          ...(!confirmPassword ? [{ field: 'confirmPassword', message: 'Password confirmation is required' }] : [])
        ]
      });
    }

    // Password strength validation
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters',
        errors: [{
          field: 'newPassword',
          message: 'New password must be at least 8 characters'
        }]
      });
    }

    // Check password complexity
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
        errors: [{
          field: 'newPassword',
          message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
        }]
      });
    }

    // Check if new password and confirm password match
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New passwords do not match',
        errors: [{
          field: 'confirmPassword',
          message: 'New passwords do not match'
        }]
      });
    }

    // Get user with password field
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if current password is correct
    const isCurrentPasswordCorrect = await user.matchPassword(currentPassword);
    
    if (!isCurrentPasswordCorrect) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
        errors: [{
          field: 'currentPassword',
          message: 'Current password is incorrect'
        }]
      });
    }

    // Check if new password is different from current password
    const isSamePassword = await user.matchPassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password',
        errors: [{
          field: 'newPassword',
          message: 'New password must be different from current password'
        }]
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    console.log(`Password changed successfully for user: ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;