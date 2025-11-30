import express from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import { protect, authorize } from '../middleware/auth.js';
import sendEmail from '../utils/sendEmail.js';
import { getEmailTemplate } from '../utils/emailTemplates.js';  // ← ADD THIS IMPORT
import logger from '../utils/logger.js';

const router = express.Router();

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Admin only)
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const total = await User.countDocuments();

    const users = await User.find()
      .select('-password')
      .skip(startIndex)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Pagination result
    const pagination = {};

    if (endIndex < total) {
      pagination.next = {
        page: page + 1,
        limit
      };
    }

    if (startIndex > 0) {
      pagination.prev = {
        page: page - 1,
        limit
      };
    }

    res.status(200).json({
      status: 'success',
      count: users.length,
      pagination,
      data: users
    });
  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Create a new user
// @route   POST /api/users
// @access  Private (Admin only)
router.post(
  '/',
  protect,
  authorize('admin'),
  [
    body('firstName', 'First name is required').not().isEmpty(),
    body('lastName', 'Last name is required').not().isEmpty(),
    body('email', 'Please include a valid email').isEmail(),
    body('password', 'Password must be at least 8 characters').isLength({ min: 8 }),
    body('role', 'Role is required').not().isEmpty()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, firstName, lastName, role } = req.body;

    try {
      // Check if user already exists
      let user = await User.findOne({ email });

      if (user) {
        return res.status(400).json({
          status: 'error',
          message: 'User already exists'
        });
      }

      // Create new user
      console.log('📝 Creating new user:', email);
      user = new User(req.body);
      await user.save();
      console.log('✅ User created successfully:', user._id);

      // Generate verification token and save
      console.log('🔑 Generating verification token...');
      const verificationToken = user.getVerificationToken();
      await user.save({ validateBeforeSave: false });
      console.log('✅ Verification token saved');

      // Create verification URL
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
      console.log('🔗 Verification URL:', verificationUrl);

      // Send verification email with HTML template
      try {
        console.log('📧 Attempting to send verification email to:', user.email);
        
        const emailHtml = getEmailTemplate('emailVerification', {
          userName: `${firstName} ${lastName}`,
          userRole: role,
          verificationUrl: verificationUrl,
          hospitalName: 'Hospital Management System'
        });

        if (!emailHtml) {
          throw new Error('Email template not found');
        }

        console.log('📄 Email template generated successfully');

        const emailResult = await sendEmail({
          email: user.email,
          subject: 'Verify Your Email Address - Hospital Management System',
          html: emailHtml,
          message: `Please verify your email by clicking the following link: ${verificationUrl}` // Fallback plain text
        });

        console.log('✅ Verification email sent successfully:', emailResult.messageId);

        // Don't send the password back
        const userResponse = { ...user._doc };
        delete userResponse.password;

        res.status(201).json({
          status: 'success',
          message: 'User created successfully. Verification email sent.',
          data: userResponse
        });
      } catch (emailError) {
        console.error('❌ Verification email error:', emailError);
        logger.error('Verification email error:', {
          error: emailError.message,
          code: emailError.code,
          email: user.email
        });
        
        // If email fails, clear the token but still return success for user creation
        user.verificationToken = undefined;
        await user.save({ validateBeforeSave: false });

        // Don't send the password back
        const userResponse = { ...user._doc };
        delete userResponse.password;

        res.status(201).json({
          status: 'success',
          message: 'User created successfully, but verification email could not be sent. Please contact support.',
          data: userResponse,
          emailError: emailError.message // Include error for debugging
        });
      }
    } catch (error) {
      console.error('❌ Create user error:', error);
      logger.error('Create user error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Server error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// @desc    Get current user profile
// @route   GET /api/users/profile
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    // req.user.id comes from the protect middleware after token verification
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: user
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Update current user's preferences (e.g., theme)
// @route   PUT /api/users/preferences
// @access  Private
router.put('/preferences', protect, async (req, res) => {
  try {
    // Find the user and update only the preferences field
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { preferences: req.body },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      status: 'success',
      data: { preferences: user.preferences }
    });
  } catch (error) {
    logger.error('Update preferences error:', error);
    res.status(500).json({ status: 'error', message: 'Server Error' });
  }
});

// @desc    Update user details (by Admin)
// @route   PUT /api/users/:id
// @access  Private (Admin only)
router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { firstName, lastName, email, role, isActive } = req.body;
    
    const fieldsToUpdate = {
      firstName,
      lastName,
      email,
      role,
      isActive
    };

    // Remove any undefined fields so they don't overwrite existing data
    Object.keys(fieldsToUpdate).forEach(key => fieldsToUpdate[key] === undefined && delete fieldsToUpdate[key]);

    const user = await User.findByIdAndUpdate(req.params.id, fieldsToUpdate, {
      new: true,
      runValidators: true
    }).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    logger.error('Admin update user error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private (Admin or same user)
router.get('/:id', protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Check if user is authorized to view this user
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Not authorized to access this user'
      });
    }

    res.status(200).json({
      status: 'success',
      data: user
    });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private (Admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Prevent admin from deleting themselves
    if (req.user.id === req.params.id) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete your own account'
      });
    }

    await user.deleteOne();

    res.status(200).json({
      status: 'success',
      message: 'User deleted successfully'
    });
  } catch (error) {
    logger.error('Delete user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Deactivate/Activate user
// @route   PATCH /api/users/:id/toggle-status
// @access  Private (Admin only)
router.patch('/:id/toggle-status', protect, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Prevent admin from deactivating themselves
    if (req.user.id === req.params.id) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot deactivate your own account'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.status(200).json({
      status: 'success',
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: user._id,
        isActive: user.isActive
      }
    });
  } catch (error) {
    logger.error('Toggle user status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

export default router;
