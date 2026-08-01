import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import { protect, authRateLimit } from '../middleware/auth.js';
import sendEmail from '../utils/sendEmail.js';
import logger from '../utils/logger.js';
import { validatePassword, PASSWORD_REQUIREMENTS_MESSAGE } from '../utils/passwordPolicy.js';

const router = express.Router();

// Credential-guessing protection. The global limiter in server.js allows ~100
// requests per window, which is far too generous for password attempts.
const authLimiter = rateLimit(authRateLimit);

// Generic reply used by every account-lookup flow so that a caller cannot tell
// a registered address from an unregistered one.
const GENERIC_RESET_RESPONSE =
  'If an account exists for that email address, a password reset link has been sent.';

// Compared against when no user matches, to keep the failure path's timing
// close to the real one.
const DUMMY_HASH = bcrypt.hashSync('unused-placeholder-value', 10);

// @desc    Register user and send verification email
// @route   POST /api/auth/register
// @access  Public
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // Basic validation
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.message,
        errors: [{ field: 'password', message: passwordCheck.message }]
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
      
      res.status(201).json({ 
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
    logger.error('Register error:', error);
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

    const user = await User.findOne({ 
      verificationToken,
      verificationTokenExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid verification token' 
      });
    }

    user.isEmailVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpire = undefined;
    await user.save();

    res.status(200).json({ 
      success: true, 
      data: 'Email verified successfully' 
    });
  } catch (error) {
    logger.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Please provide an email and password' });
  }

  try {
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      // Burn a comparable amount of time so response latency does not reveal
      // whether the address is registered.
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Checked before the password comparison so that a locked account cannot
    // be used as an unlimited guessing oracle.
    if (user.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked. Please try again later.'
      });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      await user.incrementFailedLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Account-state messages are only disclosed once the password has been
    // proven, so they cannot be used to enumerate accounts.
    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated. Please contact support.'
      });
    }

    await user.resetLoginAttempts();

    // Recorded here rather than in the protect middleware, which would other-
    // wise write to the database on every authenticated request.
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = user.getSignedJwtToken();
    const userResponse = { ...user._doc };
    delete userResponse.password;

    res.status(200).json({
      success: true,
      data: { user: userResponse, token }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    // Always answer as though the address was accepted; revealing that no
    // account exists lets an attacker enumerate valid staff addresses.
    if (!user) {
      logger.info(`Password reset requested for unknown address: ${req.body.email}`);
      return res.status(200).json({
        success: true,
        data: GENERIC_RESET_RESPONSE
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
        data: GENERIC_RESET_RESPONSE
      });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });

      // Same response as the success path: a delivery failure must not confirm
      // that the address is registered. The cause is recorded server-side.
      logger.error('Password reset email could not be sent', {
        recipient: user.email,
        error: err.message
      });
      res.status(200).json({
        success: true,
        data: GENERIC_RESET_RESPONSE
      });
    }
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
router.put('/reset-password/:token', authLimiter, async (req, res) => {
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

    const passwordCheck = validatePassword(req.body.password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.message,
        errors: [{ field: 'password', message: passwordCheck.message }]
      });
    }

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    res.status(200).json({
      success: true,
      data: 'Password reset successfully'
    });
  } catch (error) {
    logger.error('Reset password error:', error);
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
    const passwordCheck = validatePassword(newPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: PASSWORD_REQUIREMENTS_MESSAGE,
        errors: [{
          field: 'newPassword',
          message: PASSWORD_REQUIREMENTS_MESSAGE
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

    logger.info('Password changed', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;